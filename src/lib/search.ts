/**
 * Web search layer.
 * - Tavily: agent-optimized, browser-direct, keyless mode for free tier
 * - DuckDuckGo HTML: free, no key, slow fallback
 * - Wikipedia REST API: free, knowledge queries (last-resort fallback)
 *
 * Design:
 * - All providers accept an AbortSignal so chat aborts cancel in-flight fetches
 * - Each provider retries once on transient network errors
 * - Fallback chain prefers real web search (Tavily, DDG) over Wikipedia
 * - The user-facing tool wraps results with raw_content where available so the
 *   model can read the actual page text, not just a snippet
 */

import { decrypt, getUnlockedKey } from './crypto'
import { ensureSettings, type EncryptedEnvelope } from './db'

export interface SearchResult {
  title: string
  url: string
  snippet: string
  content?: string
  score?: number
  publishedDate?: string
  source: string
}

export interface SearchOptions {
  query: string
  maxResults?: number
  includeDomains?: string[]
  recencyDays?: number
  topic?: 'general' | 'news'
  /** Abort signal — propagates from the chat abort controller */
  signal?: AbortSignal
}

export interface SearchProvider {
  id: 'tavily' | 'duckduckgo' | 'wikipedia' | 'none'
  name: string
  needsKey: boolean
  description: string
}

type SearchProviderId = 'tavily' | 'duckduckgo' | 'wikipedia'

/**
 * Run a web search across the configured provider with automatic fallbacks.
 * Order: user's chosen provider → Tavily → DuckDuckGo → Wikipedia.
 * Wikipedia is last because it's a knowledge base, not a general web search.
 */
export async function webSearch(opts: SearchOptions): Promise<SearchResult[]> {
  const settings = await ensureSettings()
  const primary = settings.searchProvider
  const chain: SearchProviderId[] = []
  if (primary === 'tavily' || primary === 'duckduckgo' || primary === 'wikipedia') {
    chain.push(primary)
  }
  // Fallback chain (skip the primary, which is already at the front)
  for (const f of ['tavily', 'duckduckgo', 'wikipedia'] as const) {
    if (!chain.includes(f)) chain.push(f)
  }

  const maxResults = opts.maxResults ?? 5
  const errors: string[] = []
  const signal = opts.signal

  for (const provider of chain) {
    if (signal?.aborted) return []
    try {
      let res: SearchResult[] = []
      if (provider === 'tavily') {
        res = await tavilySearch(opts, maxResults, settings.encryptedKeys.tavily, signal)
      } else if (provider === 'duckduckgo') {
        res = await withRetry(() => duckDuckGoSearch(opts, maxResults, signal), signal)
      } else if (provider === 'wikipedia') {
        res = await withRetry(() => wikipediaSearch(opts, maxResults, signal), signal)
      }
      if (res.length > 0) return res
    } catch (e: any) {
      if (signal?.aborted) return []
      errors.push(`${provider}: ${e?.message || e}`)
    }
  }

  if (errors.length) {
    console.warn('[search] all providers failed:', errors)
  }
  return []
}

/** Run a fetch with one retry on network errors. Aborts immediately on signal. */
async function withRetry<T>(fn: () => Promise<T>, signal?: AbortSignal, attempts = 2): Promise<T> {
  let lastErr: any
  for (let i = 0; i < attempts; i++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    try {
      return await fn()
    } catch (e: any) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      lastErr = e
      // Don't retry on 4xx client errors — only on network/transient failures
      const status = e?.status ?? e?.response?.status
      if (status && status >= 400 && status < 500 && status !== 408 && status !== 429) throw e
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, 250 * (i + 1)))
      }
    }
  }
  throw lastErr
}

// --- Tavily ---

async function tavilySearch(
  opts: SearchOptions,
  maxResults: number,
  encryptedKey: EncryptedEnvelope | undefined,
  signal?: AbortSignal
): Promise<SearchResult[]> {
  let apiKey: string | undefined
  if (encryptedKey) {
    const dek = getUnlockedKey()
    if (dek) {
      try {
        const json = await decrypt(dek, encryptedKey)
        apiKey = JSON.parse(json).apiKey
      } catch (e) {
        console.warn('[search] failed to decrypt Tavily key, falling back to keyless')
      }
    }
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`
  } else {
    headers['X-Tavily-Access-Mode'] = 'keyless'
  }

  const body: any = {
    query: opts.query,
    max_results: maxResults,
    include_answer: false,
    include_raw_content: true,
    topic: opts.topic || 'general',
  }
  if (opts.includeDomains?.length) body.include_domains = opts.includeDomains
  // Tavily: `days` is the recency window — 0 means no recency filter
  if (typeof opts.recencyDays === 'number' && opts.recencyDays > 0) {
    body.days = Math.min(Math.max(opts.recencyDays, 1), 365)
  }

  const resp = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
  })
  if (!resp.ok) {
    const text = await resp.text()
    const err: any = new Error(`Tavily ${resp.status}: ${text.slice(0, 200)}`)
    err.status = resp.status
    throw err
  }
  const data = await resp.json()
  return (data.results || []).map((r: any): SearchResult => ({
    title: r.title || r.url,
    url: r.url,
    snippet: r.content || '',
    content: r.raw_content || undefined,
    score: r.score,
    publishedDate: r.published_date,
    source: 'tavily',
  }))
}

// --- DuckDuckGo HTML ---

async function duckDuckGoSearch(
  opts: SearchOptions,
  maxResults: number,
  signal?: AbortSignal
): Promise<SearchResult[]> {
  const params = new URLSearchParams({ q: opts.query })
  if (opts.recencyDays) {
    params.set('df', `d-${Math.min(opts.recencyDays, 365)}`)
  }
  const url = `https://html.duckduckgo.com/html/?${params.toString()}`
  const resp = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'text/html',
    },
    signal,
  })
  if (!resp.ok) {
    const err: any = new Error(`DuckDuckGo ${resp.status}`)
    err.status = resp.status
    throw err
  }
  const html = await resp.text()
  return parseDuckDuckGo(html, maxResults)
}

function parseDuckDuckGo(html: string, maxResults: number): SearchResult[] {
  const results: SearchResult[] = []
  // Match result blocks. DDG sometimes wraps the title in <h2> or uses
  // <a class="result__a">. Keep the regex permissive but anchored on the
  // unique class names DDG's HTML interface uses.
  const blockRe = /<a\s+[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<a\s+[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>|<div[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/div>)/g
  let match: RegExpExecArray | null
  while ((match = blockRe.exec(html)) !== null && results.length < maxResults) {
    const url = decodeHtml(match[1])
    const title = stripTags(decodeHtml(match[2])).trim()
    const snippet = stripTags(decodeHtml(match[3] || match[4] || '')).trim()
    if (url && title) {
      results.push({ title, url, snippet, source: 'duckduckgo' })
    }
  }
  return results
}

function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, '')
}

// --- Wikipedia ---

async function wikipediaSearch(
  opts: SearchOptions,
  maxResults: number,
  signal?: AbortSignal
): Promise<SearchResult[]> {
  // First, search for titles
  const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&origin=*&srlimit=${maxResults}&srsearch=${encodeURIComponent(opts.query)}`
  const resp = await fetch(searchUrl, { signal })
  if (!resp.ok) {
    const err: any = new Error(`Wikipedia ${resp.status}`)
    err.status = resp.status
    throw err
  }
  const data = await resp.json()
  const hits: any[] = data?.query?.search || []
  if (hits.length === 0) return []

  // Fetch extracts for the top results
  const titles = hits.map((h) => h.title).join('|')
  const extractUrl = `https://en.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=1&explaintext=1&format=json&origin=*&titles=${encodeURIComponent(titles)}`
  const extractResp = await fetch(extractUrl, { signal })
  if (!extractResp.ok) {
    const err: any = new Error(`Wikipedia extract ${extractResp.status}`)
    err.status = extractResp.status
    throw err
  }
  const extractData = await extractResp.json()
  const pages: any = extractData?.query?.pages || {}

  return hits.map((h) => {
    const page = pages[h.pageid] || {}
    return {
      title: h.title,
      url: `https://en.wikipedia.org/wiki/${encodeURIComponent(h.title.replace(/ /g, '_'))}`,
      snippet: stripTags(h.snippet || '').replace(/&quot;.*?&quot;/g, ''),
      content: page.extract || '',
      source: 'wikipedia',
    }
  })
}

// --- Direct URL fetch (used by the fetch_url tool) ---

export interface FetchedPage {
  url: string
  title?: string
  text: string
  byteLength: number
  contentType?: string
  status: number
}

/**
 * Fetch a URL server-side (well, browser-direct) and extract readable text.
 * Used by the fetch_url tool so the model can deep-read a page found by
 * web_search instead of trying to synthesize from a snippet.
 *
 * Strips scripts/styles/HTML, trims to a sensible length so we don't blow
 * the model's context. Returns plain text plus the resolved URL.
 */
export async function fetchUrl(url: string, opts: { maxChars?: number; signal?: AbortSignal } = {}): Promise<FetchedPage> {
  const maxChars = opts.maxChars ?? 12_000
  const signal = opts.signal
  if (!/^https?:\/\//i.test(url)) throw new Error(`fetch_url: only http(s) URLs are supported (got "${url}")`)
  const resp = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Hatch) AppleWebKit/537.36' },
    signal,
    redirect: 'follow',
  })
  if (!resp.ok) {
    const err: any = new Error(`fetch_url: HTTP ${resp.status} for ${url}`)
    err.status = resp.status
    throw err
  }
  const contentType = resp.headers.get('content-type') || ''
  const raw = await resp.text()
  let text: string
  if (contentType.includes('text/plain') || contentType.includes('text/markdown') || contentType.includes('application/json')) {
    text = raw
  } else {
    text = htmlToText(raw)
  }
  text = text.replace(/\s+/g, ' ').trim()
  if (text.length > maxChars) text = text.slice(0, maxChars) + '\n\n[...truncated — page was longer than the model can read in one pass]'
  // Title
  const titleMatch = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  const title = titleMatch ? stripTags(decodeHtml(titleMatch[1])).trim() : undefined
  return {
    url: resp.url || url,
    title,
    text,
    byteLength: text.length,
    contentType,
    status: resp.status,
  }
}

function htmlToText(html: string): string {
  // Drop script/style/noscript/svg blocks entirely
  let s = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, ' ')
  // Convert <br>, block-level closers, list items to newlines
  s = s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr|td|th|article|section|header|footer)>/gi, '\n')
  // Strip remaining tags
  s = s.replace(/<[^>]+>/g, '')
  // Decode entities
  s = decodeHtml(s)
  // Collapse runs of whitespace
  s = s.replace(/[ \t]+/g, ' ').replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n')
  return s.trim()
}

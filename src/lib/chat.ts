/**
 * Chat engine: streaming chat with tool calls, status pipeline, jitter buffer.
 * Ties together providers + agents + memory + search.
 *
 * Tool calling notes:
 * - Three tools are exposed: `web_search` (find pages), `fetch_url` (deep-read a
 *   page), and `search_artifacts` (RAG over the founder's saved Library)
 * - Every tool call gets a unique `toolCallId` from the AI SDK; the UI keys overrides
 *   by id, not by name, so multiple parallel calls don't collide
 * - `onInputAvailable` fires the "pending" status the moment the model commits to
 *   its query — the user sees "Searching for X…" before the request actually leaves
 * - The status pipeline is driven by `onStep` — every tool call is its own step
 *   (Plan → Search → Read → Answer), so the user can see exactly where the agent is
 * - `AbortSignal` is propagated into search providers so a Stop click cancels
 *   in-flight HTTP requests
 * - **Text-based function calls are stripped**: some smaller open-source models
 *   write tool calls in prose (e.g. `<function\\web_search {...}></function>`)
 *   instead of making a real tool call. The AI SDK can't parse those, so the
 *   user would otherwise see raw function-call syntax in the answer. We detect
 *   and remove these from the final text and surface a synthetic "missed tool
 *   call" tool-call row to the UI so the founder can see what went wrong.
 */

import { streamText, tool, stepCountIs, type ModelMessage } from 'ai'
import { z } from 'zod'
import {
  getModel,
  streamBrowserAI,
  detectBrowserAI,
  getModelInfo,
  getReasoningProviderOptions,
  type ProviderId,
  type StreamCallbacks,
} from './providers'
import { buildSystemPrompt } from './agents'
import { db, getCompany, getFounderProfile, getMemoryDigest, updateMemoryDigest } from './db'
import { webSearch, fetchUrl, type SearchResult, type FetchedPage } from './search'
import { searchArtifacts, formatArtifactSearchResultForModel, fetchArtifactById } from './artifactSearch'
import { recallMemory, addMemoryNode, formatMemoryHitsForModel, type MemorySearchHit } from './memoryNodes'

export interface ChatRequest {
  agentRole: import('./db').AgentRole
  provider: ProviderId
  model: string
  messages: { role: 'user' | 'assistant' | 'system'; content: string }[]
  conversationId: string
  signal?: AbortSignal
  /** Optional explicit verb list override for this request */
  verbList?: string[]
  onStep?: (step: { id: string; label: string; status: 'pending' | 'active' | 'done' | 'error'; detail?: string }) => void
  onToolCall?: (call: { toolCallId: string; name: string; args: any; result?: any; status: 'pending' | 'ok' | 'error' }) => void
  /**
   * Called when the model wrote a function call in prose (e.g.
   * `<function\\web_search {...}></function>`) instead of invoking the tool
   * via the API. We surface this to the UI as a synthetic "missed tool call"
   * row so the user sees what the model tried to do and why nothing happened.
   * The synthetic record uses a `__missed_<n>__` pseudo toolCallId so it
   * never collides with a real one.
   */
  onMissedToolCall?: (missed: { pseudoId: string; name: string; args: any; reason: string }) => void
}

/** The tool names we recognise. Used to filter text-based calls. */
const KNOWN_TOOL_NAMES = ['web_search', 'fetch_url', 'search_artifacts', 'fetch_artifact', 'recall_memory'] as const
type KnownToolName = (typeof KNOWN_TOOL_NAMES)[number]

function safeJsonParse<T = any>(s: string, fallback: T): T {
  try {
    return JSON.parse(s) as T
  } catch {
    return fallback
  }
}

/**
 * Pull a `name` + `args` object out of an angle-backslash function-call blob
 * of the form `web_search { "query": "..." }`. Returns null if it can't
 * make sense of the blob.
 *
 * If the parsed JSON has a single `arguments` / `args` / `parameters` key,
 * that wrapper is unwrapped so downstream code can use `args.query` etc.
 * directly (matches the behaviour of `parseJsonToolCall`).
 *
 * The regex sometimes captures a stray trailing `}` (because the model's
 * closing tag is `}}></function>`), so we strip a single trailing brace
 * before parsing.
 */
function parseAngleBackslash(name: string, argsJson: string): { name: string; args: any } | null {
  let cleaned = argsJson.trim()
  // Strip a single trailing `}` if the parse would otherwise fail.
  while (cleaned.endsWith('}')) {
    try {
      const parsed = JSON.parse(cleaned)
      if (parsed && typeof parsed === 'object') {
        const keys = Object.keys(parsed)
        if (keys.length === 1 && (keys[0] === 'arguments' || keys[0] === 'args' || keys[0] === 'parameters')) {
          return { name, args: (parsed as any)[keys[0]] }
        }
        return { name, args: parsed }
      }
    } catch {
      /* try trimming one more brace */
    }
    cleaned = cleaned.slice(0, -1)
  }
  return null
}

/**
 * Pull a `name` + `args` object out of a JSON function-call blob of the form
 * {"name": "...", "arguments": ...} (or `args` / `parameters` aliases).
 */
function parseJsonToolCall(json: string): { name: string; args: any } | null {
  const j = safeJsonParse<any>(json, null)
  if (!j || typeof j !== 'object' || typeof j.name !== 'string') return null
  const args = j.arguments ?? j.args ?? j.parameters ?? {}
  const parsedArgs = typeof args === 'string' ? safeJsonParse(args, {}) : args
  return { name: j.name, args: parsedArgs }
}

/**
 * Find the first balanced `{...}` JSON object in a string. Handles nested
 * braces and string literals with escaped quotes (`\"`, `\\`). Returns
 * the full slice (including the outer braces) or null if no balanced
 * object is found. Used by the code-fenced tool-call pattern so a
 * non-greedy regex doesn't match the inner `}` of a nested object and
 * leave the outer code fence behind.
 */
function findFirstBalancedJsonObject(s: string): string | null {
  const start = s.indexOf('{')
  if (start < 0) return null
  let depth = 0
  let inString = false
  let escape = false
  for (let i = start; i < s.length; i++) {
    const ch = s[i]
    if (escape) { escape = false; continue }
    if (ch === '\\') { escape = true; continue }
    if (ch === '"') { inString = !inString; continue }
    if (inString) continue
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return s.slice(start, i + 1)
    }
  }
  return null
}

/**
 * Find the first balanced `[...]` JSON array. Symmetric to
 * `findFirstBalancedJsonObject` — used to extract a tool-call array
 * from inside a code fence.
 */
function findFirstBalancedJsonArray(s: string): string | null {
  const start = s.indexOf('[')
  if (start < 0) return null
  let depth = 0
  let inString = false
  let escape = false
  for (let i = start; i < s.length; i++) {
    const ch = s[i]
    if (escape) { escape = false; continue }
    if (ch === '\\') { escape = true; continue }
    if (ch === '"') { inString = !inString; continue }
    if (inString) continue
    if (ch === '[') depth++
    else if (ch === ']') {
      depth--
      if (depth === 0) return s.slice(start, i + 1)
    }
  }
  return null
}

export interface StrippedToolCall {
  pseudoId: string
  name: string
  args: any
  /** Why we think the model wrote this in prose instead of calling the tool. */
  reason: string
}

/**
 * Scan a model's text response for non-standard function-call syntax and
 * remove it. Returns the cleaned text plus any "missed" tool calls the
 * caller can surface to the UI.
 *
 * The patterns we strip are intentionally conservative — we only remove
 * text that is *clearly* a function-call imitation, not prose that happens
 * to contain the word "web_search".
 */
export function stripTextBasedToolCalls(text: string): { clean: string; missed: StrippedToolCall[] } {
  if (!text) return { clean: text, missed: [] }
  let out = text
  const missed: StrippedToolCall[] = []
  let i = 0
  const recordMissed = (parsed: { name: string; args: any }) => {
    if (!KNOWN_TOOL_NAMES.includes(parsed.name as KnownToolName)) return false
    missed.push({
      pseudoId: `__missed_${i++}__`,
      name: parsed.name,
      args: parsed.args,
      reason: 'The model wrote the tool call as text instead of invoking it via the API.',
    })
    return true
  }

  /**
   * Walk an array of tool-call objects and record each one whose `name` is
   * a known tool. Unknown tools are silently skipped. Returns true if at
   * least one known tool was recorded — the caller uses this to decide
   * whether to strip the array from the visible text.
   *
   * Replaces an earlier bug where the `<function_calls>` and bare-array
   * patterns only recorded the FIRST item in a multi-call array, silently
   * dropping every subsequent one.
   */
  const recordAllFromArray = (arr: any[]): boolean => {
    let recordedAny = false
    for (const item of arr) {
      if (!item || typeof item.name !== 'string') continue
      const args = item.arguments ?? item.args ?? item.parameters ?? {}
      const parsedArgs = typeof args === 'string' ? safeJsonParse(args, {}) : args
      if (recordMissed({ name: item.name, args: parsedArgs })) {
        recordedAny = true
      }
    }
    return recordedAny
  }

  // Pattern 1: <function\name {ARGS}></function>
  //   Accepts one OR two backslashes between `function` and the tool name —
  //   some models double-escape the separator, and a strict `\\` would miss
  //   single-backslash outputs from smaller open-source models.
  //   Note: the model sometimes writes the closing tag as `}}></function>`
  //   (an extra `}` before the `>`), so the captured JSON group may have a
  //   stray trailing `}`. `parseAngleBackslash` strips it before parsing.
  out = out.replace(/<function[\\]+(\w+)\s+(\{[\s\S]*?\})>\s*<\/function>/gi, (m, name, argsJson) => {
    const parsed = parseAngleBackslash(name, argsJson)
    if (parsed && recordMissed(parsed)) return ''
    return m
  })

  // Pattern 2: <tool_call>{...}</tool_call>  (any JSON-shaped body)
  out = out.replace(/<tool_call\s*>\s*([\s\S]*?)\s*<\/tool_call>/gi, (m, blob) => {
    const parsed = parseJsonToolCall(blob.trim())
    if (parsed && recordMissed(parsed)) return ''
    return m
  })

  // Pattern 3 + 4: bracket-style wrappers
  out = out.replace(/\[FUNCTION_CALL\]([\s\S]*?)\[\/FUNCTION_CALL\]/gi, (m, blob) => {
    const parsed = parseJsonToolCall(blob.trim())
    if (parsed && recordMissed(parsed)) return ''
    return m
  })
  out = out.replace(/\[TOOL_CALL\]([\s\S]*?)\[\/TOOL_CALL\]/gi, (m, blob) => {
    const parsed = parseJsonToolCall(blob.trim())
    if (parsed && recordMissed(parsed)) return ''
    return m
  })

  // Pattern 5: code-fenced JSON tool call — object OR array (must run BEFORE
  // the bare-JSON patterns below, otherwise the bare-JSON pattern will eat
  // the JSON body and leave an empty ```json\n``` shell).
  //
  // Uses balanced-brace/bracket finders (not non-greedy regex) so a nested
  // `}` inside `"arguments": {...}` doesn't make the regex stop at the inner
  // close and leave the outer fence behind. Also covers both ` ``` ` and
  // ` ```json ` (and any other language tag) — the inner content is parsed
  // as JSON; if no recognised tool call is found, the fence is left alone
  // (so legitimate code blocks aren't accidentally stripped).
  out = out.replace(/```(?:[a-zA-Z]+)?\s*([\s\S]*?)\s*```/gi, (m, inner) => {
    // Try a balanced JSON array first — covers multi-call patterns that an
    // object-only finder would truncate to the first item (e.g. an array of
    // two tool calls inside a code fence would only record the first one).
    const arr = findFirstBalancedJsonArray(inner)
    if (arr) {
      try {
        const parsed = JSON.parse(arr)
        if (Array.isArray(parsed) && recordAllFromArray(parsed)) return ''
      } catch { /* fall through */ }
    }
    // Then try a balanced JSON object
    const obj = findFirstBalancedJsonObject(inner)
    if (obj) {
      const parsed = parseJsonToolCall(obj)
      if (parsed && recordMissed(parsed)) return ''
    }
    return m
  })

  // Pattern 6: bare JSON tool-call block sitting on its own line/paragraph
  // (some models skip the wrapper entirely)
  out = out.replace(
    /(^|\n)(\s*\{\s*"name"\s*:\s*"(?:web_search|fetch_url|search_artifacts)"\s*,\s*"(?:arguments|args|parameters)"\s*:\s*[\s\S]*?\})(\s*(?:\n|$))/gi,
    (_m, lead, blob) => {
      const parsed = parseJsonToolCall(blob.trim())
      if (parsed && recordMissed(parsed)) return lead
      return _m
    }
  )

  // Pattern 7: <function_calls>[{...}]</function_calls> (OpenAI function-calling
  //  format some open models imitate)
  out = out.replace(/<function_calls\s*>\s*(\[[\s\S]*?\])\s*<\/function_calls>/gi, (m, blob) => {
    let arr: any
    try {
      arr = JSON.parse(blob.trim())
    } catch {
      // Try stripping a trailing `}` before parse
      let cleaned = blob.trim()
      while (cleaned.endsWith('}') || cleaned.endsWith(']')) {
        try {
          arr = JSON.parse(cleaned)
          break
        } catch {
          cleaned = cleaned.slice(0, -1)
        }
      }
      if (!arr) return m
    }
    if (Array.isArray(arr)) {
      let anyRecorded = false
      for (const item of arr) {
        if (item?.name) {
          const args = item.arguments ?? item.args ?? item.parameters ?? {}
          const parsedArgs = typeof args === 'string' ? safeJsonParse(args, {}) : args
          if (recordMissed({ name: item.name, args: parsedArgs })) anyRecorded = true
        }
      }
      if (anyRecorded) return ''
    }
    return m
  })

  // Pattern 8: bare JSON array of tool calls (no wrapper, no code fence)
  // — e.g. `[{"name": "web_search", ...}, {"name": "fetch_url", ...}]`
  out = out.replace(
    /(^|\n)(\s*\[\s*\{\s*"name"\s*:\s*"(?:web_search|fetch_url|search_artifacts)"[\s\S]*?\}\s*\])\s*(\n|$)/gi,
    (_m, lead, blob, tail) => {
      let arr: any
      try { arr = JSON.parse(blob.trim()) } catch { return _m }
      if (!Array.isArray(arr)) return _m
      let anyRecorded = false
      for (const item of arr) {
        if (item?.name) {
          const args = item.arguments ?? item.args ?? item.parameters ?? {}
          const parsedArgs = typeof args === 'string' ? safeJsonParse(args, {}) : args
          if (recordMissed({ name: item.name, args: parsedArgs })) anyRecorded = true
        }
      }
      if (anyRecorded) return lead + tail
      return _m
    }
  )

  // Pattern 9: some open-source models wrap the JSON in <output> or <response>
  // tags instead of <function>
  out = out.replace(/<output\s*>\s*([\s\S]*?)\s*<\/output>/gi, (m, blob) => {
    const parsed = parseJsonToolCall(blob.trim())
    if (parsed && recordMissed(parsed)) return ''
    return m
  })
  out = out.replace(/<response\s*>\s*([\s\S]*?)\s*<\/response>/gi, (m, blob) => {
    const parsed = parseJsonToolCall(blob.trim())
    if (parsed && recordMissed(parsed)) return ''
    return m
  })

  // Collapse extra blank lines that the stripping may have left behind
  out = out.replace(/\n{3,}/g, '\n\n').trim()
  return { clean: out, missed }
}

/**
 * Truncate the tool result returned to the model so a single search
 * can't blow out the context window.  The full result stays in the UI
 * tool-call record for the user to expand.
 */
const TOOL_RESULT_MAX_CHARS = 6_000

function trimForModel(s: string, max: number): string {
  if (!s) return ''
  if (s.length <= max) return s
  return s.slice(0, max) + `\n\n[...truncated, ${s.length - max} more chars]`
}

/**
 * Standalone executor for the `web_search` tool. Returns a result in the
 * shape the UI's `WebSearchResults` / `ToolCallRow` components understand
 * (with `fullResults` for the UI, `results` for the model, and timing/source
 * metadata). Throws `DOMException('Aborted')` if `signal` aborts, and never
 * throws on a normal provider error — it returns `{ ok: false, error }`
 * instead so the caller can render the error in the row.
 */
export async function runWebSearchTool(opts: {
  query: string
  maxResults?: number
  topic?: 'general' | 'news'
  recencyDays?: number
  signal?: AbortSignal
}): Promise<{
  ok: boolean
  tookMs: number
  source: string
  count: number
  query: string
  topic: 'general' | 'news'
  recencyDays?: number
  results: SearchResult[]
  fullResults: SearchResult[]
  error?: string
}> {
  const start = Date.now()
  const query = opts.query
  const maxResults = opts.maxResults ?? 5
  const effectiveTopic = opts.topic || (NEWS_HINTS.test(query) ? 'news' : 'general')
  const effectiveRecency = opts.recencyDays || (effectiveTopic === 'news' ? 30 : undefined)
  let result: SearchResult[] = []
  let errorMsg: string | undefined
  try {
    result = await webSearch({
      query,
      maxResults,
      topic: effectiveTopic,
      recencyDays: effectiveRecency,
      signal: opts.signal,
    })
    if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  } catch (e: any) {
    if (e?.name === 'AbortError') throw e
    errorMsg = e?.message || String(e)
  }
  const tookMs = Date.now() - start
  const modelResults = pickToolResultsForModel(result, TOOL_RESULT_MAX_CHARS)
  return {
    ok: !errorMsg,
    tookMs,
    source: result[0]?.source || 'none',
    count: result.length,
    query,
    topic: effectiveTopic,
    recencyDays: effectiveRecency,
    results: modelResults,
    fullResults: result,
    ...(errorMsg ? { error: errorMsg } : {}),
  }
}

/**
 * Standalone executor for the `fetch_url` tool. Same shape contract as
 * `runWebSearchTool`. Returns the page text trimmed to `TOOL_RESULT_MAX_CHARS`
 * for the model; the full text is returned in `text` for the UI.
 */
export async function runFetchUrlTool(opts: {
  url: string
  maxChars?: number
  signal?: AbortSignal
}): Promise<{
  ok: boolean
  tookMs: number
  url: string
  title?: string
  byteLength: number
  contentType?: string
  status?: number
  text: string
  error?: string
}> {
  const start = Date.now()
  let page: FetchedPage | undefined
  let errorMsg: string | undefined
  try {
    page = await fetchUrl(opts.url, { maxChars: opts.maxChars, signal: opts.signal })
    if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  } catch (e: any) {
    if (e?.name === 'AbortError') throw e
    errorMsg = e?.message || String(e)
  }
  const tookMs = Date.now() - start
  if (!page) {
    return {
      ok: false,
      tookMs,
      url: opts.url,
      byteLength: 0,
      text: '',
      error: errorMsg || 'Fetch failed',
    }
  }
  return {
    ok: true,
    tookMs,
    url: page.url,
    title: page.title,
    byteLength: page.byteLength,
    contentType: page.contentType,
    status: page.status,
    text: trimForModel(page.text, TOOL_RESULT_MAX_CHARS),
  }
}

/**
 * Standalone executor for the `search_artifacts` tool. Hits the founder's
 * own Library via BM25 in Dexie. `fullHits` carries the rich records the
 * UI needs (timestamps, tags, pinned flag, snippet with `<mark>` highlights);
 * `hits` is the compact model-facing version.
 */
export async function runSearchArtifactsTool(opts: {
  query: string
  maxResults?: number
  types?: string[]
  pinnedOnly?: boolean
}): Promise<{
  ok: boolean
  tookMs: number
  summary: string
  hits: any[]
  fullHits: any[]
  scanned: number
  query: string
  error?: string
}> {
  const start = Date.now()
  let result: Awaited<ReturnType<typeof searchArtifacts>> | null = null
  let errorMsg: string | undefined
  try {
    result = await searchArtifacts({
      query: opts.query,
      maxResults: opts.maxResults,
      types: opts.types as any,
      pinnedOnly: opts.pinnedOnly,
    })
  } catch (e: any) {
    errorMsg = e?.message || String(e)
  }
  const tookMs = Date.now() - start
  const fullHits = result?.hits || []
  // Fetch the full body of every hit so the model sees the founder's actual
  // content, not just a 2-sentence summary. Parallel for speed; each cap
  // is 6,000 chars to keep the search light.
  const bodies = new Map<string, string>()
  if (fullHits.length > 0 && !errorMsg) {
    const fetched = await Promise.all(
      fullHits.map((h) => fetchArtifactById(h.id, 6_000).catch(() => null))
    )
    fetched.forEach((a, i) => {
      if (a) bodies.set(fullHits[i].id, a.content)
    })
  }
  const compact = result
    ? formatArtifactSearchResultForModel(result, bodies, 3_000)
    : null
  return {
    ok: !errorMsg,
    tookMs,
    summary: compact?.summary || (errorMsg ? `Library search failed: ${errorMsg}` : ''),
    hits: compact?.hits || [],
    fullHits,
    scanned: compact?.scanned ?? 0,
    query: opts.query,
    ...(errorMsg ? { error: errorMsg } : {}),
  }
}

/**
 * Standalone executor for the `fetch_artifact` tool. Returns the full body
 * (trimmed) plus the AI-generated summary for context.
 */
export async function runFetchArtifactTool(opts: {
  id: string
  maxChars?: number
}): Promise<{
  ok: boolean
  tookMs: number
  id: string
  title?: string
  type?: string
  summary?: string
  content?: string
  contentLength: number
  truncated?: boolean
  error?: string
}> {
  const start = Date.now()
  let artifact: Awaited<ReturnType<typeof fetchArtifactById>> | null = null
  let errorMsg: string | undefined
  try {
    artifact = await fetchArtifactById(opts.id, opts.maxChars ?? 12_000)
  } catch (e: any) {
    errorMsg = e?.message || String(e)
  }
  const tookMs = Date.now() - start
  if (!artifact && !errorMsg) {
    errorMsg = `No artifact found with id "${opts.id}".`
  }
  if (errorMsg) {
    return { ok: false, tookMs, id: opts.id, contentLength: 0, error: errorMsg }
  }
  return {
    ok: true,
    tookMs,
    id: artifact!.id,
    title: artifact!.title,
    type: artifact!.type,
    summary: artifact!.summary,
    content: artifact!.content,
    contentLength: artifact!.contentLength,
    truncated: artifact!.truncated,
  }
}

/**
 * Re-run a tool call that the model emitted as text (i.e. didn't actually
 * invoke via the API). The user can click "Run this search now" on a missed
 * call row, and this is what fires. Returns a unified result envelope the
 * UI can drop directly into the `toolOverrides` state to flip the row from
 * `error/missed` to `ok` with the real result.
 *
 * Unknown tool names throw — callers should only pass names from the
 * missed-call record (which are already restricted to KNOWN_TOOL_NAMES).
 */
export async function rerunMissedToolCall(opts: {
  name: string
  args: any
  signal?: AbortSignal
}): Promise<
  | { name: 'web_search'; status: 'ok' | 'error'; result: Awaited<ReturnType<typeof runWebSearchTool>> }
  | { name: 'fetch_url'; status: 'ok' | 'error'; result: Awaited<ReturnType<typeof runFetchUrlTool>> }
  | { name: 'search_artifacts'; status: 'ok' | 'error'; result: Awaited<ReturnType<typeof runSearchArtifactsTool>> }
  | { name: 'fetch_artifact'; status: 'ok' | 'error'; result: Awaited<ReturnType<typeof runFetchArtifactTool>> }
  | { name: 'recall_memory'; status: 'ok' | 'error'; result: { ok: boolean; query: string; count: number; memories?: string; hits?: any[]; error?: string } }
  | { name: string; status: 'error'; result: { error: string } }
> {
  const { name, args, signal } = opts
  if (name === 'web_search') {
    try {
      const r = await runWebSearchTool({
        query: args?.query,
        maxResults: args?.maxResults,
        topic: args?.topic,
        recencyDays: args?.recencyDays ? Number(args.recencyDays) : undefined,
        signal,
      })
      return { name: 'web_search', status: r.ok ? 'ok' : 'error', result: r }
    } catch (e: any) {
      if (e?.name === 'AbortError') throw e
      return { name: 'web_search', status: 'error', result: { ok: false, tookMs: 0, source: 'none', count: 0, query: args?.query || '', topic: 'general', results: [], fullResults: [], error: e?.message || String(e) } }
    }
  }
  if (name === 'fetch_url') {
    try {
      const r = await runFetchUrlTool({ url: args?.url, maxChars: args?.maxChars, signal })
      return { name: 'fetch_url', status: r.ok ? 'ok' : 'error', result: r }
    } catch (e: any) {
      if (e?.name === 'AbortError') throw e
      return { name: 'fetch_url', status: 'error', result: { ok: false, tookMs: 0, url: args?.url || '', byteLength: 0, text: '', error: e?.message || String(e) } }
    }
  }
  if (name === 'search_artifacts') {
    const r = await runSearchArtifactsTool({
      query: args?.query,
      maxResults: args?.maxResults,
      types: Array.isArray(args?.types) ? args.types : undefined,
      pinnedOnly: args?.pinnedOnly,
    })
    return { name: 'search_artifacts', status: r.ok ? 'ok' : 'error', result: r }
  }
  if (name === 'fetch_artifact') {
    const r = await runFetchArtifactTool({ id: args?.id, maxChars: args?.maxChars })
    return { name: 'fetch_artifact', status: r.ok ? 'ok' : 'error', result: r }
  }
  if (name === 'recall_memory') {
    try {
      const hits = await recallMemory(args?.query || '', args?.maxResults)
      const result = { ok: true, query: args?.query || '', count: hits.length, memories: formatMemoryHitsForModel(hits), hits: hits.map((h) => ({ id: h.node.id, content: h.node.content, type: h.node.type, tags: h.node.tags, createdAt: h.node.createdAt })) }
      return { name: 'recall_memory', status: 'ok', result }
    } catch (e: any) {
      return { name: 'recall_memory', status: 'error', result: { ok: false, query: args?.query || '', count: 0, error: e?.message || String(e) } }
    }
  }
  return { name, status: 'error', result: { error: `Unknown tool: ${name}` } }
}

function pickToolResultsForModel(results: SearchResult[], maxChars: number): SearchResult[] {
  // Prioritize items with raw content; cap total
  const out: SearchResult[] = []
  let used = 0
  for (const r of results) {
    const piece = {
      title: r.title,
      url: r.url,
      snippet: r.snippet,
      content: r.content ? trimForModel(r.content, 1500) : undefined,
      publishedDate: r.publishedDate,
      source: r.source,
    }
    const size = (piece.content?.length || 0) + piece.snippet.length + piece.title.length
    if (used + size > maxChars && out.length > 0) break
    out.push(piece as SearchResult)
    used += size
  }
  return out
}

const NEWS_HINTS = /\b(today|yesterday|this week|this month|latest|recent|breaking|news|2026|2025|just|now|update|announce|launched|released)\b/i

/**
 * Run a chat completion with streaming, tool calling, and status pipeline.
 * Returns the full assistant text when done.
 */
export async function runChat(req: ChatRequest, cb: StreamCallbacks): Promise<string> {
  const [company, profileRow, digestRow] = await Promise.all([
    getCompany(),
    getFounderProfile(),
    getMemoryDigest(),
  ])
  const systemPrompt = buildSystemPrompt(
    req.agentRole,
    company || ({} as any),
    req.verbList,
    profileRow?.content,
    digestRow?.content
  )

  // Helper: emit a status step from inside tool execution. Steps are local to
  // this chat turn (lives in the assistant message's `steps` array).
  const emitStep = (step: { id: string; label: string; status: 'pending' | 'active' | 'done' | 'error'; detail?: string }) => {
    req.onStep?.(step)
  }
  // Unique id generator for status steps. Step ids must be unique within
  // a single assistant turn so the UI can update them by id.
  let stepCounter = 0
  const nextStepId = (label: string) => `s${++stepCounter}-${label.replace(/\s+/g, '-').toLowerCase().slice(0, 24)}`

  // Stable per-toolCallId → stepId map. The AI SDK fires onInputAvailable
  // and execute as two separate calls; we want them to share the SAME step
  // (active → done) so the UI shows one row, not two. Allocate the id on
  // onInputAvailable and look it up in execute.
  const toolStepIds = new Map<string, string>()
  const claimStepId = (toolCallId: string, label: string) => {
    const existing = toolStepIds.get(toolCallId)
    if (existing) return existing
    const id = nextStepId(label)
    toolStepIds.set(toolCallId, id)
    return id
  }

  // Browser AI: special path (no tools — Prompt API doesn't support function calling)
  if (req.provider === 'browser-ai') {
    const cap = await detectBrowserAI()
    if (!cap.available) {
      cb.onError(new Error('Browser AI is not available. Add an API key in Settings.'))
      return ''
    }
    // For browser-ai we emit a single "thinking" step and resolve when done
    emitStep({ id: nextStepId('thinking'), label: 'Thinking', status: 'active' })
    const history = req.messages
      .filter((m) => m.role !== 'system')
      .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n\n')
    const prompt = `${history}\n\nAssistant:`
    return new Promise<string>((resolve) => {
      let full = ''
      streamBrowserAI(prompt, systemPrompt, {
        ...cb,
        onToken: (t) => {
          full += t
          cb.onToken(t)
        },
        onDone: (info) => {
          emitStep({ id: 's1-thinking', label: 'Thinking', status: 'done' })
          cb.onDone(info)
          resolve(full)
        },
        onError: (e) => {
          emitStep({ id: 's1-thinking', label: 'Thinking', status: 'error', detail: e?.message })
          cb.onError(e)
          resolve(full)
        },
        onAbort: () => {
          emitStep({ id: 's1-thinking', label: 'Thinking', status: 'done' })
          cb.onAbort?.()
          resolve(full)
        },
        signal: req.signal,
      })
    })
  }

  // AI SDK path
  try {
    const lm = await getModel(req.provider, req.model)

    // -- Tool: search_artifacts --------------------------------------------
    // Search the founder's OWN saved library. Critical for grounding answers
    // in their previous work. The UI has a dedicated result renderer; the
    // tool runs a broad-recall BM25 + stem/prefix fallback and returns the
    // hits WITH the full body of each (trimmed to 3,000 chars per hit) so
    // the model can quote, cite, and ground in detail.
    const searchArtifactsTool = tool({
      description:
        "Search the founder's own saved Library of artifacts (strategies, 90-day plans, pricing models, teardowns, etc.). Call this whenever the founder asks about something they have worked on before, asks to find a strategy, asks what they decided, or asks to look in their library — or any time grounding in their own previous work would help. The tool is tuned for BROAD RECALL: it returns artifacts whose body, title, OR tags contain ANY of your query words, including via stem/prefix fallback (e.g. 'strate' matches 'strategy', 'pric' matches 'pricing'/'prices'/'priced'). Each hit is returned WITH the full markdown body (trimmed to 3,000 chars) so you can quote and cite specifics — you do not need a second call unless you need the rest of a long artifact.",
      inputSchema: z.object({
        query: z.string().describe('Natural-language search query. 1-6 keywords. The Library uses broad-recall BM25 with body-content matching — broader queries are fine, the search engine will surface near-matches too.'),
        maxResults: z.number().int().min(1).max(20).optional().describe('Max results to return (default 8).'),
        types: z.array(z.enum(['strategy', 'plan90', 'landing', 'pricing', 'pitch', 'review', 'teardown', 'investor', 'custom'])).optional().describe('Restrict to specific artifact types.'),
        pinnedOnly: z.boolean().optional().describe('If true, only return pinned artifacts.'),
      }),
      onInputAvailable: ({ input, toolCallId }) => {
        req.onToolCall?.({ toolCallId, name: 'search_artifacts', args: input, status: 'pending' })
        emitStep({
          id: claimStepId(toolCallId, 'library'),
          label: 'Searching your library',
          status: 'active',
          detail: input.query,
        })
      },
      execute: async ({ query, maxResults, types, pinnedOnly }, options) => {
        const stepId = claimStepId(options.toolCallId, 'library')
        // If the user clicked Stop, return a clean abort signal to the SDK
        // instead of a fake empty result. Throwing an AbortError lets the
        // AI SDK propagate the abort all the way up.
        if (options.abortSignal?.aborted) {
          emitStep({ id: stepId, label: 'Searching your library', status: 'done', detail: 'aborted' })
          throw new DOMException('Aborted', 'AbortError')
        }
        const start = Date.now()
        let result: Awaited<ReturnType<typeof searchArtifacts>> | null = null
        let errorMsg: string | undefined
        let aborted = false
        try {
          result = await searchArtifacts({ query, maxResults: maxResults ?? 8, types: types as any, pinnedOnly })
        } catch (e: any) {
          if (e?.name === 'AbortError' || options.abortSignal?.aborted) {
            aborted = true
          } else {
            errorMsg = e?.message || String(e)
          }
        }
        const tookMs = Date.now() - start
        if (aborted) {
          emitStep({ id: stepId, label: 'Searching your library', status: 'done', detail: 'aborted' })
          throw new DOMException('Aborted', 'AbortError')
        }
        // Fetch the full body of every hit in parallel so the MODEL can
        // ground its answer in the founder's actual content (numbers,
        // quotes, the real plan) — not just the 2-3 sentence summary.
        // This is the change that makes `search_artifacts` actually useful:
        // the model previously only saw a TL;DR and had to call
        // `fetch_artifact` to see anything real, which it rarely did.
        const fullHits = result?.hits || []
        const bodies = new Map<string, string>()
        if (fullHits.length > 0 && !errorMsg) {
          const fetched = await Promise.all(
            fullHits.map((h) => fetchArtifactById(h.id, 6_000).catch(() => null))
          )
          fetched.forEach((a, i) => {
            if (a) bodies.set(fullHits[i].id, a.content)
          })
        }
        const compact = result
          ? formatArtifactSearchResultForModel(result, bodies, 3_000)
          : null
        const callResult = {
          ok: !errorMsg,
          tookMs,
          scanned: compact?.scanned ?? 0,
          summary: compact?.summary || (errorMsg ? `Library search failed: ${errorMsg}` : ''),
          hits: compact?.hits || [],
          fullHits, // richer records for the UI (with timestamps, tags, pinned, etc.)
        }
        req.onToolCall?.({ toolCallId: options.toolCallId, name: 'search_artifacts', args: { query, maxResults, types, pinnedOnly }, result: callResult, status: errorMsg ? 'error' : 'ok' })
        emitStep({
          id: stepId,
          label: 'Searching your library',
          status: errorMsg ? 'error' : 'done',
          detail: errorMsg || `${fullHits.length} match${fullHits.length === 1 ? '' : 'es'} of ${callResult.scanned} saved`,
        })
        if (errorMsg) return { error: errorMsg, hits: [], scanned: 0, query }
        return { summary: compact!.summary, hits: compact!.hits, scanned: compact!.scanned, query }
      },
    })

    // -- Tool: fetch_artifact -----------------------------------------------
    // Deep-read a single artifact by id. Use this when `search_artifacts`
    // returned only the summary but the founder is asking for a specific
    // detail, quote, or full plan. Returns the full markdown body (trimmed
    // to a max char count) plus the AI-generated summary for context.
    const fetchArtifactTool = tool({
      description:
        "Read the full body of a single saved Library artifact. Use this when search_artifacts returned a relevant hit but the user is asking for specifics (a quote, a number, the full plan, a specific section). Pass the artifact's id from a previous search_artifacts hit. Returns the full markdown content, the AI-generated summary, and metadata. The body is trimmed to a max of 12,000 characters — that's plenty for most artifacts.",
      inputSchema: z.object({
        id: z.string().min(1).describe('The artifact id (from a previous search_artifacts hit).'),
        maxChars: z.number().int().min(500).max(20_000).optional().describe('Max characters of the body to return (default 12000).'),
      }),
      onInputAvailable: ({ input, toolCallId }) => {
        req.onToolCall?.({ toolCallId, name: 'fetch_artifact', args: input, status: 'pending' })
        emitStep({
          id: nextStepId('fetch-art'),
          label: 'Reading artifact',
          status: 'active',
          detail: input.id,
        })
      },
      execute: async ({ id, maxChars }, options) => {
        const start = Date.now()
        let artifact: Awaited<ReturnType<typeof fetchArtifactById>> | null = null
        let errorMsg: string | undefined
        try {
          artifact = await fetchArtifactById(id, maxChars ?? 12_000)
        } catch (e: any) {
          errorMsg = e?.message || String(e)
        }
        const tookMs = Date.now() - start
        if (!artifact && !errorMsg) {
          errorMsg = `No artifact found with id "${id}".`
        }
        const callResult = {
          ok: !!artifact,
          tookMs,
          ...(artifact || {}),
          ...(errorMsg ? { error: errorMsg } : {}),
        }
        req.onToolCall?.({
          toolCallId: options.toolCallId,
          name: 'fetch_artifact',
          args: { id, maxChars },
          result: callResult,
          status: errorMsg ? 'error' : 'ok',
        })
        emitStep({
          id: nextStepId('fetch-art'),
          label: 'Reading artifact',
          status: errorMsg ? 'error' : 'done',
          detail: errorMsg || (artifact ? `${artifact.contentLength} chars from "${artifact.title}"` : ''),
        })
        if (errorMsg) return { error: errorMsg, id }
        return {
          id: artifact!.id,
          title: artifact!.title,
          type: artifact!.type,
          summary: artifact!.summary,
          content: artifact!.content,
          contentLength: artifact!.contentLength,
          truncated: artifact!.truncated,
        }
      },
    })

    // -- Tool: web_search ---------------------------------------------------
    const searchTool = tool({
      description:
        "Search the web for current information. ALWAYS call this tool for time-sensitive questions (pricing, competitors, regulations, recent news, latest releases) and any time you are not confident your training data is up to date. NEVER say 'let me search' in prose without actually calling this tool. Synthesize the results, and cite each source inline using markdown links like [example.com](https://example.com).",
      inputSchema: z.object({
        query: z.string().describe('The search query. Be specific: include the year, brand, and any disambiguating context.'),
        maxResults: z.number().int().min(1).max(10).optional().describe('Max results to return (default 5)'),
        topic: z.enum(['general', 'news']).optional().describe('Use "news" for current events, recent releases, or anything time-sensitive. Default "general".'),
        recencyDays: z.number().int().min(1).max(365).optional().describe('Restrict to results from the last N days. Useful for "latest", "this week", "2026", etc.'),
      }),
      onInputAvailable: ({ input, toolCallId }) => {
        // Fire the pending tool-call record the moment the model commits to a
        // query. The user sees "Searching for X…" instantly, before the request
        // even leaves the browser.
        req.onToolCall?.({ toolCallId, name: 'web_search', args: input, status: 'pending' })
        emitStep({
          id: claimStepId(toolCallId, 'search'),
          label: 'Searching the web',
          status: 'active',
          detail: input.query,
        })
      },
      execute: async ({ query, maxResults = 5, topic, recencyDays }, options) => {
        const stepId = claimStepId(options.toolCallId, 'search')
        // If the user clicked Stop, throw so the AI SDK aborts the stream
        // rather than returning a fake empty result to the model.
        if (options.abortSignal?.aborted) {
          emitStep({ id: stepId, label: 'Searching the web', status: 'done', detail: 'aborted' })
          throw new DOMException('Aborted', 'AbortError')
        }
        // Use model's hints, but if it didn't set recency for a clearly-news
        // query, fill it in automatically.
        const effectiveTopic = topic || (NEWS_HINTS.test(query) ? 'news' : 'general')
        const effectiveRecency = recencyDays || (effectiveTopic === 'news' ? 30 : undefined)
        const start = Date.now()
        let result: SearchResult[] = []
        let errorMsg: string | undefined
        let aborted = false
        try {
          result = await webSearch({ query, maxResults, topic: effectiveTopic, recencyDays: effectiveRecency, signal: options.abortSignal })
        } catch (e: any) {
          if (e?.name === 'AbortError' || options.abortSignal?.aborted) {
            aborted = true
          } else {
            errorMsg = e?.message || String(e)
          }
        }
        const tookMs = Date.now() - start
        if (aborted) {
          emitStep({ id: stepId, label: 'Searching the web', status: 'done', detail: 'aborted' })
          throw new DOMException('Aborted', 'AbortError')
        }
        const modelResults = pickToolResultsForModel(result, TOOL_RESULT_MAX_CHARS)
        const callResult = {
          ok: !errorMsg,
          tookMs,
          source: result[0]?.source || 'none',
          count: result.length,
          query,
          topic: effectiveTopic,
          results: modelResults,
          ...(errorMsg ? { error: errorMsg } : {}),
        }
        req.onToolCall?.({ toolCallId: options.toolCallId, name: 'web_search', args: { query, maxResults, topic: effectiveTopic, recencyDays: effectiveRecency }, result: { ...callResult, fullResults: result }, status: errorMsg ? 'error' : 'ok' })
        emitStep({
          id: stepId,
          label: 'Searching the web',
          status: errorMsg ? 'error' : 'done',
          detail: errorMsg || `${result.length} result${result.length === 1 ? '' : 's'} from ${result[0]?.source || 'search'}`,
        })
        // Return a model-friendly version (no fullResults, no input echo)
        if (errorMsg) {
          return { error: errorMsg, results: [], count: 0, query }
        }
        return { results: modelResults, count: result.length, query, topic: effectiveTopic }
      },
    })

    // -- Tool: fetch_url ----------------------------------------------------
    const fetchTool = tool({
      description:
        'Fetch a specific URL and return its readable text. Use this to deep-read a page found by web_search when the snippet is not enough (article body, pricing page, docs page, etc.). You MUST pass a full http(s) URL.',
      inputSchema: z.object({
        url: z.string().url().describe('The full https URL to fetch'),
        maxChars: z.number().int().min(500).max(20_000).optional().describe('Max characters of the page to return (default 12000).'),
      }),
      onInputAvailable: ({ input, toolCallId }) => {
        req.onToolCall?.({ toolCallId, name: 'fetch_url', args: input, status: 'pending' })
        emitStep({
          id: claimStepId(toolCallId, 'fetch'),
          label: 'Reading page',
          status: 'active',
          detail: input.url,
        })
      },
      execute: async ({ url, maxChars }, options) => {
        const stepId = claimStepId(options.toolCallId, 'fetch')
        if (options.abortSignal?.aborted) {
          emitStep({ id: stepId, label: 'Reading page', status: 'done', detail: 'aborted' })
          throw new DOMException('Aborted', 'AbortError')
        }
        const start = Date.now()
        let page: FetchedPage | undefined
        let errorMsg: string | undefined
        let aborted = false
        try {
          page = await fetchUrl(url, { maxChars, signal: options.abortSignal })
        } catch (e: any) {
          if (e?.name === 'AbortError' || options.abortSignal?.aborted) {
            aborted = true
          } else {
            errorMsg = e?.message || String(e)
          }
        }
        const tookMs = Date.now() - start
        if (aborted) {
          emitStep({ id: stepId, label: 'Reading page', status: 'done', detail: 'aborted' })
          throw new DOMException('Aborted', 'AbortError')
        }
        const result = page
          ? {
              url: page.url,
              title: page.title,
              byteLength: page.byteLength,
              contentType: page.contentType,
              status: page.status,
              text: trimForModel(page.text, TOOL_RESULT_MAX_CHARS),
            }
          : undefined
        req.onToolCall?.({
          toolCallId: options.toolCallId,
          name: 'fetch_url',
          args: { url, maxChars },
          result: { ok: !errorMsg, tookMs, ...(result || {}), ...(errorMsg ? { error: errorMsg } : {}) },
          status: errorMsg ? 'error' : 'ok',
        })
        emitStep({
          id: stepId,
          label: 'Reading page',
          status: errorMsg ? 'error' : 'done',
          detail: errorMsg || (page ? `${page.byteLength} chars from ${new URL(page.url).hostname}` : ''),
        })
        if (errorMsg) return { error: errorMsg, url }
        return { url: page!.url, title: page!.title, text: page!.text, byteLength: page!.byteLength }
      },
    })

    // -- Tool: recall_memory ------------------------------------------------
    // Search the long-term archival memory tier (free-form nodes extracted
    // from past conversations). Called when the founder references something
    // from a previous session that isn't in the current system prompt.
    const recallMemoryTool = tool({
      description:
        "Search long-term memory for context from past conversations. Call this when the founder references something from a previous session ('we talked about...', 'remember when...', 'what was my decision on...') or when the system prompt context doesn't cover the asked topic and search_artifacts returned nothing useful. Uses BM25 search over free-form memory nodes archived from previous chats.",
      inputSchema: z.object({
        query: z.string().describe('3-8 keywords to search for in long-term memory.'),
        maxResults: z.number().int().min(1).max(10).optional().describe('Max nodes to return (default 6).'),
      }),
      onInputAvailable: ({ input, toolCallId }) => {
        req.onToolCall?.({ toolCallId, name: 'recall_memory', args: input, status: 'pending' })
        emitStep({
          id: claimStepId(toolCallId, 'memory'),
          label: 'Searching memory',
          status: 'active',
          detail: input.query,
        })
      },
      execute: async ({ query, maxResults }, options) => {
        const stepId = claimStepId(options.toolCallId, 'memory')
        if (options.abortSignal?.aborted) {
          emitStep({ id: stepId, label: 'Searching memory', status: 'done', detail: 'aborted' })
          throw new DOMException('Aborted', 'AbortError')
        }
        const start = Date.now()
        let hits: MemorySearchHit[] = []
        let errorMsg: string | undefined
        try {
          hits = await recallMemory(query, maxResults ?? 6)
        } catch (e: any) {
          errorMsg = e?.message || String(e)
        }
        const tookMs = Date.now() - start
        const callResult = {
          ok: !errorMsg,
          tookMs,
          query,
          count: hits.length,
          hits: hits.map((h) => ({
            id: h.node.id,
            content: h.node.content,
            type: h.node.type,
            tags: h.node.tags,
            createdAt: h.node.createdAt,
          })),
        }
        req.onToolCall?.({
          toolCallId: options.toolCallId,
          name: 'recall_memory',
          args: { query, maxResults },
          result: callResult,
          status: errorMsg ? 'error' : 'ok',
        })
        emitStep({
          id: stepId,
          label: 'Searching memory',
          status: errorMsg ? 'error' : 'done',
          detail: errorMsg || `${hits.length} memor${hits.length === 1 ? 'y' : 'ies'} recalled`,
        })
        if (errorMsg) return { error: errorMsg, memories: '', count: 0, query }
        return { memories: formatMemoryHitsForModel(hits), count: hits.length, query }
      },
    })

    // Map our messages to AI SDK format
    const messages: ModelMessage[] = req.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))

    const modelInfo = getModelInfo(req.provider, req.model)
    const supportsReasoning = !!modelInfo?.supportsReasoning
    const providerOptions = supportsReasoning
      ? getReasoningProviderOptions(req.provider, req.model)
      : undefined

    // Initial "plan" step (resolved in onStep)
    emitStep({ id: 'plan', label: 'Planning the response', status: 'active' })

    let fullText = ''
    let fullReasoning = ''

    const result = streamText({
      model: lm,
      system: systemPrompt,
      messages,
      tools: { web_search: searchTool, fetch_url: fetchTool, search_artifacts: searchArtifactsTool, fetch_artifact: fetchArtifactTool, recall_memory: recallMemoryTool },
      stopWhen: stepCountIs(5),
      abortSignal: req.signal,
      // Only pass providerOptions when the model is reasoning-capable. Some
      // providers reject unknown options on regular models.
      ...(providerOptions ? { providerOptions } : {}),
      onChunk: ({ chunk }) => {
        if (chunk.type === 'text-delta') {
          const t = chunk.text || ''
          if (t) {
            // The model has started writing the final answer — close the
            // initial "plan" step so the user sees the pipeline advance.
            emitStep({ id: 'plan', label: 'Planning the response', status: 'done' })
            fullText += t
            cb.onToken(t)
          }
        } else if (chunk.type === 'reasoning-delta') {
          // Native reasoning stream from providers that support it
          // (Anthropic extended thinking, OpenAI o-series, GPT-5).
          const t = chunk.text || ''
          if (t) {
            emitStep({ id: 'plan', label: 'Planning the response', status: 'done' })
            fullReasoning += t
            cb.onReasoningDelta?.(t)
          }
        }
      },
    })

    // Consume the full stream to wait for completion
    const finalText = await result.text
    const usage = await result.usage

    // If the model is not reasoning-capable but the response still contains
    // inline <think>...</think> blocks (e.g. some R1 distills, or base models
    // that imitate the pattern), lift them out so the chat content stays clean
    // and we can still surface the reasoning to the UI.
    let cleanedText = finalText || fullText
    // Strip inline <think> blocks whenever no native reasoning was streamed.
    // Some models flagged reasoning-capable (e.g. R1 distills on Groq/NVIDIA)
    // don't expose native reasoning deltas and instead emit <think>...</think>
    // in the text stream — gating on the capability flag would leak that raw
    // CoT into the answer, so gate on whether reasoning actually arrived.
    if (!fullReasoning) {
      const thinkRegex = /<think>([\s\S]*?)(?:<\/think>|$)/g
      const matches = [...cleanedText.matchAll(thinkRegex)]
      if (matches.length > 0) {
        const lifted = matches.map((m) => (m[1] || '').trim()).filter(Boolean).join('\n\n')
        if (lifted && !fullReasoning) {
          fullReasoning = lifted
          cb.onReasoningDelta?.(lifted)
        }
        cleanedText = cleanedText.replace(thinkRegex, '').trim()
      }
    }

    // Some smaller / open-source models (Hermes, NousResearch, etc.) imitate
    // function calls by writing them in prose, e.g.
    //   `<function\\web_search {"query": "..."}></function>`.
    // The AI SDK can't parse that as a real tool call, so the user would
    // otherwise see raw function-call syntax in the response. Strip it and
    // surface a synthetic "missed tool call" record to the UI so the
    // founder can see what the model tried to do.
    if (cleanedText) {
      const { clean, missed } = stripTextBasedToolCalls(cleanedText)
      if (missed.length > 0) {
        // eslint-disable-next-line no-console
        console.warn(
          `[chat] model wrote ${missed.length} tool call(s) in prose instead of invoking them:`,
          missed.map((m) => ({ name: m.name, args: m.args }))
        )
        for (const m of missed) {
          req.onMissedToolCall?.(m)
        }
      }
      cleanedText = clean
    }

    cb.onDone({
      usage: usage
        ? {
            input: usage.inputTokens || 0,
            output: usage.outputTokens || 0,
            total: usage.totalTokens || 0,
            reasoning: (usage as any).reasoningTokens || 0,
          }
        : undefined,
      provider: req.provider,
      model: req.model,
    })

    return cleanedText
  } catch (e: any) {
    // Always close the initial plan step on exit, regardless of how we exit
    if (e?.name === 'AbortError' || req.signal?.aborted) {
      emitStep({ id: 'plan', label: 'Planning the response', status: 'done', detail: 'aborted' })
      cb.onAbort?.()
      return ''
    }
    emitStep({ id: 'plan', label: 'Planning the response', status: 'error', detail: e?.message || 'failed' })
    cb.onError(e)
    return ''
  }
}

/**
 * Extract structured memory updates from a conversation turn.
 * Returns suggested updates; the user is asked to confirm before applying.
 */
export interface MemoryExtraction {
  name?: string
  oneLiner?: string
  idea?: string
  icp?: string
  stage?: string
  goal90d?: string
  goal1y?: string
  blockers?: string[]
  newDecisions?: { decision: string; rationale?: string }[]
  newMetrics?: { name: string; value: string }[]
  newOpenQuestions?: { q: string; status: 'open' | 'answered'; answer?: string }[]
  reasoning?: string
}

const EXTRACTION_SYSTEM = `You are a memory extractor. Given a conversation between a Hatch AI cofounder and a user, extract any durable facts about the user's business that should be added to a structured "Company Memory" record.

Return a JSON object with only the fields that have new or updated information. Use these fields:
- name: business name
- oneLiner: a one-sentence description
- idea: longer description of the idea
- icp: ideal customer profile
- stage: one of "idea", "validating", "building", "launched", "growing"
- goal90d: 90-day goal
- goal1y: 1-year goal
- blockers: array of current blockers (replace, not append — return the full new list)
- newDecisions: array of { decision, rationale? } — important decisions made
- newMetrics: array of { name, value } — quantitative facts
- newOpenQuestions: array of { q, status: "open" | "answered", answer? } — questions the user surfaced

Add a "reasoning" string at the end summarising what you extracted and why. If there's nothing new, return {"reasoning": "no new facts"}.

Be conservative. Only extract things the user actually said, not things the AI guessed. If the user is exploring an idea, that counts as an "idea" field, not a "name".`

export async function extractMemory(
  provider: ProviderId,
  model: string,
  recentMessages: { role: 'user' | 'assistant' | 'system'; content: string }[],
  signal?: AbortSignal
): Promise<MemoryExtraction | null> {
  if (provider === 'browser-ai') {
    // Browser AI doesn't support structured JSON well; skip extraction in this path
    return null
  }
  try {
    const lm = await getModel(provider, model)
    const transcript = recentMessages
      .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
      .join('\n\n')

    const result = await streamText({
      model: lm,
      system: EXTRACTION_SYSTEM,
      prompt: `Recent conversation:\n\n${transcript}\n\nReturn the JSON extraction.`,
      abortSignal: signal,
    })
    const text = await result.text
    // Try to find JSON in the response
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) return null
    const parsed = JSON.parse(match[0])
    return parsed as MemoryExtraction
  } catch (e) {
    console.warn('[memory] extraction failed:', e)
    return null
  }
}

/** Auto-compact when uncompacted nodes reach this count. */
const AUTO_COMPACT_THRESHOLD = 40

const ARCHIVAL_EXTRACTION_SYSTEM = `You are a memory archivist. Given a recent conversation between an AI cofounder and a founder, extract 0-5 durable facts worth storing as long-term memories.

Return a JSON array (may be empty []): [{ "content": "...", "type": "insight|decision|context|metric|question|learning", "tags": ["tag1", "tag2"], "importance": 0.0-1.0 }]

Type guide:
- insight: a realization about their business or market
- decision: a concrete choice the founder made
- context: background about the business or founder
- metric: a specific number or measurement
- question: an open question surfaced (without answer yet)
- learning: something learned about customers, competitors, or market

Importance: 0.3=low, 0.5=standard, 0.7=high, 1.0=critical decision or constraint
Tags: 1-3 short lowercase keywords (e.g. "pricing", "customer", "mvp", "fundraising")

Rules:
- Only extract things the founder actually said or clearly decided — do not infer
- Skip generic advice from the AI
- If nothing is worth long-term storage, return []`

/**
 * Run a second LLM pass after a conversation turn to extract free-form
 * memory nodes into the archival tier. Auto-saved without user approval.
 * Returns the number of nodes saved.
 */
export async function extractArchivalMemories(
  provider: ProviderId,
  model: string,
  recentMessages: { role: 'user' | 'assistant'; content: string }[],
  conversationId: string,
  signal?: AbortSignal
): Promise<number> {
  if (provider === 'browser-ai') return 0
  try {
    const lm = await getModel(provider, model)
    const transcript = recentMessages.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n')
    const result = await streamText({
      model: lm,
      system: ARCHIVAL_EXTRACTION_SYSTEM,
      prompt: `Recent conversation:\n\n${transcript}\n\nReturn the JSON array.`,
      abortSignal: signal,
    })
    const text = await result.text
    const match = text.match(/\[[\s\S]*\]/)
    if (!match) return 0
    const parsed = JSON.parse(match[0])
    if (!Array.isArray(parsed) || parsed.length === 0) return 0
    const VALID_TYPES = ['insight', 'decision', 'context', 'metric', 'question', 'learning']
    let saved = 0
    for (const item of parsed) {
      if (!item.content || typeof item.content !== 'string') continue
      const type = VALID_TYPES.includes(item.type) ? item.type : 'context'
      const tags = Array.isArray(item.tags) ? item.tags.filter((t: any) => typeof t === 'string').slice(0, 4) : []
      const importance = typeof item.importance === 'number' ? Math.max(0, Math.min(1, item.importance)) : 0.5
      await addMemoryNode(item.content, type as any, tags, conversationId, importance)
      saved++
    }

    // Auto-compact when uncompacted node count crosses the threshold.
    // Fire-and-forget — doesn't affect the return value or block the caller.
    if (saved > 0) {
      const allNodes = await db.memoryNodes.toArray()
      const uncompactedCount = allNodes.filter((n) => !n.compacted).length
      if (uncompactedCount >= AUTO_COMPACT_THRESHOLD) {
        compactMemory(provider, model, signal).catch((e) =>
          console.warn('[memory] auto-compaction failed:', e)
        )
      }
    }

    return saved
  } catch (e) {
    console.warn('[memory] archival extraction failed:', e)
    return 0
  }
}

const COMPACT_SYSTEM = `You are a memory compactor. Given a list of memory nodes from past conversations, write a concise prose summary (max 400 words) that captures the most important facts, decisions, and context about this founder and their business.

Write in present tense, first-person perspective (as if writing about the founder). Include:
- Key decisions made
- Business context and stage
- Important constraints, blockers, or goals
- Insights about their market or customers
- Quantitative facts (metrics, targets, pricing)

Be dense and specific. Omit generic statements. This text will be injected into every future conversation as long-term memory.`

/**
 * Compact all uncompacted memory nodes into the digest (memory.md).
 * Marks processed nodes as compacted. Returns the new digest content.
 */
export async function compactMemory(
  provider: ProviderId,
  model: string,
  signal?: AbortSignal
): Promise<string | null> {
  if (provider === 'browser-ai') return null
  try {
    const all = await db.memoryNodes.toArray()
    const uncompacted = all.filter((n) => !n.compacted)
    if (uncompacted.length === 0) return null

    const lm = await getModel(provider, model)
    const nodeList = uncompacted
      .map((n, i) => {
        const date = new Date(n.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        return `[${i + 1}] (${n.type}, ${date}) ${n.content}`
      })
      .join('\n')

    // Fold the new nodes into the existing digest rather than replacing it —
    // otherwise each compaction discards everything summarized before it and
    // the long-term memory steadily forgets older context.
    const prev = await getMemoryDigest()
    const prompt = prev?.content
      ? `Existing digest:\n\n${prev.content}\n\n---\n\nNew memory nodes to fold in:\n\n${nodeList}\n\nRewrite a single combined prose digest.`
      : `Memory nodes to compact:\n\n${nodeList}\n\nWrite the prose digest.`

    const result = await streamText({
      model: lm,
      system: COMPACT_SYSTEM,
      prompt,
      abortSignal: signal,
    })
    const digest = await result.text
    if (!digest.trim()) return null

    // Mark all processed nodes as compacted and save the new digest
    await Promise.all(uncompacted.map((n) => db.memoryNodes.update(n.id, { compacted: true })))
    await updateMemoryDigest(digest.trim(), (prev?.nodeCount ?? 0) + uncompacted.length)
    return digest.trim()
  } catch (e) {
    console.warn('[memory] compaction failed:', e)
    return null
  }
}

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
import { getCompany } from './db'
import { webSearch, fetchUrl, type SearchResult, type FetchedPage } from './search'
import { searchArtifacts, formatArtifactSearchResultForModel, fetchArtifactById } from './artifactSearch'

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
const KNOWN_TOOL_NAMES = ['web_search', 'fetch_url', 'search_artifacts', 'fetch_artifact'] as const
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

  // Pattern 5: bare JSON tool-call block sitting on its own line/paragraph
  // (some models skip the wrapper entirely)
  out = out.replace(
    /(^|\n)(\s*\{\s*"name"\s*:\s*"(?:web_search|fetch_url|search_artifacts)"\s*,\s*"(?:arguments|args|parameters)"\s*:\s*[\s\S]*?\})(\s*(?:\n|$))/gi,
    (_m, lead, blob) => {
      const parsed = parseJsonToolCall(blob.trim())
      if (parsed && recordMissed(parsed)) return lead
      return _m
    }
  )

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
  const company = (await getCompany()) || ({} as any)
  const systemPrompt = buildSystemPrompt(req.agentRole, company, req.verbList)

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
    // tool just runs BM25 and returns the hits.
    const searchArtifactsTool = tool({
      description:
        "Search the founder's own saved Library of artifacts (strategies, 90-day plans, pricing models, teardowns, etc.). Call this whenever the founder asks about something they have worked on before, asks to find a strategy, asks what they decided, or asks to look in their library — or any time grounding in their own previous work would help.",
      inputSchema: z.object({
        query: z.string().describe('Natural-language search query. The Library page uses BM25 to rank matches across titles, tags, and body content.'),
        maxResults: z.number().int().min(1).max(20).optional().describe('Max results to return (default 5).'),
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
          result = await searchArtifacts({ query, maxResults, types: types as any, pinnedOnly })
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
        const compact = result ? formatArtifactSearchResultForModel(result) : null
        const fullHits = result?.hits || []
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
      tools: { web_search: searchTool, fetch_url: fetchTool, search_artifacts: searchArtifactsTool, fetch_artifact: fetchArtifactTool },
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
    if (!supportsReasoning) {
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
  recentMessages: { role: 'user' | 'assistant'; content: string }[],
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

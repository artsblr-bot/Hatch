/**
 * In-memory search over saved artifacts.
 *
 * This is a lightweight BM25-style ranker. It does not require any external
 * service, embeddings, or network calls — perfect for a 100% client-side app.
 * The agent can call `searchArtifacts({ query })` as a tool to retrieve
 * previously saved artifacts (strategies, plans, pricing models, etc.) and
 * ground its answers in the founder's own work.
 *
 * Scoring:
 *  - tokenize on word boundaries, lowercase, strip punctuation
 *  - per-term BM25 IDF (with floor of 0 so rare terms still rank)
 *  - per-doc TF saturated at ~3 occurrences
 *  - length normalization (k1=1.5, b=0.75)
 *  - title hits weighted 3x, tag hits weighted 2x, body 1x
 *  - pinned artifacts get a small boost
 *  - recency decay so the most recently updated wins ties
 */

import { db, type Artifact } from './db'

export interface ArtifactSearchHit {
  id: string
  title: string
  type: Artifact['type']
  /** AI-generated 2-3 sentence summary (when available). The chat model sees THIS, not the body, to keep context lean. */
  summary?: string
  /** Short snippet around the best match (body field). ~200 chars. Only used by the UI; not sent to the model by default. */
  snippet: string
  /** Final score (higher is better). */
  score: number
  /** Which fields contained matches. */
  matchedFields: Array<'title' | 'tags' | 'content'>
  /** When the artifact was last updated (epoch ms). */
  updatedAt: number
  /** When the artifact was created (epoch ms). */
  createdAt: number
  /** Optional tags array (useful for the UI to surface categories). */
  tags?: string[]
  /** True if pinned. */
  pinned?: boolean
}

export interface ArtifactSearchOptions {
  query: string
  /** Cap results (default 5, max 20). */
  maxResults?: number
  /** Restrict to certain types (e.g. ['strategy', 'plan90']). Empty = all. */
  types?: Artifact['type'][]
  /** If true, only return pinned artifacts. */
  pinnedOnly?: boolean
}

export interface ArtifactSearchResult {
  hits: ArtifactSearchHit[]
  /** Total artifacts scanned. */
  scanned: number
  /** Echo of the query (helps the model cite what it asked for). */
  query: string
}

const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from',
  'has', 'have', 'in', 'is', 'it', 'of', 'on', 'or', 'that',
  'the', 'this', 'to', 'was', 'were', 'will', 'with', 'i', 'you',
  'we', 'our', 'my', 'me', 'do', 'does', 'can', 'should', 'would',
  'what', 'how', 'when', 'where', 'which', 'who', 'why', 'their',
  'they', 'them', 'his', 'her', 'its', 'about', 'into', 'over',
])

function tokenize(text: string): string[] {
  if (!text) return []
  return text
    .toLowerCase()
    .replace(/[`*_~>#\-]/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t))
}

/** Exported so the UI can highlight snippets with the same stopword-aware tokens the search used. */
export function tokenizeForSearch(text: string): string[] {
  return tokenize(text)
}

function snippetAround(text: string, queryTokens: string[]): string {
  if (!text) return ''
  const lower = text.toLowerCase()
  // Find the first token occurrence
  let best = -1
  for (const tok of queryTokens) {
    const idx = lower.indexOf(tok)
    if (idx >= 0 && (best === -1 || idx < best)) best = idx
  }
  if (best === -1) {
    return text.slice(0, 200).trim()
  }
  const start = Math.max(0, best - 60)
  const end = Math.min(text.length, best + 140)
  const head = start > 0 ? '…' : ''
  const tail = end < text.length ? '…' : ''
  return head + text.slice(start, end).replace(/\s+/g, ' ').trim() + tail
}

/**
 * Split a snippet into alternating match/non-match segments so the UI can
 * render `<mark>` around matches without needing dangerouslySetInnerHTML.
 * Case-insensitive, longest-token-first to avoid partial matches.
 */
export function highlightSnippet(snippet: string, queryTokens: string[]): Array<{ text: string; match: boolean }> {
  if (!snippet) return []
  const toks = Array.from(new Set(queryTokens.filter((t) => t.length >= 2))).sort((a, b) => b.length - a.length)
  if (toks.length === 0) return [{ text: snippet, match: false }]
  const escaped = toks.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const re = new RegExp(`(${escaped.join('|')})`, 'gi')
  const out: Array<{ text: string; match: boolean }> = []
  let last = 0
  for (const m of snippet.matchAll(re)) {
    const idx = m.index ?? 0
    if (idx > last) out.push({ text: snippet.slice(last, idx), match: false })
    out.push({ text: m[0], match: true })
    last = idx + m[0].length
  }
  if (last < snippet.length) out.push({ text: snippet.slice(last), match: false })
  return out
}

interface IndexedDoc {
  artifact: Artifact
  titleTokens: string[]
  bodyTokens: string[]
  tagTokens: string[]
  // Per-term frequency tables
  titleTf: Map<string, number>
  bodyTf: Map<string, number>
  tagTf: Map<string, number>
  // Doc length (sum of token counts with field weights)
  weightedLen: number
  // Distinct terms in doc
  docFreq: number
}

const FIELD_WEIGHT_TITLE = 3
const FIELD_WEIGHT_TAG = 2
const FIELD_WEIGHT_BODY = 1

function indexArtifact(a: Artifact): IndexedDoc {
  const titleTokens = tokenize(a.title)
  const bodyTokens = tokenize(a.content)
  const tagTokens = (a.tags || []).flatMap((t) => tokenize(t))

  const countTf = (tokens: string[]): Map<string, number> => {
    const m = new Map<string, number>()
    for (const t of tokens) m.set(t, (m.get(t) || 0) + 1)
    return m
  }

  const titleTf = countTf(titleTokens)
  const bodyTf = countTf(bodyTokens)
  const tagTf = countTf(tagTokens)

  const weightedLen =
    titleTokens.length * FIELD_WEIGHT_TITLE +
    tagTokens.length * FIELD_WEIGHT_TAG +
    bodyTokens.length * FIELD_WEIGHT_BODY

  // Union of distinct terms
  const distinct = new Set<string>()
  for (const t of titleTokens) distinct.add(t)
  for (const t of tagTokens) distinct.add(t)
  for (const t of bodyTokens) distinct.add(t)

  return {
    artifact: a,
    titleTokens,
    bodyTokens,
    tagTokens,
    titleTf,
    bodyTf,
    tagTf,
    weightedLen,
    docFreq: distinct.size,
  }
}

function computeIdf(indexed: IndexedDoc[]): Map<string, number> {
  // Document frequency per term, computed across the FULL corpus. Computing
  // this from a 1-doc corpus would collapse IDF to a constant and destroy the
  // rarity signal that distinguishes BM25 from a plain TF score.
  const totalDocs = indexed.length
  if (totalDocs === 0) return new Map()
  const df = new Map<string, number>()
  for (const doc of indexed) {
    const terms = new Set([...doc.titleTf.keys(), ...doc.tagTf.keys(), ...doc.bodyTf.keys()])
    for (const term of terms) df.set(term, (df.get(term) || 0) + 1)
  }
  const idf = new Map<string, number>()
  for (const [term, docFreq] of df) {
    // log(1 + x) so very rare terms don't blow up; the +1 keeps IDF positive
    // even for terms present in the majority of docs.
    idf.set(term, Math.log(1 + (totalDocs - docFreq + 0.5) / (docFreq + 0.5)))
  }
  return idf
}

function bm25DocScore(
  queryTf: Map<string, number>,
  doc: IndexedDoc,
  idfMap: Map<string, number>,
  avgLen: number,
  k1 = 1.5,
  b = 0.75
): number {
  let score = 0
  for (const [term, qtf] of queryTf) {
    const idf = idfMap.get(term)
    if (!idf) continue
    const tfTitle = doc.titleTf.get(term) || 0
    const tfTag = doc.tagTf.get(term) || 0
    const tfBody = doc.bodyTf.get(term) || 0
    const tf = tfTitle * FIELD_WEIGHT_TITLE + tfTag * FIELD_WEIGHT_TAG + tfBody * FIELD_WEIGHT_BODY
    if (tf === 0) continue
    const lenNorm = 1 - b + (b * doc.weightedLen) / Math.max(avgLen, 1)
    const num = tf * (k1 + 1)
    const denom = tf + k1 * lenNorm
    score += idf * (num / denom) * qtf
  }
  return score
}

/**
 * Run a search across all saved artifacts. Pulls directly from Dexie so it's
 * always consistent with the user's Library. Empty query returns the most
 * recently updated artifacts (a "browse" mode).
 */
export async function searchArtifacts(opts: ArtifactSearchOptions): Promise<ArtifactSearchResult> {
  const max = Math.max(1, Math.min(opts.maxResults ?? 5, 20))
  let artifacts = await db.artifacts.toArray()

  // Apply type filter
  if (opts.types && opts.types.length > 0) {
    const allow = new Set(opts.types)
    artifacts = artifacts.filter((a) => allow.has(a.type))
  }
  if (opts.pinnedOnly) {
    artifacts = artifacts.filter((a) => a.pinned)
  }

  const scanned = artifacts.length
  if (scanned === 0) {
    return { hits: [], scanned: 0, query: opts.query }
  }

  // Empty query: just return the most recent ones
  const trimmed = (opts.query || '').trim()
  if (!trimmed) {
    const sorted = [...artifacts]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, max)
    return {
      hits: sorted.map((a) => ({
        id: a.id,
        title: a.title,
        type: a.type,
        summary: a.summary,
        snippet: a.content.slice(0, 200).replace(/\s+/g, ' ').trim(),
        score: 0,
        matchedFields: [],
        updatedAt: a.updatedAt,
        createdAt: a.createdAt,
        tags: a.tags,
        pinned: a.pinned,
      })),
      scanned,
      query: trimmed,
    }
  }

  const queryTokens = tokenize(trimmed)
  if (queryTokens.length === 0) {
    return { hits: [], scanned, query: trimmed }
  }

  const queryTf = new Map<string, number>()
  for (const t of queryTokens) queryTf.set(t, (queryTf.get(t) || 0) + 1)

  const indexed = artifacts.map(indexArtifact)
  const avgLen = indexed.reduce((s, d) => s + d.weightedLen, 0) / Math.max(indexed.length, 1)
  const idfMap = computeIdf(indexed)

  const scored = indexed.map((doc) => {
    const baseScore = bm25DocScore(queryTf, doc, idfMap, avgLen)
    const matchedFields: Array<'title' | 'tags' | 'content'> = []
    for (const t of queryTokens) {
      if (doc.titleTf.has(t)) matchedFields.push('title')
      if (doc.tagTf.has(t)) matchedFields.push('tags')
      if (doc.bodyTf.has(t)) matchedFields.push('content')
    }
    const fields = Array.from(new Set(matchedFields))
    // If the doc has no term matches, the boosts must not promote it into the
    // results — otherwise a query that matches nothing returns the whole
    // library (because every doc gets a positive recencyBoost).
    if (baseScore === 0 && fields.length === 0) {
      return { doc, score: 0, fields }
    }
    // Field coverage bonus: hits in more fields rank higher
    const coverageBonus = fields.length * 0.4
    // Pinned boost
    const pinBonus = doc.artifact.pinned ? 0.6 : 0
    // Mild recency decay (so newer wins ties): 1 / (1 + daysSince/30)
    const daysSince = (Date.now() - doc.artifact.updatedAt) / 86_400_000
    const recencyBoost = 0.3 / (1 + daysSince / 30)
    const total = baseScore + coverageBonus + pinBonus + recencyBoost
    return { doc, score: total, fields }
  })

  const hits = scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map(({ doc, score, fields }) => ({
      id: doc.artifact.id,
      title: doc.artifact.title,
      type: doc.artifact.type,
      summary: doc.artifact.summary,
      snippet: snippetAround(doc.artifact.content, queryTokens),
      score: Math.round(score * 100) / 100,
      matchedFields: fields,
      updatedAt: doc.artifact.updatedAt,
      createdAt: doc.artifact.createdAt,
      tags: doc.artifact.tags,
      pinned: doc.artifact.pinned,
    }))

  return { hits, scanned, query: trimmed }
}

/**
 * Lightweight helper for the agent's tool call result. Returns a compact JSON
 * representation the model can read inline, plus a human-readable summary
 * snippet the UI can show.
 *
 * **Summary-first**: prefers the AI-generated `summary` field over the
 * body snippet. This keeps the tool result small (a few hundred tokens
 * per hit instead of thousands) so the model's context window doesn't
 * choke as the library grows. If no summary is available yet, falls back
 * to the short body snippet.
 */
export function formatArtifactSearchResultForModel(result: ArtifactSearchResult): {
  summary: string
  hits: Array<{
    id: string
    title: string
    type: Artifact['type']
    summary?: string
    snippet: string
    matchedFields: string[]
    score: number
  }>
  scanned: number
} {
  if (result.hits.length === 0) {
    return {
      summary: `No saved artifacts matched "${result.query}" (scanned ${result.scanned}).`,
      hits: [],
      scanned: result.scanned,
    }
  }
  return {
    summary: `Found ${result.hits.length} of ${result.scanned} saved artifact(s) for "${result.query}".`,
    hits: result.hits.map((h) => ({
      id: h.id,
      title: h.title,
      type: h.type,
      summary: h.summary,
      snippet: h.snippet,
      matchedFields: h.matchedFields,
      score: h.score,
    })),
    scanned: result.scanned,
  }
}

/**
 * Fetch a single artifact by id. Used by the model's `fetch_artifact` tool
 * when it needs the full body of a specific artifact (after `search_artifacts`
 * returned only the summary).
 */
export interface FetchedArtifact {
  id: string
  title: string
  type: Artifact['type']
  /** AI-generated compact summary, if available. */
  summary?: string
  /** Full markdown body, trimmed to `maxChars` (default 8000). */
  content: string
  /** Length of the body before trimming (in characters). */
  contentLength: number
  /** True if the body was truncated to fit. */
  truncated: boolean
  tags?: string[]
  pinned?: boolean
  updatedAt: number
}

export async function fetchArtifactById(id: string, maxChars = 8_000): Promise<FetchedArtifact | null> {
  const a = await db.artifacts.get(id)
  if (!a) return null
  const content = a.content || ''
  const truncated = content.length > maxChars
  return {
    id: a.id,
    title: a.title,
    type: a.type,
    summary: a.summary,
    content: truncated ? content.slice(0, maxChars) : content,
    contentLength: content.length,
    truncated,
    tags: a.tags,
    pinned: a.pinned,
    updatedAt: a.updatedAt,
  }
}

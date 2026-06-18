/**
 * In-memory search over saved artifacts.
 *
 * This is a BM25-style ranker tuned for **broad recall** + **body-content
 * matching** for non-technical founders. The agent can call
 * `searchArtifacts({ query })` as a tool to retrieve previously saved
 * artifacts (strategies, plans, pricing models, etc.) and ground its
 * answers in the founder's own work.
 *
 * Design goals (in order of importance):
 *  1. RECALL — if a single word in the body matches a single word in the
 *     query, surface that artifact. The model would rather see 10 near-misses
 *     than 1 perfect match and miss the rest.
 *  2. BODY-CONTENT — body matches are weighted as heavily as title matches.
 *     Non-technical founders often give artifacts a generic title (e.g.
 *     "Notes") and the actual content is in the body. The previous weighting
 *     of body=1 vs title=3 buried those.
 *  3. ROBUST — prefix matching, simple suffix-stemming, and hyphen splitting
 *     so "Hatch-2026-strategy" matches "hatch" and "2026" and "strategy".
 *  4. EXPLAINABLE — the model gets the FULL trimmed body of every hit, not
 *     just a 2-sentence summary, so it can quote, cite, and ground in detail.
 */

import { db, type Artifact } from './db'
import {
  tokenize,
  stem,
  FIELD_WEIGHT_TITLE,
  FIELD_WEIGHT_TAG,
  FIELD_WEIGHT_BODY,
} from './searchUtils'

// Re-export so existing callers (`Library.tsx`, etc.) still work.
export { tokenize as tokenizeForSearch } from './searchUtils'

export interface ArtifactSearchHit {
  id: string
  title: string
  type: Artifact['type']
  /** AI-generated 2-3 sentence summary (when available). Kept for backwards-compat with UI. */
  summary?: string
  /** Short snippet around the best match in the body. ~200 chars. */
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
  /** True if at least one match came from a prefix/substring fallback (broad recall). */
  broadRecall?: boolean
  /**
   * Debug breakdown of which query terms hit which fields. Useful for the
   * UI's "View matches" toggle and for the model to cite specific phrases.
   */
  matchDetails?: Array<{
    term: string
    fields: Array<'title' | 'tags' | 'content'>
    exact: boolean
  }>
}

export interface ArtifactSearchOptions {
  query: string
  /** Cap results (default 8, max 20). Defaults are bumped so broad queries still surface enough. */
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

/**
 * Minimal stopword set. Re-exported from `./searchUtils` so the smoke
 * tests and any other future consumer (full-text search, etc.) can
 * share the exact same tokenization.
 */
// (kept for clarity; the real STOPWORDS is imported from searchUtils)

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
  const toks = Array.from(new Set(queryTokens.filter((t) => t.length >= 1))).sort((a, b) => b.length - a.length)
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
  // Stems (for fallback matching)
  titleStems: Set<string>
  bodyStems: Set<string>
  tagStems: Set<string>
  // Per-term frequency tables
  titleTf: Map<string, number>
  bodyTf: Map<string, number>
  tagTf: Map<string, number>
  // Per-term stem frequency tables (for stem matches)
  titleStemTf: Map<string, number>
  bodyStemTf: Map<string, number>
  tagStemTf: Map<string, number>
  // Doc length (sum of token counts with field weights)
  weightedLen: number
  // Distinct terms in doc
  docFreq: number
}

function indexArtifact(a: Artifact): IndexedDoc {
  const titleTokens = tokenize(a.title)
  const bodyTokens = tokenize(a.content || '')
  const tagTokens = (a.tags || []).flatMap((t) => tokenize(t))

  const countTf = (tokens: string[]): Map<string, number> => {
    const m = new Map<string, number>()
    for (const t of tokens) m.set(t, (m.get(t) || 0) + 1)
    return m
  }

  const titleTf = countTf(titleTokens)
  const bodyTf = countTf(bodyTokens)
  const tagTf = countTf(tagTokens)

  const collectStems = (tokens: string[]): { stems: Set<string>; tf: Map<string, number> } => {
    const stems = new Set<string>()
    const tf = new Map<string, number>()
    for (const t of tokens) {
      const s = stem(t)
      stems.add(s)
      tf.set(s, (tf.get(s) || 0) + 1)
    }
    return { stems, tf }
  }

  const tStem = collectStems(titleTokens)
  const bStem = collectStems(bodyTokens)
  const gStem = collectStems(tagTokens)

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
    titleStems: tStem.stems,
    bodyStems: bStem.stems,
    tagStems: gStem.stems,
    titleTf,
    bodyTf,
    tagTf,
    titleStemTf: tStem.tf,
    bodyStemTf: bStem.tf,
    tagStemTf: gStem.tf,
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
 * BROAD RECALL tier: prefix + stem + substring fallback.
 *
 * For every query token that did NOT match in tier 1 (BM25), we try:
 *  1. Stem match (pricing → pric matches priced/prices)
 *  2. Prefix match for tokens ≥ 4 chars (strate matches strategy)
 *
 * Each broad match contributes a small score so a doc with a single
 * prefix hit doesn't outrank a doc with three exact hits, but it WILL
 * outrank a doc with zero matches. This is the "even a word matches →
 * return the whole artifact" guarantee the user asked for.
 */
function broadMatchScore(
  queryTokens: string[],
  doc: IndexedDoc
): { score: number; matches: Array<{ term: string; fields: Array<'title' | 'tags' | 'content'>; exact: boolean }> } {
  let score = 0
  const matches: Array<{ term: string; fields: Array<'title' | 'tags' | 'content'>; exact: boolean }> = []

  for (const q of queryTokens) {
    if (q.length < 2) continue
    const qStem = stem(q)
    const fields: Array<'title' | 'tags' | 'content'> = []
    let exact = true

    // 1. Stem match: a doc token whose stem equals the query stem
    for (const t of doc.titleTokens) if (stem(t) === qStem) fields.push('title')
    for (const t of doc.tagTokens) if (stem(t) === qStem) fields.push('tags')
    for (const t of doc.bodyTokens) if (stem(t) === qStem) fields.push('content')

    // 2. Prefix match (only if stem didn't already find it). For tokens ≥ 4
    //    chars, a doc token that starts with the query is a real hit.
    if (fields.length === 0 && q.length >= 4) {
      for (const t of doc.titleTokens) if (t.startsWith(q) && t !== q) fields.push('title')
      for (const t of doc.tagTokens) if (t.startsWith(q) && t !== q) fields.push('tags')
      for (const t of doc.bodyTokens) if (t.startsWith(q) && t !== q) fields.push('content')
      if (fields.length > 0) exact = false
    }

    if (fields.length > 0) {
      const uniq = Array.from(new Set(fields))
      // Stem hits are slightly stronger than prefix hits because they imply
      // a real inflectional variant. Prefix hits are weaker (could be a
      // coincidental substring like "art" matching "article" AND "artisan").
      matches.push({ term: q, fields: uniq, exact })
      const baseBoost = exact ? 0.6 : 0.3
      const fieldCount = uniq.length
      score += baseBoost * (1 + 0.2 * (fieldCount - 1))
    }
  }

  return { score, matches }
}

/**
 * Run a search across all saved artifacts. Pulls directly from Dexie so it's
 * always consistent with the user's Library. Empty query returns the most
 * recently updated artifacts (a "browse" mode).
 */
export async function searchArtifacts(opts: ArtifactSearchOptions): Promise<ArtifactSearchResult> {
  const max = Math.max(1, Math.min(opts.maxResults ?? 8, 20))
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
        snippet: (a.content || '').slice(0, 200).replace(/\s+/g, ' ').trim(),
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
    // Tier 1: exact BM25 over raw tokens
    const baseScore = bm25DocScore(queryTf, doc, idfMap, avgLen)
    const exactMatchedFields: Array<'title' | 'tags' | 'content'> = []
    for (const t of queryTokens) {
      if (doc.titleTf.has(t)) exactMatchedFields.push('title')
      if (doc.tagTf.has(t)) exactMatchedFields.push('tags')
      if (doc.bodyTf.has(t)) exactMatchedFields.push('content')
    }
    const exactFields = Array.from(new Set(exactMatchedFields))

    // Tier 2: broad recall (stem + prefix) for any token that didn't hit
    // in tier 1. This is what makes a query like "strate" still find
    // "strategy", or "pric" find "pricing" + "prices" + "priced".
    const broad = broadMatchScore(queryTokens, doc)
    // Union of fields actually matched (tier 1 + tier 2)
    const allFields = Array.from(new Set([...exactFields, ...broad.matches.flatMap((m) => m.fields)]))

    // Field coverage bonus: hits in more fields rank higher
    const coverageBonus = allFields.length * 0.5
    // Pinned boost (slightly stronger than before — pinned is the user's
    // explicit "this is the important one" signal)
    const pinBonus = doc.artifact.pinned ? 0.8 : 0
    // Mild recency decay (so newer wins ties): 1 / (1 + daysSince/30)
    const daysSince = (Date.now() - doc.artifact.updatedAt) / 86_400_000
    const recencyBoost = 0.3 / (1 + daysSince / 30)

    // Recency + pin are scored for ALL docs; the base + broad are zero for
    // non-matches. The intent is: every doc that matches SOMETHING (exact
    // OR broad) gets included; pure-noise docs are filtered by the
    // `score > 0` gate below.
    const total = baseScore + broad.score + coverageBonus + pinBonus + recencyBoost

    // Match detail (for the UI's "View matches" toggle)
    const matchDetails: Array<{ term: string; fields: Array<'title' | 'tags' | 'content'>; exact: boolean }> = []
    // Walk query tokens again to record which terms hit in tier 1
    for (const t of queryTokens) {
      const inTitle = doc.titleTf.has(t)
      const inTag = doc.tagTf.has(t)
      const inBody = doc.bodyTf.has(t)
      if (inTitle || inTag || inBody) {
        const fields: Array<'title' | 'tags' | 'content'> = []
        if (inTitle) fields.push('title')
        if (inTag) fields.push('tags')
        if (inBody) fields.push('content')
        matchDetails.push({ term: t, fields, exact: true })
      }
    }
    // Add broad matches (skip ones already covered by exact)
    for (const m of broad.matches) {
      if (!matchDetails.some((d) => d.term === m.term)) {
        matchDetails.push(m)
      }
    }

    return {
      doc,
      score: total,
      baseScore,
      broadScore: broad.score,
      fields: allFields,
      broadRecall: broad.matches.length > 0 && broad.score >= baseScore * 0.5,
      matchDetails,
    }
  })

  // Filter: every doc with ANY match (exact OR broad OR both) is included.
  // Recency/pin boosts alone can NOT push a no-match doc into the results —
  // this is critical: a query with zero matches should return 0 hits, not
  // the most-recently-updated artifact.
  const hits = scored
    .filter((s) => s.baseScore > 0 || s.broadScore > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map(({ doc, score, fields, broadRecall, matchDetails }) => ({
      id: doc.artifact.id,
      title: doc.artifact.title,
      type: doc.artifact.type,
      summary: doc.artifact.summary,
      snippet: snippetAround(doc.artifact.content || '', queryTokens),
      score: Math.round(score * 100) / 100,
      matchedFields: fields,
      updatedAt: doc.artifact.updatedAt,
      createdAt: doc.artifact.createdAt,
      tags: doc.artifact.tags,
      pinned: doc.artifact.pinned,
      broadRecall,
      matchDetails,
    }))

  return { hits, scanned, query: trimmed }
}

/**
 * Lightweight helper for the agent's tool call result. Returns a compact
 * representation the model can read inline.
 *
 * **BODY-FIRST**: unlike the previous version (which sent only the AI
 * summary), this returns the FULL markdown body of every hit (trimmed to
 * `maxCharsPerHit`, default 3000 chars). That keeps the model grounded in
 * the founder's actual content — numbers, quotes, the real plan — instead
 * of the summary's compression. The model can still call `fetch_artifact`
 * if it needs the rest.
 *
 * The `bodies` map is keyed by artifact id; it's the full body of each
 * hit, fetched in parallel by the caller (chat.ts) after the search
 * returns. We do the body fetch in the caller (not in `searchArtifacts`)
 * to keep the search engine lean for the UI's "browse" use case (Library
 * page) where we only need snippets, not full bodies.
 *
 * The `summary` (AI-generated) is included as a one-line TL;DR ahead of
 * the body so the model can skim, then drill in. The `matchedFields` +
 * `matchDetails` are included so the model can cite specific terms back
 * to the founder.
 */
export function formatArtifactSearchResultForModel(
  result: ArtifactSearchResult,
  bodies: Map<string, string> = new Map(),
  maxCharsPerHit = 3_000
): {
  summary: string
  hits: Array<{
    id: string
    title: string
    type: Artifact['type']
    /** AI-generated 2-3 sentence summary (TL;DR). */
    summary?: string
    /** Truncated full body. The model can call `fetch_artifact` for the rest. */
    content: string
    /** Length of the body before trimming. */
    contentLength: number
    /** True if the body was truncated to fit `maxCharsPerHit`. */
    truncated: boolean
    matchedFields: string[]
    matchDetails: Array<{ term: string; fields: string[]; exact: boolean }>
    pinned?: boolean
    updatedAt: number
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
  const broadCount = result.hits.filter((h) => h.broadRecall).length
  const summaryBase = `Found ${result.hits.length} of ${result.scanned} saved artifact(s) for "${result.query}".`
  const summaryNote = broadCount > 0 ? ` ${broadCount} surfaced via broad-recall (stem/prefix match).` : ''
  return {
    summary: summaryBase + summaryNote,
    hits: result.hits.map((h) => {
      const fullBody = bodies.get(h.id) ?? ''
      const truncated = fullBody.length > maxCharsPerHit
      const content = truncated ? fullBody.slice(0, maxCharsPerHit) : fullBody
      return {
        id: h.id,
        title: h.title,
        type: h.type,
        summary: h.summary,
        content,
        contentLength: fullBody.length,
        truncated,
        matchedFields: h.matchedFields,
        matchDetails: h.matchDetails || [],
        pinned: h.pinned,
        updatedAt: h.updatedAt,
        score: h.score,
      }
    }),
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

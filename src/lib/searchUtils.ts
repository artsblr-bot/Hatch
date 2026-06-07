/**
 * Pure search helpers for the artifact search engine — no Dexie, no React.
 *
 * These are split out from `artifactSearch.ts` so the smoke tests can
 * import them in plain Node (without IndexedDB) and so any future search
 * backend (e.g. full-text) can reuse the same tokenization / stemming.
 */

/**
 * Minimal English stopword set. Kept SHORT on purpose:
 *  - non-technical founders' queries are short and conversational
 *  - every word in a 1-6 keyword query is usually meaningful
 *  - false-positive drops ("show my pricing" → drop "show" because it's
 *    a stopword) hurt recall more than they help
 * Only truly function-word ones go here.
 */
export const STOPWORDS: ReadonlySet<string> = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from',
  'has', 'have', 'in', 'is', 'it', 'of', 'on', 'or', 'that',
  'the', 'this', 'to', 'was', 'were', 'will', 'with', 'i', 'you',
  'we', 'our', 'my', 'me', 'do', 'does', 'can', 'should', 'would',
  'what', 'how', 'when', 'where', 'which', 'who', 'why', 'their',
  'they', 'them', 'his', 'her', 'its', 'about', 'into', 'over',
  'so', 'if', 'than', 'then', 'these', 'those', 'any', 'all', 'some',
  'no', 'not', 'but', 'just', 'also', 'too', 'very', 'up', 'down',
])

/**
 * Split text into search tokens. Aggressive enough to be useful for
 * non-technical founders who use hyphens, slashes, and mixed punctuation
 * freely ("Hatch-2026-strategy.md", "no-code/AI-first", "v1.0 (beta)").
 *
 * Rules:
 *  - lowercase
 *  - split on whitespace AND on `-+/_.,;:()[]{}<>@#$%^&*=|` so hyphenated
 *    and slashed terms become individual searchable tokens
 *  - keep digits; allow 1-char tokens so "v", "x", "1" survive
 *  - drop tokens made only of punctuation
 *  - drop pure-stopword tokens
 */
export function tokenize(text: string): string[] {
  if (!text) return []
  return text
    .toLowerCase()
    .replace(/[`~>#]/g, ' ')
    .split(/[\s+\-/_.,;:()\[\]{}<>@#$%^&*=|"'`!?]+/)
    .filter((t) => t.length >= 1 && !STOPWORDS.has(t))
}

/**
 * Suffix-stripping stemmer. NOT Porter (overkill); just the high-yield
 * English inflectional suffixes that show up constantly in product
 * / business vocabulary:
 *   pricing   → pric
 *   priced    → pric
 *   prices    → pric
 *   running   → runn
 *   decisions → decis
 *   reviewed  → review
 *   landing   → land
 *   talking   → talk
 *   metrics   → metric
 * The output is used ONLY for the secondary index — exact match still
 * wins the highest score, stemmed match is a tie-breaker.
 */
export function stem(word: string): string {
  if (word.length <= 3) return word
  // Order matters: try longest suffix first
  const suffixes = ['ational', 'tional', 'iveness', 'fulness', 'ousness', 'ation']
  for (const s of suffixes) {
    if (word.endsWith(s) && word.length - s.length >= 3) return word.slice(0, -s.length)
  }
  if (word.endsWith('ies') && word.length > 4) return word.slice(0, -3) + 'y' // strategies → strategy
  if (word.endsWith('sses')) return word.slice(0, -2) // processes → process
  if (word.endsWith('ied')) return word.slice(0, -3) + 'y'
  if (word.endsWith('ying')) return word.slice(0, -4) + 'y'
  if (word.endsWith('ing') && word.length > 4) return word.slice(0, -3)
  if (word.endsWith('ed') && word.length > 4) return word.slice(0, -2)
  if (word.endsWith('es') && word.length > 4) return word.slice(0, -2)
  if (word.endsWith('s') && word.length > 3 && !word.endsWith('ss') && !word.endsWith('us')) {
    return word.slice(0, -1)
  }
  return word
}

/** Field weights for the BM25-style ranker in artifactSearch.ts. */
export const FIELD_WEIGHT_TITLE = 2
export const FIELD_WEIGHT_TAG = 2.5
export const FIELD_WEIGHT_BODY = 2

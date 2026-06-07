// Smoke test for the broad-recall artifact search engine.
//
// Verifies the four key guarantees of the new design:
//   1. BROAD RECALL — a single stem (e.g. "pric") still finds artifacts that
//      contain the inflected form (pricing, prices, priced).
//   2. PREFIX FALLBACK — a prefix (e.g. "strate") finds artifacts with the
//      full word (strategy, strategies).
//   3. BODY-CONTENT MATCHING — a word that's only in the body (not the title)
//      still surfaces the artifact.
//   4. NO-MATCH RETURNS ZERO — a garbage query doesn't return the whole
//      library (regression guard for the previous "everything recency-boosted"
//      bug).
//
// We test the pure scoring functions in isolation, no Dexie needed.
// The tokenize/stem functions are imported from searchUtils (the same
// module the real search engine uses), so a regression there fails here.

import { tokenize, stem } from '../src/lib/searchUtils.ts'

let passed = 0
let failed = 0
const ok = (name: string, cond: boolean, detail?: string) => {
  console.log(`${cond ? '+' : 'x'} ${name}${detail ? ` — ${detail}` : ''}`)
  cond ? passed++ : failed++
}

// ---------------------------------------------------------------------------
// Tokenization tests — these exercise the LIVE tokenize() function
// ---------------------------------------------------------------------------
ok('tokenize: lowercases', tokenize('PRICING').join(',') === 'pricing')
ok('tokenize: splits on hyphens', tokenize('Hatch-2026-Strategy').sort().join(',') === '2026,hatch,strategy')
ok('tokenize: splits on slashes', tokenize('no-code/AI-first').sort().join(',') === 'ai,code,first')
ok('tokenize: splits on underscores', tokenize('MRR_v1_beta').sort().join(',') === 'beta,mrr,v1')
ok('tokenize: splits on dots', tokenize('v1.0.0').sort().join(',') === '0,0,v1')
ok('tokenize: drops pure stopwords', tokenize('a plan for my strategy').sort().join(',') === 'plan,strategy')
ok('tokenize: keeps 1-char tokens (numbers, v, x)', tokenize('Plan X v1').sort().join(',') === 'plan,v1,x')
ok('tokenize: handles markdown heading', tokenize('# Pricing\n## Tiers').sort().join(',') === 'pricing,tiers')

// ---------------------------------------------------------------------------
// Stemmer tests — these exercise the LIVE stem() function
// ---------------------------------------------------------------------------
ok('stem: pricing → pric', stem('pricing') === 'pric')
ok('stem: prices → pric', stem('prices') === 'pric')
ok('stem: priced → pric', stem('priced') === 'pric')
ok('stem: strategy → strategy', stem('strategy') === 'strategy')
ok('stem: strategies → strategy', stem('strategies') === 'strategy')
ok('stem: decisions → decision (drop -s)', stem('decisions') === 'decision')
ok('stem: running → runn', stem('running') === 'runn')
ok('stem: reviewed → review', stem('reviewed') === 'review')
ok('stem: short word unchanged', stem('ai') === 'ai')
ok('stem: no false-stem on 3-char', stem('run') === 'run')
ok('stem: process → process (no -es drop)', stem('process') === 'process')
ok('stem: processes → process', stem('processes') === 'process')

// ---------------------------------------------------------------------------
// End-to-end-ish: simulate the search engine's match logic against an
// in-memory corpus to verify the broad-recall tier actually fires.
// Uses the LIVE tokenize() and stem() so the score reflects production.
// ---------------------------------------------------------------------------

interface Doc {
  id: string
  title: string
  tags?: string[]
  content: string
}

interface Hit {
  id: string
  title: string
  hits: string[]
  broad: boolean
}

function runSearch(corpus: Doc[], query: string): Hit[] {
  const queryTokens = tokenize(query)
  const results: Hit[] = []
  for (const d of corpus) {
    const titleTokens = tokenize(d.title)
    const bodyTokens = tokenize(d.content)
    const tagTokens = (d.tags || []).flatMap(tokenize)
    const hitTerms: string[] = []
    let broad = false
    for (const q of queryTokens) {
      if (titleTokens.includes(q) || bodyTokens.includes(q) || tagTokens.includes(q)) {
        hitTerms.push(q)
        continue
      }
      // stem
      const qStem = stem(q)
      if (
        titleTokens.some((x) => stem(x) === qStem) ||
        bodyTokens.some((x) => stem(x) === qStem) ||
        tagTokens.some((x) => stem(x) === qStem)
      ) {
        hitTerms.push(q)
        broad = true
        continue
      }
      // prefix
      if (q.length >= 4) {
        if (
          titleTokens.some((x) => x.startsWith(q) && x !== q) ||
          bodyTokens.some((x) => x.startsWith(q) && x !== q) ||
          tagTokens.some((x) => x.startsWith(q) && x !== q)
        ) {
          hitTerms.push(q)
          broad = true
        }
      }
    }
    if (hitTerms.length > 0) results.push({ id: d.id, title: d.title, hits: hitTerms, broad })
  }
  return results
}

const corpus: Doc[] = [
  { id: '1', title: 'Pricing model v1', tags: ['pricing'], content: 'We use a freemium model with three tiers. The pro tier costs $19/mo.' },
  { id: '2', title: 'Strategy', tags: ['strategy'], content: 'Our wedge is the only multi-agent team that remembers the founder\'s full library of artifacts.' },
  { id: '3', title: 'Q1 plan', tags: [], content: 'The 90-day plan focuses on shipping the artifact search tool.' },
  { id: '4', title: 'Notes', tags: [], content: 'Founder MRR is $0. Need to get to $1k MRR by end of Q1.' },
  { id: '5', title: 'Untitled', tags: [], content: 'The decisions we made: pivot to B2B. Drop the consumer plan.' },
  { id: '6', title: 'Hatch — 2026 strategy', tags: ['go-to-market'], content: 'Positioning: for non-technical first-time founders. ICP: 28-40, US/UK/India.' },
  { id: '7', title: 'Hatch AI strategy', tags: ['go-to-market'], content: '2026 strategy: ship Hatch as a multi-agent team. We must hit 100 paying founders.' },
  { id: '8', title: 'Hatch pricing', tags: ['pricing'], content: 'Free / Pro $19 / Team $49.' },
  { id: '9', title: 'Untitled 2', tags: [], content: 'How we price: freemium with a 14-day trial.' },
]

// 1. Stem fallback: "pric" should find the pricing docs
{
  const r = runSearch(corpus, 'pric')
  ok('stem "pric" finds pricing doc 1', r.some((x) => x.id === '1'), `hits: ${r.map((x) => x.title).join(', ')}`)
  ok('stem "pric" finds pricing doc 8', r.some((x) => x.id === '8'))
  ok('stem "pric" is flagged broad', r.find((x) => x.id === '1')?.broad === true)
}

// 2. Prefix fallback: "strate" should find strategy docs
{
  const r = runSearch(corpus, 'strate')
  ok('prefix "strate" finds strategy doc 2', r.some((x) => x.id === '2'))
  ok('prefix "strate" finds hatch 2026 strategy doc 6', r.some((x) => x.id === '6'))
  ok('prefix "strate" is flagged broad', r.find((x) => x.id === '2')?.broad === true)
}

// 3. Body-content match: "MRR" is only in the body of doc 4
{
  const r = runSearch(corpus, 'MRR')
  ok('body-only "MRR" finds doc 4', r.some((x) => x.id === '4'))
  ok('body-only "MRR" is NOT broad (exact match)', r.find((x) => x.id === '4')?.broad === false)
}

// 4. Body-content match: "freemium" is in body of doc 1
{
  const r = runSearch(corpus, 'freemium')
  ok('body "freemium" finds pricing doc 1', r.some((x) => x.id === '1'))
  ok('body "freemium" finds doc 9 (how we price)', r.some((x) => x.id === '9'))
}

// 5. Body-content match: "decisions" is in body of doc 5
{
  const r = runSearch(corpus, 'decisions')
  ok('body "decisions" finds doc 5', r.some((x) => x.id === '5'))
}

// 6. No-match returns zero
{
  const r = runSearch(corpus, 'qzxwcnvbnm')
  ok('no-match "qzxwcnvbnm" returns 0', r.length === 0, `got: ${r.length}`)
}

// 7. Multi-word: "strategy 2026" finds hatch doc
{
  const r = runSearch(corpus, 'strategy 2026')
  ok('multi "strategy 2026" finds hatch doc 6', r.some((x) => x.id === '6'))
  ok('multi "strategy 2026" finds hatch doc 7', r.some((x) => x.id === '7'))
}

// 8. Stem + exact combo: "priced" finds "pricing"
{
  const r = runSearch(corpus, 'priced')
  ok('stem "priced" finds pricing doc 1', r.some((x) => x.id === '1'))
  ok('stem "priced" finds pricing doc 8', r.some((x) => x.id === '8'))
}

// 9. The OLD bug: "no matches" used to return the whole library. Verify it doesn't.
{
  const r = runSearch(corpus, 'zzzzz')
  ok('garbage query "zzzzz" returns 0 (NOT the whole library)', r.length === 0, `got: ${r.length}`)
}

// 10. Prefix doesn't accidentally match unrelated substrings
{
  const r = runSearch(corpus, 'strate')
  ok('prefix "strate" does NOT match doc 4 (no strate* words)', !r.some((x) => x.id === '4'))
}

// 11. Exact short-token match is allowed (the new tokenizer keeps 1-char tokens
//     so "v" / "x" / "1" survive, but the broad tier skips them)
{
  const r = runSearch(corpus, 'v1')
  ok('exact "v1" is allowed (length-2 token)', r.some((x) => x.id === '1'), `hits: ${r.map((x) => x.title).join(', ')}`)
}

// 12. Hyphenated: "no-code" → tokenize to ["code"] (no is stopword) — verifies
//     the new hyphen-split tokenizer, not the old whitespace-only one.
{
  const toks = tokenize('no-code')
  ok('hyphenated "no-code" produces ["code"]', toks.join(',') === 'code', `got: [${toks.join(',')}]`)
}

// 13. Title with hyphen: "Hatch-2026-strategy" tokenizes so all three words
//     can be searched independently
{
  const toks = tokenize('Hatch-2026-strategy')
  ok('hyphenated "Hatch-2026-strategy" tokenizes to 3 words', toks.length === 3 && toks.includes('hatch') && toks.includes('2026') && toks.includes('strategy'), `got: [${toks.join(',')}]`)
}

// 14. A short prefix (3 chars) does NOT trigger prefix fallback (gate is
//     length >= 4). This prevents "art" from matching "article" + "artisan"
//     + "artist" across the library.
{
  const r = runSearch(corpus, 'art')
  ok('prefix "art" (3 chars) does NOT trigger broad fallback', r.length === 0 || r.every((x) => !x.broad), `got: ${r.length}`)
}

console.log(`\n${passed}/${passed + failed} passed`)
process.exit(failed === 0 ? 0 : 1)

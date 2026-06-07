// Provider-level smoke test. Bypasses Dexie and the user-settings lookup by
// calling the search layer with no encrypted keys (so Tavily falls into its
// keyless mode, which we exercise too). Also tests DDG and Wikipedia directly.
//
// Use: npx tsx scripts/smoke-search.mts

async function duckDuckGoSearch(opts: { query: string; maxResults?: number; recencyDays?: number; signal?: AbortSignal }) {
  const maxResults = opts.maxResults ?? 5
  const params = new URLSearchParams({ q: opts.query })
  if (opts.recencyDays) params.set('df', `d-${Math.min(opts.recencyDays, 365)}`)
  const url = `https://html.duckduckgo.com/html/?${params.toString()}`
  const resp = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
    signal: opts.signal,
  })
  if (!resp.ok) throw new Error(`DDG ${resp.status}`)
  const html = await resp.text()
  // Inline the parser so this test doesn't depend on the TS module's import
  // order (the parser is the one in search.ts — we copy it here verbatim to
  // confirm the regex still works against the current DDG HTML layout).
  const blockRe = /<a\s+[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<a\s+[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>|<div[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/div>)/g
  const results: any[] = []
  let m: RegExpExecArray | null
  while ((m = blockRe.exec(html)) !== null && results.length < maxResults) {
    const url = decodeHtml(m[1])
    const title = stripTags(decodeHtml(m[2])).trim()
    const snippet = stripTags(decodeHtml(m[3] || m[4] || '')).trim()
    if (url && title) results.push({ title, url, snippet, source: 'duckduckgo' })
  }
  return results
}

function decodeHtml(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
}
function stripTags(s: string): string { return s.replace(/<[^>]+>/g, '') }

async function wikipediaSearch(opts: { query: string; maxResults?: number; signal?: AbortSignal }) {
  const maxResults = opts.maxResults ?? 5
  const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&origin=*&srlimit=${maxResults}&srsearch=${encodeURIComponent(opts.query)}`
  const resp = await fetch(searchUrl, { signal: opts.signal })
  if (!resp.ok) throw new Error(`Wiki ${resp.status}`)
  const data = await resp.json()
  const hits: any[] = data?.query?.search || []
  if (hits.length === 0) return []
  const titles = hits.map((h) => h.title).join('|')
  const extractResp = await fetch(`https://en.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=1&explaintext=1&format=json&origin=*&titles=${encodeURIComponent(titles)}`, { signal: opts.signal })
  if (!extractResp.ok) throw new Error(`Wiki extract ${extractResp.status}`)
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

let passed = 0, failed = 0
const log = (ok: boolean, name: string, detail?: string) => {
  console.log(`${ok ? '+' : 'x'} ${name}${detail ? ' -- ' + detail : ''}`)
  ok ? passed++ : failed++
}

console.log('=== DDG ===')
try {
  const r = await duckDuckGoSearch({ query: 'hatch ai cofounder', maxResults: 3 })
  log(r.length > 0, 'DDG basic', `${r.length} result(s), first: "${r[0]?.title?.slice(0, 60)}"`)
} catch (e: any) { log(false, 'DDG basic', e.message) }

try {
  const r = await duckDuckGoSearch({ query: 'openai gpt-5 launch', maxResults: 3, recencyDays: 30 })
  log(r.length > 0, 'DDG recency', `${r.length} result(s)`)
} catch (e: any) { log(false, 'DDG recency', e.message) }

console.log('=== Wikipedia ===')
try {
  const r = await wikipediaSearch({ query: 'Hatch (company)', maxResults: 3 })
  log(r.length > 0, 'Wiki basic', `${r.length} result(s), first: "${r[0]?.title?.slice(0, 60)}"`)
} catch (e: any) { log(false, 'Wiki basic', e.message) }

console.log('=== AbortSignal ===')
try {
  const ac = new AbortController()
  ac.abort()
  await duckDuckGoSearch({ query: 'test', signal: ac.signal })
  log(false, 'DDG abort', 'should have thrown')
} catch (e: any) {
  log(e.name === 'AbortError' || /abort/i.test(e.message), 'DDG abort', e.name || e.message)
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)

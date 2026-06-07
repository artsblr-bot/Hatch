// Smoke test for rerunMissedToolCall — the new API for re-running
// a tool call that the model wrote in prose (the "missed call" row).
// 
// We test the pure-dispatch and shape-contract parts in Node (no Dexie
// dependency). web_search / search_artifacts are skipped in Node because
// they need IndexedDB to read settings. fetch_url works fine.

import { rerunMissedToolCall } from '../src/lib/chat'

let passed = 0
let failed = 0
const ok = (name: string, cond: boolean, detail?: string) => {
  console.log(`${cond ? '+' : 'x'} ${name}${detail ? ` — ${detail}` : ''}`)
  cond ? passed++ : failed++
}

// Test 1: unknown tool name returns structured error
{
  const r = await rerunMissedToolCall({ name: 'shell_exec', args: { cmd: 'rm -rf /' } })
  ok('unknown-tool: name preserved', r.name === 'shell_exec')
  ok('unknown-tool: status is error', r.status === 'error')
  ok('unknown-tool: error message mentions Unknown', 'error' in (r as any).result && (r as any).result.error.includes('Unknown'))
}

// Test 2: fetch_url works against a real URL (example.com)
{
  const r = await rerunMissedToolCall({ name: 'fetch_url', args: { url: 'https://example.com' } })
  ok('fetch_url: name preserved', r.name === 'fetch_url')
  ok('fetch_url: status is ok', r.status === 'ok', `got ${r.status} (${(r.result as any).error})`)
  const result = r.result as any
  ok('fetch_url: url is preserved', result.url === 'https://example.com/')
  ok('fetch_url: byteLength is positive', result.byteLength > 0)
  ok('fetch_url: text is a non-empty string', typeof result.text === 'string' && result.text.length > 0)
  ok('fetch_url: tookMs is a number', typeof result.tookMs === 'number')
}

// Test 3: fetch_url with malformed URL returns an error result (doesn't throw)
{
  const r = await rerunMissedToolCall({ name: 'fetch_url', args: { url: 'not-a-url' } })
  ok('fetch_url-malformed: name preserved', r.name === 'fetch_url')
  ok('fetch_url-malformed: status is error', r.status === 'error')
  ok('fetch_url-malformed: result has error message', 'error' in (r.result as any))
}

// Test 4: fetch_url with AbortSignal — pre-aborted controller
{
  const ac = new AbortController()
  ac.abort()
  try {
    const r = await rerunMissedToolCall({ name: 'fetch_url', args: { url: 'https://example.com' }, signal: ac.signal })
    ok('fetch_url-preaborted: returns error result (no throw)', r.status === 'error')
  } catch (e: any) {
    // It's OK if the implementation throws AbortError here; we just want
    // it not to hang or return a fake success.
    ok('fetch_url-preaborted: throws AbortError (acceptable)', e?.name === 'AbortError', `got ${e?.name}`)
  }
}

// Test 5: web_search dispatches the right path (will fail in Node due to
// IndexedDB, but the shape contract should still be respected)
{
  const r = await rerunMissedToolCall({ name: 'web_search', args: { query: 'test', topic: 'news', recencyDays: '7' } })
  ok('web_search: name preserved', r.name === 'web_search')
  ok('web_search: returns web_search result shape', r.status === 'error' || r.status === 'ok')
  // The result should have the web_search-specific fields
  const result = r.result as any
  ok('web_search: result has fullResults array', Array.isArray(result.fullResults))
  ok('web_search: result has count field', typeof result.count === 'number')
  ok('web_search: result has source field', typeof result.source === 'string')
  ok('web_search: result has query field', result.query === 'test')
  ok('web_search: result has topic field', result.topic === 'news')
  ok('web_search: result has recencyDays resolved to number 7', result.recencyDays === 7)
}

// Test 6: search_artifacts dispatches the right path
{
  const r = await rerunMissedToolCall({ name: 'search_artifacts', args: { query: 'pricing' } })
  ok('search_artifacts: name preserved', r.name === 'search_artifacts')
  const result = r.result as any
  ok('search_artifacts: result has summary string', typeof result.summary === 'string')
  ok('search_artifacts: result has hits array', Array.isArray(result.hits))
  ok('search_artifacts: result has fullHits array', Array.isArray(result.fullHits))
  ok('search_artifacts: result has scanned field', typeof result.scanned === 'number')
}

// Test 7: fetch_artifact dispatches the right path
{
  const r = await rerunMissedToolCall({ name: 'fetch_artifact', args: { id: 'nonexistent' } })
  ok('fetch_artifact: name preserved', r.name === 'fetch_artifact')
  ok('fetch_artifact: status is error for nonexistent id', r.status === 'error')
  const result = r.result as any
  ok('fetch_artifact: result has error message', typeof result.error === 'string')
}

// Test 8: empty args for web_search doesn't crash
{
  try {
    const r = await rerunMissedToolCall({ name: 'web_search', args: {} })
    ok('web_search-empty-args: returns result without throwing', true, `status=${r.status}`)
  } catch (e: any) {
    ok('web_search-empty-args: graceful (acceptable)', e?.name !== 'TypeError')
  }
}

console.log(`\n${passed}/${passed + failed} passed`)
process.exit(failed > 0 ? 1 : 0)

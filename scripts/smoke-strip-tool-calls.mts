// Smoke test for the stripTextBasedToolCalls() regex/post-processor.
// Some smaller open-source models (Hermes, NousResearch, etc.) write tool
// calls in prose instead of invoking them via the API. The chat engine
// must detect and remove these from the final text and surface them as
// synthetic "missed tool call" records.
// Use: npx tsx scripts/smoke-strip-tool-calls.mts

import { stripTextBasedToolCalls } from '../src/lib/chat'

let passed = 0
let failed = 0
const ok = (name: string, cond: boolean, detail?: string) => {
  console.log(`${cond ? '+' : 'x'} ${name}${detail ? ` — ${detail}` : ''}`)
  cond ? passed++ : failed++
}

// Test 1: The exact pattern from the screenshot — angle-backslash + double-escape
{
  const input = `Let me search the web for that.\n\n<function\\\\web_search {"query": "digital fashion brand competitors", "recencyDays": "30", "topic": "news"}}></function>\n\nI will synthesize the results.`
  const { clean, missed } = stripTextBasedToolCalls(input)
  ok('angle-backslash: text is stripped', !clean.includes('<function'), `clean="${clean}"`)
  ok('angle-backslash: clean retains surrounding prose', clean.includes('Let me search the web for that.') && clean.includes('I will synthesize the results.'))
  ok('angle-backslash: 1 missed call recorded', missed.length === 1, `got ${missed.length}`)
  ok('angle-backslash: name is web_search', missed[0]?.name === 'web_search')
  ok('angle-backslash: args.query is preserved', missed[0]?.args?.query === 'digital fashion brand competitors')
  ok('angle-backslash: args.recencyDays is preserved', missed[0]?.args?.recencyDays === '30')
  ok('angle-backslash: args.topic is preserved', missed[0]?.args?.topic === 'news')
  ok('angle-backslash: pseudoId is __missed_0__', missed[0]?.pseudoId === '__missed_0__')
}

// Test 2: Single-backslash variant (less aggressive escaping)
{
  const input = `Searching now.\n\n<function\\web_search {"query": "hatch competitors"}></function>\n\nDone.`
  const { clean, missed } = stripTextBasedToolCalls(input)
  ok('single-backslash: text is stripped', !clean.includes('<function'))
  ok('single-backslash: 1 missed call recorded', missed.length === 1)
  ok('single-backslash: name is web_search', missed[0]?.name === 'web_search')
  ok('single-backslash: query preserved', missed[0]?.args?.query === 'hatch competitors')
}

// Test 3: OpenAI-style <tool_call> wrapper
{
  const input = `Here you go:\n<tool_call>\n{"name": "fetch_url", "arguments": {"url": "https://example.com/pricing"}}\n</tool_call>\nAfter reading, I would say...`
  const { clean, missed } = stripTextBasedToolCalls(input)
  ok('tool_call-xml: wrapper is stripped', !clean.includes('tool_call'))
  ok('tool_call-xml: 1 missed call recorded', missed.length === 1)
  ok('tool_call-xml: name is fetch_url', missed[0]?.name === 'fetch_url')
  ok('tool_call-xml: url preserved', missed[0]?.args?.url === 'https://example.com/pricing')
}

// Test 4: [FUNCTION_CALL] wrapper
{
  const input = `[FUNCTION_CALL]{"name": "search_artifacts", "arguments": {"query": "pricing strategy"}}[/FUNCTION_CALL]`
  const { clean, missed } = stripTextBasedToolCalls(input)
  ok('bracket-fn: wrapper is stripped', !clean.includes('FUNCTION_CALL'))
  ok('bracket-fn: 1 missed call recorded', missed.length === 1)
  ok('bracket-fn: name is search_artifacts', missed[0]?.name === 'search_artifacts')
  ok('bracket-fn: query preserved', missed[0]?.args?.query === 'pricing strategy')
}

// Test 5: Bare JSON (no wrapper) on its own line
{
  const input = `Some prose.\n\n{"name": "web_search", "arguments": {"query": "AI news 2026"}}\n\nMore prose.`
  const { clean, missed } = stripTextBasedToolCalls(input)
  ok('bare-json: JSON is stripped', !clean.includes('"name"'))
  ok('bare-json: surrounding prose preserved', clean.includes('Some prose.') && clean.includes('More prose.'))
  ok('bare-json: 1 missed call recorded', missed.length === 1)
  ok('bare-json: name is web_search', missed[0]?.name === 'web_search')
  ok('bare-json: query preserved', missed[0]?.args?.query === 'AI news 2026')
}

// Test 6: Multiple missed calls in one response
{
  const input = `<function\\web_search {"query": "first"}></function>\n\nSome text.\n\n<tool_call>\n{"name": "search_artifacts", "arguments": {"query": "library query"}}\n</tool_call>\nMore text.\n\n<function\\fetch_url {"url": "https://example.com"}></function>`
  const { clean, missed } = stripTextBasedToolCalls(input)
  ok('multi: 3 missed calls recorded', missed.length === 3, `got ${missed.length}`)
  ok('multi: no function-call syntax remains', !clean.includes('<function') && !clean.includes('tool_call'))
  ok('multi: surrounding prose preserved', clean.includes('Some text.') && clean.includes('More text.'))
  ok('multi: pseudoIds are unique', new Set(missed.map((m) => m.pseudoId)).size === 3)
}

// Test 7: Unknown tool name is NOT stripped (we only know about our 3 tools)
{
  const input = `I will now call: <function\\shell_exec {"cmd": "ls -la"}></function>`
  const { clean, missed } = stripTextBasedToolCalls(input)
  ok('unknown-tool: text is NOT stripped (we do not know this tool)', clean.includes('<function'))
  ok('unknown-tool: no missed call recorded', missed.length === 0)
}

// Test 8: Empty / no-match inputs are returned unchanged
{
  const a = stripTextBasedToolCalls('')
  ok('empty input: clean is empty', a.clean === '')
  ok('empty input: no missed calls', a.missed.length === 0)

  const b = stripTextBasedToolCalls('Just a normal answer with no tool calls.')
  ok('no-match input: text is unchanged', b.clean === 'Just a normal answer with no tool calls.')
  ok('no-match input: no missed calls', b.missed.length === 0)
}

// Test 9: Prose that MENTIONS the tool name is not stripped
{
  const input = `You can use the web_search tool, but in this case I will answer from memory.`
  const { clean, missed } = stripTextBasedToolCalls(input)
  ok('prose-mention: text is unchanged', clean === input)
  ok('prose-mention: no missed calls', missed.length === 0)
}

// Test 10: "arguments" alias "args" works
{
  const input = `<function\\web_search {"args": {"query": "hatch 2026"}}></function>`
  const { missed } = stripTextBasedToolCalls(input)
  ok('args-alias: 1 missed call', missed.length === 1)
  ok('args-alias: query preserved via args key', missed[0]?.args?.query === 'hatch 2026')
}

// Test 11: OpenAI-style <function_calls>[{...}]</function_calls>
{
  const input = `Let me look that up.\n\n<function_calls>[{"name": "web_search", "arguments": {"query": "openai api pricing 2026"}}]</function_calls>\n\nHere you go.`
  const { clean, missed } = stripTextBasedToolCalls(input)
  ok('function_calls-array: wrapper is stripped', !clean.includes('<function_calls>'))
  ok('function_calls-array: 1 missed call', missed.length === 1)
  ok('function_calls-array: name is web_search', missed[0]?.name === 'web_search')
  ok('function_calls-array: query preserved', missed[0]?.args?.query === 'openai api pricing 2026')
  ok('function_calls-array: prose retained', clean.includes('Let me look that up.') && clean.includes('Here you go.'))
}

// Test 12: code-fenced JSON tool call
{
  const input = `Reading the page now.\n\n\`\`\`json\n{"name": "fetch_url", "arguments": {"url": "https://anthropic.com"}}\n\`\`\`\n\nAfter reading...`
  const { clean, missed } = stripTextBasedToolCalls(input)
  ok('code-fenced-json: code fence stripped', !clean.includes('```'))
  ok('code-fenced-json: 1 missed call', missed.length === 1)
  ok('code-fenced-json: name is fetch_url', missed[0]?.name === 'fetch_url')
  ok('code-fenced-json: url preserved', missed[0]?.args?.url === 'https://anthropic.com')
}

// Test 13: bare JSON ARRAY of tool calls (Pattern 8)
{
  const input = `Prose.\n\n[{"name": "search_artifacts", "arguments": {"query": "growth plan"}}, {"name": "web_search", "arguments": {"query": "tam 2026"}}]\n\nMore prose.`
  const { clean, missed } = stripTextBasedToolCalls(input)
  ok('bare-json-array: 2 missed calls', missed.length === 2, `got ${missed.length}`)
  ok('bare-json-array: array removed from text', !clean.includes('"name"'))
  ok('bare-json-array: both names detected', missed.map((m) => m.name).sort().join(',') === 'search_artifacts,web_search')
  ok('bare-json-array: prose preserved', clean.includes('Prose.') && clean.includes('More prose.'))
}

// Test 14: <output> and <response> wrappers
{
  const a = stripTextBasedToolCalls(`<output>{"name": "web_search", "arguments": {"query": "ai news"}}</output>`)
  ok('output-tag: 1 missed call', a.missed.length === 1)
  ok('output-tag: query preserved', a.missed[0]?.args?.query === 'ai news')

  const b = stripTextBasedToolCalls(`<response>{"name": "fetch_url", "arguments": {"url": "https://x.com"}}</response>`)
  ok('response-tag: 1 missed call', b.missed.length === 1)
  ok('response-tag: url preserved', b.missed[0]?.args?.url === 'https://x.com')
}

// Test 15: <function_calls> with multiple tool calls in one array
{
  const input = `Let me check.\n\n<function_calls>[{"name": "web_search", "arguments": {"query": "stripe fees"}}, {"name": "fetch_url", "arguments": {"url": "https://stripe.com/pricing"}}]</function_calls>\n\nDone.`
  const { clean, missed } = stripTextBasedToolCalls(input)
  ok('function_calls-multi: wrapper stripped', !clean.includes('<function_calls>'))
  ok('function_calls-multi: 2 missed calls', missed.length === 2, `got ${missed.length}`)
  ok('function_calls-multi: both names detected', missed.map((m) => m.name).sort().join(',') === 'fetch_url,web_search')
  ok('function_calls-multi: both queries preserved', missed.find((m) => m.name === 'web_search')?.args?.query === 'stripe fees' && missed.find((m) => m.name === 'fetch_url')?.args?.url === 'https://stripe.com/pricing')
  ok('function_calls-multi: prose preserved', clean.includes('Let me check.') && clean.includes('Done.'))
}

// Test 16: code fence with a JSON object that has NESTED braces
{
  const input = `Reading the page.\n\n\`\`\`json\n{"name": "fetch_url", "arguments": {"url": "https://example.com", "headers": {"User-Agent": "test"}}}\n\`\`\`\n\nAfter reading.`
  const { clean, missed } = stripTextBasedToolCalls(input)
  ok('code-fence-nested: fence stripped', !clean.includes('```'))
  ok('code-fence-nested: 1 missed call', missed.length === 1)
  ok('code-fence-nested: url preserved (with nested args)', missed[0]?.args?.url === 'https://example.com')
  ok('code-fence-nested: nested headers preserved', missed[0]?.args?.headers?.['User-Agent'] === 'test')
}

// Test 17: code fence with a tool-call ARRAY (not just an object)
{
  const input = `Searching both.\n\n\`\`\`json\n[{"name": "web_search", "arguments": {"query": "q1"}}, {"name": "search_artifacts", "arguments": {"query": "q2"}}]\n\`\`\`\n\nHere.`
  const { clean, missed } = stripTextBasedToolCalls(input)
  ok('code-fence-array: fence stripped', !clean.includes('```'))
  ok('code-fence-array: 2 missed calls', missed.length === 2, `got ${missed.length}`)
  ok('code-fence-array: both names detected', missed.map((m) => m.name).sort().join(',') === 'search_artifacts,web_search')
  ok('code-fence-array: prose preserved', clean.includes('Searching both.') && clean.includes('Here.'))
}

// Test 15: REAL-WORLD user scenario — model emits "let me search" prose
// followed by a missed tool call followed by an answer from memory
{
  const input = `Let me search the web for that.

<function\\web_search {"query": "hatch competitors 2026", "topic": "news", "recencyDays": "30"}></function>

Based on what I know, Hatch is competing with:
1. ExampleCo
2. OtherInc

I should have searched though!`
  const { clean, missed } = stripTextBasedToolCalls(input)
  ok('user-scenario: function syntax removed', !clean.includes('<function'))
  ok('user-scenario: pre-prose preserved', clean.includes('Let me search the web for that.'))
  ok('user-scenario: post-prose preserved', clean.includes('Hatch is competing with'))
  ok('user-scenario: 1 missed call', missed.length === 1)
  ok('user-scenario: name is web_search', missed[0]?.name === 'web_search')
  ok('user-scenario: query preserved', missed[0]?.args?.query === 'hatch competitors 2026')
  ok('user-scenario: topic preserved', missed[0]?.args?.topic === 'news')
  ok('user-scenario: recencyDays preserved', missed[0]?.args?.recencyDays === '30')
  ok('user-scenario: pseudoId assigned', missed[0]?.pseudoId?.startsWith('__missed_'))
}

console.log(`\n${passed}/${passed + failed} passed`)
process.exit(failed > 0 ? 1 : 0)

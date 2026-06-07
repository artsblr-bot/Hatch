// Unit-style test of runChat's tool pipeline: we recreate the step-id
// claiming and abort-throwing pattern from chat.ts in isolation, since the
// full runChat depends on Dexie + the LLM provider stack.
// Use: npx tsx scripts/test-runchat-pipeline.mts

import { z } from 'zod'
import { tool } from 'ai'

let stepCounter = 0
const toolStepIds = new Map<string, string>()
const claimStepId = (toolCallId: string, label: string) => {
  const existing = toolStepIds.get(toolCallId)
  if (existing) return existing
  const id = `s${++stepCounter}-${label}`
  toolStepIds.set(toolCallId, id)
  return id
}

const emittedSteps: any[] = []
const emitStep = (step: any) => { emittedSteps.push(step) }
const emittedToolCalls: any[] = []
const onToolCall = (call: any) => { emittedToolCalls.push(call) }

const searchTool = tool({
  description: 'Test search',
  inputSchema: z.object({ query: z.string() }),
  onInputAvailable: ({ input, toolCallId }) => {
    onToolCall({ toolCallId, name: 'web_search', args: input, status: 'pending' })
    emitStep({ id: claimStepId(toolCallId, 'search'), label: 'Searching the web', status: 'active', detail: input.query })
  },
  execute: async ({ query }, options) => {
    const stepId = claimStepId(options.toolCallId, 'search')
    if (options.abortSignal?.aborted) {
      emitStep({ id: stepId, label: 'Searching the web', status: 'done', detail: 'aborted' })
      throw new DOMException('Aborted', 'AbortError')
    }
    await new Promise((r) => setTimeout(r, 50))
    if (options.abortSignal?.aborted) {
      emitStep({ id: stepId, label: 'Searching the web', status: 'done', detail: 'aborted' })
      throw new DOMException('Aborted', 'AbortError')
    }
    onToolCall({ toolCallId: options.toolCallId, name: 'web_search', args: { query }, result: { count: 3 }, status: 'ok' })
    emitStep({ id: stepId, label: 'Searching the web', status: 'done', detail: '3 results' })
    return { results: [], count: 3, query }
  },
})

let passed = 0, failed = 0
const ok = (name: string, cond: boolean) => { console.log(`${cond ? '+' : 'x'} ${name}`); cond ? passed++ : failed++ }

// Test 1: execute alone produces 1 'done' step (no onInputAvailable)
stepCounter = 0; toolStepIds.clear(); emittedSteps.length = 0
await searchTool.execute!({ query: 'direct' }, { toolCallId: 'tc-1', abortSignal: new AbortController().signal, messages: [] })
ok('execute-only produces 1 step', emittedSteps.length === 1)
ok('execute-only step is done', emittedSteps[0]?.status === 'done')

// Test 2: onInputAvailable + execute share the same step id
stepCounter = 0; toolStepIds.clear(); emittedSteps.length = 0
if (searchTool.onInputAvailable) {
  await searchTool.onInputAvailable({ input: { query: 'shared' }, toolCallId: 'tc-2', messages: [] })
}
await searchTool.execute!({ query: 'shared' }, { toolCallId: 'tc-2', abortSignal: new AbortController().signal, messages: [] })
ok('shared-step has 2 events (active, done)', emittedSteps.length === 2)
ok('shared-step ids match', emittedSteps.length === 2 && emittedSteps[0].id === emittedSteps[1].id)
ok('shared-step transitions active->done', emittedSteps[0]?.status === 'active' && emittedSteps[1]?.status === 'done')

// Test 3: pre-aborted signal throws immediately
stepCounter = 0; toolStepIds.clear(); emittedSteps.length = 0
const ac3 = new AbortController(); ac3.abort()
try {
  await searchTool.execute!({ query: 'pre-abort' }, { toolCallId: 'tc-3', abortSignal: ac3.signal, messages: [] })
  ok('pre-abort throws', false)
} catch (e: any) {
  ok('pre-abort throws AbortError', e.name === 'AbortError')
  ok('pre-abort emits done/aborted', emittedSteps.length === 1 && emittedSteps[0].status === 'done' && emittedSteps[0].detail === 'aborted')
}

// Test 4: abort mid-execution
stepCounter = 0; toolStepIds.clear(); emittedSteps.length = 0
const ac4 = new AbortController()
setTimeout(() => ac4.abort(), 10)
try {
  await searchTool.execute!({ query: 'mid-abort' }, { toolCallId: 'tc-4', abortSignal: ac4.signal, messages: [] })
  ok('mid-abort throws', false)
} catch (e: any) {
  ok('mid-abort throws AbortError', e.name === 'AbortError')
  ok('mid-abort emits done/aborted', emittedSteps.some((s: any) => s.detail === 'aborted'))
}

console.log(`\n${passed}/${passed + failed} passed`)
process.exit(failed > 0 ? 1 : 0)

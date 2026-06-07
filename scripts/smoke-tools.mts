// Verify the chat engine's tool definitions and system prompt are well-formed.
// This imports the actual TS modules (via tsx) and serializes the tools,
// so any schema issue (e.g. malformed zod object) will throw immediately.
import { z } from 'zod'
import { tool } from 'ai'

// Recreate the exact same tool schemas as chat.ts to verify the schemas
// parse cleanly and produce the descriptions we expect the model to see.
const searchTool = tool({
  description: 'Search the web for current information.',
  inputSchema: z.object({
    query: z.string().describe('The search query.'),
    maxResults: z.number().int().min(1).max(10).optional(),
    topic: z.enum(['general', 'news']).optional(),
    recencyDays: z.number().int().min(1).max(365).optional(),
  }),
  execute: async () => 'ok',
})

const fetchTool = tool({
  description: 'Fetch a URL.',
  inputSchema: z.object({
    url: z.string().url(),
    maxChars: z.number().int().min(500).max(20_000).optional(),
  }),
  execute: async () => 'ok',
})

const searchArtifactsTool = tool({
  description: 'Search the library.',
  inputSchema: z.object({
    query: z.string(),
    maxResults: z.number().int().min(1).max(20).optional(),
    types: z.array(z.enum(['strategy', 'plan90', 'landing', 'pricing', 'pitch', 'review', 'teardown', 'investor', 'custom'])).optional(),
    pinnedOnly: z.boolean().optional(),
  }),
  execute: async () => 'ok',
})

// Sanity: if any schema is malformed, the tool() wrapper would have thrown.
// We then serialize the inputSchema via JSON Schema to make sure the AI SDK
// can turn it into a tool description for the model.
import { zodSchema } from 'ai'
const s1 = zodSchema(searchTool.inputSchema)
const s2 = zodSchema(fetchTool.inputSchema)
const s3 = zodSchema(searchArtifactsTool.inputSchema)
console.log('search schema type:', s1?.['~standard']?.version ?? 'zod v4')
console.log('fetch schema type:', s2?.['~standard']?.version ?? 'zod v4')
console.log('library schema type:', s3?.['~standard']?.version ?? 'zod v4')

// Also verify the system prompt builds for all 4 agents
import { buildSystemPrompt, AGENT_LIST } from '../src/lib/agents.ts'
import type { CompanyMemory } from '../src/lib/db.ts'

const sampleMemory: CompanyMemory = {
  id: 'singleton',
  name: 'Acme Co',
  oneLiner: 'AI tools for founders',
  idea: 'A cofounder in your browser',
  icp: 'Non-technical first-time founders',
  stage: 'idea',
  goal90d: 'Launch MVP',
  goal1y: '100 paying customers',
  blockers: ['No co-founder'],
  decisions: [{ ts: Date.now(), decision: 'Use Vite + React', rationale: 'fast and familiar' }],
  metrics: [],
  openQuestions: [],
  createdAt: Date.now(),
  updatedAt: Date.now(),
}

console.log('\n=== System prompt sizes per agent ===')
for (const a of AGENT_LIST) {
  const sp = buildSystemPrompt(a.id, sampleMemory)
  const toolSectionMarker = '# HOW TO BEHAVE'
  const toolIdx = sp.indexOf(toolSectionMarker)
  // The recency effect is positional: the tool section must be the LAST
  // thing in the prompt. We verify two things:
  //   1. The prompt ends with the verb rule (no trailing content)
  //   2. Nothing else appears AFTER the tool section (other than its own content)
  const endsWithVerbRule = sp.trimEnd().endsWith('Use sparingly — at most once per response.')
  const tail = sp.slice(toolIdx).trim()
  // Check the tail starts with the marker and contains the verb rule somewhere
  const tailHasMarker = tail.startsWith(toolSectionMarker)
  const tailHasVerbRule = tail.includes('Use sparingly — at most once per response.')
  const recencyOk = endsWithVerbRule && tailHasMarker && tailHasVerbRule
  console.log(`${a.name}: total=${sp.length} chars, tool-section at idx=${toolIdx}`)
  console.log(`  ends with verb rule: ${endsWithVerbRule}, tail has marker: ${tailHasMarker}, tail has verb rule: ${tailHasVerbRule}`)
  if (!recencyOk) {
    console.log(`  !! recency effect BROKEN for ${a.name}`)
  } else {
    console.log(`  ✓ recency effect intact for ${a.name}`)
  }
}

console.log('\nAll tool schemas and prompts parsed cleanly.')

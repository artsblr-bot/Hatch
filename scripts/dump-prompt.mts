import { buildSystemPrompt } from '../src/lib/agents.ts'
import type { CompanyMemory } from '../src/lib/db.ts'

const m: CompanyMemory = {
  id: 'singleton', name: 'Acme', oneLiner: 'AI cofounder', idea: 'Browser AI', icp: 'Founders',
  stage: 'idea', goal90d: 'MVP', goal1y: '100 customers', blockers: [], decisions: [],
  metrics: [], openQuestions: [], createdAt: 0, updatedAt: 0
}

const sp = buildSystemPrompt('mentor', m)
const idx = sp.indexOf('# HOW TO BEHAVE')
console.log('=== Tail of prompt (last 1200 chars) ===')
console.log(sp.slice(-1200))
console.log('\n=== Marker idx:', idx, 'total length:', sp.length)
console.log('=== Tail length from marker:', sp.length - idx)

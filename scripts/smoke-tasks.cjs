#!/usr/bin/env node
/**
 * Smoke test for the tasks module. Verifies:
 *  - Week math (Monday-anchored, Sunday roll-back, +7d)
 *  - Label helpers (dueLabel flags overdue, sourceLabel returns label+color,
 *    looksLikeATask is discriminative)
 *  - Export surface (all CRUD, queries, parsers present)
 *  - Component imports for the 5 new components
 */
const jiti = require('jiti')(__filename, {
  alias: { '@': require('path').resolve(__dirname, '../src') },
  esmResolve: true,
  interopDefault: true,
})
const root = require('path').resolve(__dirname, '..')

const fail = (msg) => { console.error(`✗ ${msg}`); process.exit(1) }
const pass = (msg) => console.log(`✓ ${msg}`)

// ---------------------------------------------------------------------------
// Module load: tasks
// ---------------------------------------------------------------------------
let tasks
try {
  tasks = jiti(root + '/src/lib/tasks.ts')
} catch (e) {
  fail('Loading src/lib/tasks.ts threw: ' + (e?.message || e))
}
pass('src/lib/tasks.ts loaded')

// ---------------------------------------------------------------------------
// Week math
// ---------------------------------------------------------------------------
{
  const mon = tasks.weekStart(new Date('2026-06-08T15:00:00'))
  const monMorning = new Date('2026-06-08T00:00:00').getTime()
  if (mon !== monMorning) fail(`weekStart = ${mon}, want ${monMorning}`)
  pass('weekStart returns Monday 00:00')

  const sun = tasks.weekStart(new Date('2026-06-14T12:00:00'))
  if (sun !== monMorning) fail(`weekStart(Sun) = ${sun}, want ${monMorning}`)
  pass('weekStart on Sunday rolls back to Monday')

  const end = tasks.weekEnd(mon)
  if (end - mon !== 7 * 24 * 60 * 60 * 1000) fail(`weekEnd = ${end - mon}, want 7d`)
  pass('weekEnd is +7 days')

  if (tasks.addWeeks(mon, 1) !== mon + 7 * 86400000) fail('addWeeks(n=1) wrong')
  pass('addWeeks(+1) = +7 days')
}

// ---------------------------------------------------------------------------
// Label helpers
// ---------------------------------------------------------------------------
{
  const now = new Date('2026-06-08T10:00:00').getTime()
  const overdue = { id: 'a', title: 'x', source: 'manual', status: 'open', createdAt: now, dueAt: now - 86400000 }
  if (!tasks.dueLabel(overdue, now).toLowerCase().includes('overdue')) fail('dueLabel(overdue) wrong: ' + tasks.dueLabel(overdue, now))
  pass('dueLabel flags overdue')

  const plan = { id: 'b', title: 'x', source: 'plan90', status: 'open', createdAt: now }
  const lbl = tasks.sourceLabel(plan)
  if (!lbl.label || !lbl.color) fail('sourceLabel missing fields')
  pass('sourceLabel returns { label, color }')

  if (!tasks.looksLikeATask('I need to email the investor tomorrow')) fail('looksLikeATask false negative')
  if (tasks.looksLikeATask('Hello there')) fail('looksLikeATask false positive')
  pass('looksLikeATask is discriminative')
}

// ---------------------------------------------------------------------------
// Export surface
// ---------------------------------------------------------------------------
const required = [
  'addTask', 'completeTask', 'dropTask', 'reopenTask', 'deleteTasks',
  'tasksForWeek', 'tasksThisWeek', 'overdueTasks', 'completedInWeek',
  'isWeekJustCleared', 'proposeTasksFromArtifact', 'commitProposedTasks',
  'carryOverIncomplete', 'weekStart', 'weekEnd', 'addWeeks', 'dueLabel',
  'sourceLabel', 'looksLikeATask',
]
for (const name of required) {
  if (typeof tasks[name] !== 'function') fail(`tasks.${name} is not a function`)
}
pass(`tasks exports all ${required.length} required functions`)

// ---------------------------------------------------------------------------
// DB v2 migration: tasks table registered
// ---------------------------------------------------------------------------
const db = jiti(root + '/src/lib/db.ts')
if (typeof db.db !== 'object') fail('db.db is not exported')
if (typeof db.db.tasks !== 'object') fail('db.db.tasks table is missing (Dexie v2 migration?)')
pass('db.db.tasks table is registered (Dexie v2 migration OK)')

// ---------------------------------------------------------------------------
// Component imports — the production build already proves these compile
// and export cleanly (Vite bundles them all). We just check that the
// files exist on disk to catch any accidental deletion.
// ---------------------------------------------------------------------------
const components = [
  ['src/components/ConvertToTasksButton.tsx', 'ConvertToTasksButton'],
  ['src/components/TodayPanel.tsx', 'TodayPanel'],
  ['src/components/EndWeekDialog.tsx', 'EndWeekDialog'],
  ['src/components/CheckInsList.tsx', 'CheckInsList'],
  ['src/components/ProgressBar.tsx', 'ProgressBar'],
]
const fs = require('fs')
for (const [relPath, name] of components) {
  const full = require('path').join(root, relPath)
  if (!fs.existsSync(full)) fail(`${relPath} is missing`)
  const src = fs.readFileSync(full, 'utf8')
  if (!src.includes(`export function ${name}`) && !src.includes(`export const ${name}`) && !src.includes(`export { ${name}`)) {
    fail(`${relPath} does not export ${name}`)
  }
  pass(`${name} component exists and exports the symbol`)
}

console.log('\n  All checks passed.')

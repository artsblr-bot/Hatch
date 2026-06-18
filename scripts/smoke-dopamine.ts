/**
 * Smoke test for the dopamine/reward layer's pure logic. Runs under Node's
 * type-stripping (no build, no deps):
 *   node --experimental-strip-types scripts/smoke-dopamine.ts
 *
 * Covers milestone detection/diffing and the juice preference + guard layer.
 * (React components can't run headless without a DOM; this tests the logic
 * those components depend on.)
 */
import {
  MILESTONES,
  reachedMilestoneIds,
  newlyReached,
  type MilestoneStats,
} from '../src/lib/milestones.ts'
import {
  DEFAULT_JUICE,
  getJuicePrefs,
  setJuicePrefs,
  prefersReducedMotion,
  haptic,
  playSound,
  spring,
  EASE_OUT,
} from '../src/lib/juice.ts'

let failed = 0
const ok = (cond: boolean, msg: string) => {
  if (cond) console.log(`✓ ${msg}`)
  else {
    console.error(`✗ ${msg}`)
    failed++
  }
}

const ZERO: MilestoneStats = {
  tasksDone: 0,
  weeksCleared: 0,
  artifacts: 0,
  conversations: 0,
  userMessages: 0,
  memoryNodes: 0,
  streak: 0,
}

// ---------------------------------------------------------------------------
// Milestones
// ---------------------------------------------------------------------------
ok(MILESTONES.length > 0, 'milestone list is non-empty')

const ids = MILESTONES.map((m) => m.id)
ok(new Set(ids).size === ids.length, 'milestone ids are unique')
ok(
  MILESTONES.every((m) => m.emoji && m.title && m.subtitle && (m.tier === 'small' || m.tier === 'big')),
  'every milestone has emoji/title/subtitle/valid-tier'
)

ok(reachedMilestoneIds(ZERO).length === 0, 'a brand-new user has reached nothing')

const oneTask: MilestoneStats = { ...ZERO, tasksDone: 1 }
ok(reachedMilestoneIds(oneTask).includes('first-task-done'), 'first task done is detected')
ok(!reachedMilestoneIds(oneTask).includes('tasks-10'), '10-task milestone not yet reached at 1')

const tenTasks: MilestoneStats = { ...ZERO, tasksDone: 10 }
ok(
  reachedMilestoneIds(tenTasks).includes('first-task-done') &&
    reachedMilestoneIds(tenTasks).includes('tasks-10'),
  'milestones are monotonic (10 tasks ⇒ both first and 10)'
)

// Diffing: only the newly-crossed milestones surface.
const already = new Set(reachedMilestoneIds(oneTask))
const fresh = newlyReached(tenTasks, already)
const freshIds = fresh.map((m) => m.id)
ok(freshIds.includes('tasks-10'), 'newlyReached surfaces the just-crossed 10-task milestone')
ok(!freshIds.includes('first-task-done'), 'newlyReached excludes already-celebrated milestones')

// Nothing new when stats are unchanged.
ok(newlyReached(oneTask, already).length === 0, 'no milestones fire twice for the same stats')

const big: MilestoneStats = {
  tasksDone: 100,
  weeksCleared: 1,
  artifacts: 25,
  conversations: 5,
  userMessages: 50,
  memoryNodes: 25,
  streak: 8,
}
ok(reachedMilestoneIds(big).length === MILESTONES.length, 'a power user has reached every milestone')

// ---------------------------------------------------------------------------
// Juice prefs + guards
// ---------------------------------------------------------------------------
ok(DEFAULT_JUICE.sound === false, 'sound is opt-in by default')
ok(DEFAULT_JUICE.haptics === true, 'haptics on by default')
ok(DEFAULT_JUICE.reducedMotion === 'auto', 'reduced-motion defaults to auto')

setJuicePrefs({ reducedMotion: 'on' })
ok(prefersReducedMotion() === true, "reducedMotion 'on' forces reduced motion")
setJuicePrefs({ reducedMotion: 'off' })
ok(prefersReducedMotion() === false, "reducedMotion 'off' forces full motion")
setJuicePrefs({ ...DEFAULT_JUICE })
ok(getJuicePrefs().reducedMotion === 'auto', 'setJuicePrefs round-trips')

// These must be safe to call in a non-DOM environment (guards short-circuit).
let threw = false
try {
  haptic('success')
  playSound('complete')
  setJuicePrefs({ sound: true, haptics: true })
  haptic('celebrate')
  playSound('levelup')
} catch {
  threw = true
}
ok(!threw, 'haptic/playSound are safe no-ops without a DOM')
setJuicePrefs({ ...DEFAULT_JUICE })

// Motion constants are well-formed.
ok(spring.soft.type === 'spring' && spring.bouncy.type === 'spring', 'spring presets are spring transitions')
ok(Array.isArray(EASE_OUT) && EASE_OUT.length === 4, 'EASE_OUT is a 4-point cubic bezier')

// ---------------------------------------------------------------------------
if (failed > 0) {
  console.error(`\n${failed} check(s) failed`)
  process.exit(1)
}
console.log('\nAll dopamine-layer checks passed.')

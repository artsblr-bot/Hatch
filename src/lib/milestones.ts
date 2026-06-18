/**
 * milestones.ts — the achievement / "collection" layer.
 *
 * A curated set of one-time milestones across the product's core verbs
 * (shipping tasks, building artifacts, talking to your cofounder, keeping a
 * streak). Each fires exactly once, the first time its condition becomes true,
 * via a celebration. The list is intentionally sparse — variable, meaningful
 * rewards beat constant noise (a reward you get every time stops being one).
 *
 * Pure data + a pure detector so it's trivially testable without React.
 */

export interface MilestoneStats {
  tasksDone: number
  weeksCleared: number
  artifacts: number
  conversations: number
  userMessages: number
  memoryNodes: number
  /** Current consecutive-week check-in streak. */
  streak: number
}

export type MilestoneTier = 'small' | 'big'

export interface Milestone {
  id: string
  emoji: string
  title: string
  subtitle: string
  tier: MilestoneTier
  /** True once this milestone is earned (monotonic — never un-earns). */
  reached: (s: MilestoneStats) => boolean
}

/**
 * Ordered roughly by when a founder will hit them. Keep titles short and
 * second-person; subtitles add a hit of progress narrative.
 */
export const MILESTONES: Milestone[] = [
  // First moments — the activation wins that matter most.
  {
    id: 'first-task-done',
    emoji: '✅',
    title: 'First one shipped',
    subtitle: 'Momentum starts with a single done task. Onward.',
    tier: 'small',
    reached: (s) => s.tasksDone >= 1,
  },
  {
    id: 'first-artifact',
    emoji: '📄',
    title: 'First artifact saved',
    subtitle: 'Your workspace has its first real output.',
    tier: 'small',
    reached: (s) => s.artifacts >= 1,
  },
  {
    id: 'first-week-cleared',
    emoji: '🧹',
    title: 'A clean week',
    subtitle: 'Every task done. This is what a good week feels like.',
    tier: 'big',
    reached: (s) => s.weeksCleared >= 1,
  },

  // Task volume — the goal-gradient ladder.
  {
    id: 'tasks-10',
    emoji: '⚡',
    title: '10 tasks done',
    subtitle: "You're building a habit, not just a product.",
    tier: 'small',
    reached: (s) => s.tasksDone >= 10,
  },
  {
    id: 'tasks-25',
    emoji: '🔧',
    title: '25 tasks done',
    subtitle: 'Real execution. Keep stacking.',
    tier: 'small',
    reached: (s) => s.tasksDone >= 25,
  },
  {
    id: 'tasks-50',
    emoji: '🚀',
    title: '50 tasks done',
    subtitle: "Half a hundred. You're shipping like a founder.",
    tier: 'big',
    reached: (s) => s.tasksDone >= 50,
  },
  {
    id: 'tasks-100',
    emoji: '🏆',
    title: '100 tasks done',
    subtitle: 'A hundred decisions turned into action. Rare air.',
    tier: 'big',
    reached: (s) => s.tasksDone >= 100,
  },

  // Conversation depth — investment in the cofounder relationship.
  {
    id: 'first-conversation',
    emoji: '💬',
    title: 'You two have met',
    subtitle: 'Your first real conversation with your cofounder.',
    tier: 'small',
    reached: (s) => s.conversations >= 1,
  },
  {
    id: 'messages-50',
    emoji: '🧠',
    title: '50 messages in',
    subtitle: 'Your cofounder is getting to know how you think.',
    tier: 'small',
    reached: (s) => s.userMessages >= 50,
  },
  {
    id: 'memory-25',
    emoji: '📌',
    title: 'A memory worth keeping',
    subtitle: 'Your cofounder now remembers 25 things about your work.',
    tier: 'small',
    reached: (s) => s.memoryNodes >= 25,
  },

  // Streaks — loss aversion's best friend.
  {
    id: 'streak-3',
    emoji: '🔥',
    title: '3-week streak',
    subtitle: 'Three Fridays in a row. The ritual is sticking.',
    tier: 'small',
    reached: (s) => s.streak >= 3,
  },
  {
    id: 'streak-8',
    emoji: '🔥',
    title: '8-week streak',
    subtitle: 'Two months of closing the loop. Don’t break it now.',
    tier: 'big',
    reached: (s) => s.streak >= 8,
  },
]

/** Ids of every milestone currently earned given the stats. */
export function reachedMilestoneIds(stats: MilestoneStats): string[] {
  return MILESTONES.filter((m) => m.reached(stats)).map((m) => m.id)
}

/** Milestones newly earned this tick — reached now, not in `already`. */
export function newlyReached(stats: MilestoneStats, already: Set<string>): Milestone[] {
  return MILESTONES.filter((m) => m.reached(stats) && !already.has(m.id))
}

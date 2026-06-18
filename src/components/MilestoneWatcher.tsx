/**
 * MilestoneWatcher — invisible component that watches the user's stats and
 * fires milestone celebrations exactly once each.
 *
 * Mounted once near the app root (inside CelebrationProvider). Pre-existing
 * users are seeded silently on first run so we never dump a backlog of
 * celebrations on someone who already has months of data.
 */
import { useEffect, useRef } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, updateSettings, type CheckIn } from '@/lib/db'
import { weekStart } from '@/lib/tasks'
import { MILESTONES, reachedMilestoneIds, type MilestoneStats } from '@/lib/milestones'
import { useCelebrate } from './Celebration'

const ONE_WEEK = 7 * 24 * 60 * 60 * 1000

function calcCheckInStreak(checkIns: CheckIn[]): number {
  if (!checkIns.length) return 0
  const weeks = [...checkIns.map((c) => c.weekOf)].sort((a, b) => b - a)
  const currentWeek = weekStart()
  const startFrom = weeks[0] === currentWeek ? currentWeek : currentWeek - ONE_WEEK
  let streak = 0
  for (let i = 0; i < weeks.length; i++) {
    if (weeks[i] === startFrom - i * ONE_WEEK) streak++
    else break
  }
  return streak
}

export function MilestoneWatcher() {
  const { celebrate } = useCelebrate()

  const settings = useLiveQuery(() => db.settings.get('singleton'), [])
  const tasks = useLiveQuery(() => db.tasks.toArray(), [])
  const artifacts = useLiveQuery(() => db.artifacts.count(), [])
  const conversations = useLiveQuery(() => db.conversations.count(), [])
  const userMessages = useLiveQuery(() => db.messages.where('role').equals('user').count(), [])
  const memoryNodes = useLiveQuery(() => db.memoryNodes.count(), [])
  const checkIns = useLiveQuery(() => db.checkIns.toArray(), [])

  // Avoid double-seeding / double-firing within a single mount while the
  // settings write round-trips back through the live query.
  const writingRef = useRef(false)
  // Ids celebrated this session — belt-and-suspenders against the brief window
  // between celebrating and the persisted achievements re-emitting.
  const celebratedRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (
      !settings ||
      tasks === undefined ||
      artifacts === undefined ||
      conversations === undefined ||
      userMessages === undefined ||
      memoryNodes === undefined ||
      checkIns === undefined
    ) {
      return
    }
    if (writingRef.current) return

    // Derive weeks fully cleared: a week with ≥1 done task and 0 open tasks.
    const byWeek = new Map<number, { done: number; open: number }>()
    for (const t of tasks) {
      if (t.weekOf == null) continue
      const e = byWeek.get(t.weekOf) ?? { done: 0, open: 0 }
      if (t.status === 'done') e.done++
      if (t.status === 'open') e.open++
      byWeek.set(t.weekOf, e)
    }
    let weeksCleared = 0
    for (const e of byWeek.values()) {
      if (e.done > 0 && e.open === 0) weeksCleared++
    }

    const stats: MilestoneStats = {
      tasksDone: tasks.filter((t) => t.status === 'done').length,
      weeksCleared,
      artifacts,
      conversations,
      userMessages,
      memoryNodes,
      streak: calcCheckInStreak(checkIns),
    }

    // Pre-existing user (no achievements field yet): seed silently.
    if (settings.achievements === undefined) {
      writingRef.current = true
      updateSettings({ achievements: reachedMilestoneIds(stats) }).finally(() => {
        writingRef.current = false
      })
      return
    }

    const already = new Set(settings.achievements)
    const fresh = MILESTONES.filter(
      (m) => m.reached(stats) && !already.has(m.id) && !celebratedRef.current.has(m.id)
    )
    if (fresh.length === 0) return

    fresh.forEach((m) => {
      celebratedRef.current.add(m.id)
      celebrate({ emoji: m.emoji, title: m.title, subtitle: m.subtitle, tier: m.tier })
    })
    writingRef.current = true
    updateSettings({ achievements: [...settings.achievements, ...fresh.map((m) => m.id)] }).finally(
      () => {
        writingRef.current = false
      }
    )
  }, [settings, tasks, artifacts, conversations, userMessages, memoryNodes, checkIns, celebrate])

  return null
}

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Calendar,
  ChevronRight,
  PartyPopper,
  Target,
  ArrowRight,
  Plus,
  Trash2,
  Flame,
  Zap,
} from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type CheckIn } from '@/lib/db'
import { weekStart } from '@/lib/tasks'
import { useRitual } from './ritual/RitualProvider'
import { cn } from '@/lib/utils'

function calcCheckInStreak(checkIns: CheckIn[]): number {
  if (!checkIns.length) return 0
  const ONE_WEEK = 7 * 24 * 60 * 60 * 1000
  const sortedWeeks = [...checkIns.map((c) => c.weekOf)].sort((a, b) => b - a)
  const currentWeek = weekStart()
  const startFrom = sortedWeeks[0] === currentWeek ? currentWeek : currentWeek - ONE_WEEK
  let streak = 0
  for (let i = 0; i < sortedWeeks.length; i++) {
    const expected = startFrom - i * ONE_WEEK
    if (sortedWeeks[i] === expected) streak++
    else break
  }
  return streak
}

export function CheckInsList() {
  const checkIns = useLiveQuery(
    () => db.checkIns.orderBy('weekOf').reverse().toArray(),
    []
  ) || []
  const { openEndWeek } = useRitual()

  const thisWeek = weekStart()
  const alreadyThisWeek = checkIns.some((c) => c.weekOf === thisWeek)
  const isFriday = new Date().getDay() === 5
  const isWeekend = [0, 6].includes(new Date().getDay())
  const streak = calcCheckInStreak(checkIns)
  // Loss aversion: once it's late in the week and you haven't checked in, the
  // streak is on the line — surface that to nudge the close-out.
  const streakAtRisk = streak > 0 && !alreadyThisWeek && (isFriday || isWeekend)

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">
            <Calendar className="h-3 w-3" />
            <span>Weekly check-ins</span>
          </div>
          <h2 className="mt-2 font-serif text-2xl font-medium tracking-tight">How was the week?</h2>
          <p className="mt-1 text-sm text-fg-muted">
            A 3-step reflection on what shipped, what slowed you down, and what to commit to next.
          </p>
          {streak > 0 && (
            <motion.div
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: 'spring', stiffness: 380, damping: 20, delay: 0.1 }}
              className={cn(
                'mt-3 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold',
                streakAtRisk
                  ? 'border-amber-500/40 bg-amber-500/[0.1] text-amber-600 dark:text-amber-400'
                  : 'border-accent/25 bg-accent/[0.08] text-accent'
              )}
            >
              <motion.span
                animate={{ scale: [1, 1.18, 1], rotate: [0, -6, 6, 0] }}
                transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
                className="inline-flex"
              >
                <Flame className="h-3 w-3" />
              </motion.span>
              {streak}-week streak
              {streakAtRisk && <span className="font-medium opacity-80">· keep it alive</span>}
            </motion.div>
          )}
        </div>
        <button
          onClick={openEndWeek}
          disabled={alreadyThisWeek}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-2xl px-4 py-2 text-sm font-medium transition focus-ring',
            alreadyThisWeek
              ? 'border border-border bg-bg-subtle text-fg-muted'
              : isFriday || isWeekend
                ? 'bg-accent text-accent-fg hover:shadow-glow'
                : 'border border-border bg-bg-subtle text-fg-muted hover:bg-bg-muted'
          )}
          title={alreadyThisWeek ? "You've already checked in this week" : 'Start a check-in'}
        >
          <Plus className="h-3.5 w-3.5" />
          {alreadyThisWeek ? 'Done this week ✓' : isFriday ? 'Start Friday check-in' : 'Start check-in'}
        </button>
      </div>

      {isFriday && !alreadyThisWeek && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          className="relative overflow-hidden rounded-2xl border border-accent/30 bg-gradient-to-br from-accent/10 to-accent/5 p-5"
        >
          <div className="pointer-events-none absolute right-4 top-3 select-none text-4xl opacity-10">🎯</div>
          <div className="flex items-start gap-4">
            <motion.div
              animate={{ scale: [1, 1.08, 1] }}
              transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
              className="grid h-11 w-11 flex-shrink-0 place-items-center rounded-2xl bg-accent/20 text-accent"
            >
              <Zap className="h-5 w-5" />
            </motion.div>
            <div className="flex-1">
              <div className="font-semibold text-fg">It's Friday — close the loop.</div>
              <div className="mt-0.5 text-sm text-fg-muted">
                90 seconds to capture what shipped, what blocked you, and what you're betting on next week.
                {streak > 0 && (
                  <span className="ml-1.5 font-medium text-accent">
                    Keep the {streak}-week streak alive.
                  </span>
                )}
              </div>
              <motion.button
                onClick={openEndWeek}
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                animate={{
                  boxShadow: [
                    '0 0 0 0 hsl(var(--accent)/0)',
                    '0 0 0 8px hsl(var(--accent)/0.15)',
                    '0 0 0 0 hsl(var(--accent)/0)',
                  ],
                }}
                transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
                className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-sm font-medium text-accent-fg"
              >
                Start the ritual
                <ArrowRight className="h-3.5 w-3.5" />
              </motion.button>
            </div>
          </div>
        </motion.div>
      )}

      {checkIns.length === 0 ? (
        <EmptyState onStart={openEndWeek} />
      ) : (
        <div className="space-y-3">
          <AnimatePresence initial={false}>
            {checkIns.map((c) => (
              <CheckInRow key={c.id} checkIn={c} />
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  )
}

function CheckInRow({ checkIn }: { checkIn: CheckIn }) {
  const [open, setOpen] = useState(false)
  const handleDelete = async () => {
    if (!confirm('Delete this check-in?')) return
    await db.checkIns.delete(checkIn.id)
  }
  const dateLabel = `${new Date(checkIn.weekOf).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })} – ${new Date(checkIn.weekOf + 6 * 86400000).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })}`
  const shipped = checkIn.highlights.length
  const blocked = checkIn.blockers.length
  const scoreColor =
    shipped >= 3
      ? 'text-emerald-600 dark:text-emerald-400'
      : shipped >= 1
        ? 'text-accent'
        : 'text-fg-muted'

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      className="overflow-hidden rounded-2xl border border-border bg-bg-subtle/30"
    >
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-bg-muted/60"
      >
        <div className={cn('grid h-9 w-9 flex-shrink-0 place-items-center rounded-xl text-base font-bold tabular-nums', scoreColor)}>
          {shipped > 0 ? shipped : '—'}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium">{dateLabel}</div>
          <div className="mt-0.5 line-clamp-1 text-xs text-fg-muted">{checkIn.summary}</div>
        </div>
        <div className="flex items-center gap-1.5 text-[10px]">
          {shipped > 0 && (
            <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 font-semibold text-emerald-700 dark:text-emerald-400">
              {shipped} shipped
            </span>
          )}
          {blocked > 0 && (
            <span className="rounded-full bg-amber-500/10 px-2 py-0.5 font-semibold text-amber-700 dark:text-amber-400">
              {blocked} blocked
            </span>
          )}
        </div>
        <ChevronRight className={cn('h-3.5 w-3.5 text-fg-subtle transition', open && 'rotate-90')} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.16 }}
            className="border-t border-border-subtle bg-bg/40 px-4 py-3"
          >
            <div className="grid gap-3 md:grid-cols-3">
              <Column title="Shipped" items={checkIn.highlights} color="emerald" icon={PartyPopper} />
              <Column title="In the way" items={checkIn.blockers} color="amber" icon={Target} />
              <Column title="Next week" items={checkIn.nextWeek} color="accent" icon={ArrowRight} />
            </div>
            <div className="mt-3 flex items-center justify-between border-t border-border-subtle pt-2">
              <div className="text-[11px] text-fg-subtle">
                {new Date(checkIn.weekOf).toLocaleDateString(undefined, {
                  weekday: 'long',
                  month: 'long',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </div>
              <button
                onClick={handleDelete}
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] text-fg-subtle transition hover:bg-danger/10 hover:text-danger"
              >
                <Trash2 className="h-2.5 w-2.5" />
                Delete
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

function Column({
  title,
  items,
  color,
  icon: Icon,
}: {
  title: string
  items: string[]
  color: 'emerald' | 'amber' | 'accent'
  icon: any
}) {
  const colorMap = {
    emerald: 'text-emerald-700 dark:text-emerald-400',
    amber: 'text-amber-700 dark:text-amber-400',
    accent: 'text-accent',
  } as const
  if (items.length === 0) return null
  return (
    <div>
      <div className={cn('mb-1.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider', colorMap[color])}>
        <Icon className="h-2.5 w-2.5" />
        {title}
      </div>
      <ul className="space-y-1 text-xs text-fg">
        {items.map((item, i) => (
          <li key={i} className="flex items-start gap-1.5">
            <span className="mt-1.5 h-1 w-1 flex-shrink-0 rounded-full bg-current opacity-60" />
            <span className="flex-1">{item}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function EmptyState({ onStart }: { onStart: () => void }) {
  const isFriday = new Date().getDay() === 5
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      className="grid place-items-center rounded-2xl border border-dashed border-border bg-bg-subtle/30 p-10 text-center"
    >
      <motion.div
        animate={{ rotate: [0, -8, 8, 0] }}
        transition={{ duration: 1.2, delay: 0.5, ease: 'easeInOut' }}
        className="text-3xl"
      >
        📅
      </motion.div>
      <h3 className="mt-3 text-sm font-semibold">
        {isFriday ? 'Week 1 starts today.' : 'Your streak starts this week.'}
      </h3>
      <p className="mt-1 max-w-xs text-xs text-fg-muted">
        {isFriday
          ? "90 seconds to capture what shipped, what blocked you, and what you're betting on next week."
          : "One check-in a week. See how far you've come. Best done on Fridays."}
      </p>
      <motion.button
        onClick={onStart}
        whileHover={{ scale: 1.04 }}
        whileTap={{ scale: 0.96 }}
        className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:shadow-glow"
      >
        <Plus className="h-3.5 w-3.5" />
        {isFriday ? 'Start your first check-in' : 'Start a check-in'}
      </motion.button>
    </motion.div>
  )
}

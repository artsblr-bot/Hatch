import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Calendar,
  Sparkles,
  ChevronRight,
  PartyPopper,
  Target,
  ArrowRight,
  Plus,
  Trash2,
} from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type CheckIn } from '@/lib/db'
import { weekStart } from '@/lib/tasks'
import { EndWeekDialog } from './EndWeekDialog'
import { cn } from '@/lib/utils'

/**
 * The "Weekly check-ins" tab inside Memory. Renders the founder's
 * check-in history (most recent first) and a primary CTA to start
 * a new check-in. The dialog itself lives in `EndWeekDialog`.
 */
export function CheckInsList() {
  const checkIns = useLiveQuery(
    () => db.checkIns.orderBy('weekOf').reverse().toArray(),
    []
  ) || []
  const [open, setOpen] = useState(false)

  const thisWeek = weekStart()
  const alreadyThisWeek = checkIns.some((c) => c.weekOf === thisWeek)
  const isFriday = new Date().getDay() === 5
  const isWeekend = [0, 6].includes(new Date().getDay())

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
            Best done Friday afternoon or Sunday night.
          </p>
        </div>
        <button
          onClick={() => setOpen(true)}
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
          {alreadyThisWeek ? "This week's check-in done" : isFriday ? 'Start Friday check-in' : 'Start check-in'}
        </button>
      </div>

      {isFriday && !alreadyThisWeek && (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-3 rounded-2xl border border-accent/30 bg-accent/5 p-4"
        >
          <div className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-xl bg-accent/15 text-accent">
            <PartyPopper className="h-4 w-4" />
          </div>
          <div className="flex-1">
            <div className="text-sm font-medium">It's Friday — close the loop</div>
            <div className="text-xs text-fg-muted">
              A 90-second check-in is enough to keep next week focused.
            </div>
          </div>
          <button
            onClick={() => setOpen(true)}
            className="inline-flex items-center gap-1 rounded-lg bg-accent px-2.5 py-1.5 text-xs font-medium text-accent-fg hover:shadow-glow"
          >
            Start
            <ArrowRight className="h-3 w-3" />
          </button>
        </motion.div>
      )}

      {checkIns.length === 0 ? (
        <EmptyState onStart={() => setOpen(true)} />
      ) : (
        <div className="space-y-3">
          <AnimatePresence initial={false}>
            {checkIns.map((c) => (
              <CheckInRow key={c.id} checkIn={c} />
            ))}
          </AnimatePresence>
        </div>
      )}

      <EndWeekDialog open={open} onClose={() => setOpen(false)} />
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
        <div className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-lg bg-bg/60 text-fg-muted">
          <Calendar className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium">{dateLabel}</div>
          <div className="mt-0.5 line-clamp-1 text-xs text-fg-muted">{checkIn.summary}</div>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-fg-subtle">
          <span className="rounded-full bg-emerald-500/10 px-1.5 py-0.5 font-semibold text-emerald-700 dark:text-emerald-400">
            {checkIn.highlights.length} shipped
          </span>
          {checkIn.blockers.length > 0 && (
            <span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 font-semibold text-amber-700 dark:text-amber-400">
              {checkIn.blockers.length} blocked
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
  return (
    <div className="grid place-items-center rounded-2xl border border-dashed border-border bg-bg-subtle/30 p-10 text-center">
      <Sparkles className="h-7 w-7 text-fg-subtle" />
      <h3 className="mt-3 text-sm font-medium">No check-ins yet</h3>
      <p className="mt-1 max-w-xs text-xs text-fg-muted">
        Start a check-in to capture what shipped, what blocked you, and what you're betting on next.
      </p>
      <button
        onClick={onStart}
        className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg hover:shadow-glow"
      >
        <Plus className="h-3 w-3" />
        Start your first check-in
      </button>
    </div>
  )
}

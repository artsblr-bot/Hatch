import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { motion, AnimatePresence } from 'framer-motion'
import {
  CheckCircle2,
  Circle,
  ListTodo,
  Plus,
  Sparkles,
  Calendar,
  ChevronRight,
  MessageSquarePlus,
  PartyPopper,
  AlertCircle,
  X,
} from 'lucide-react'
import { db, type Task } from '@/lib/db'
import {
  weekStart,
  weekEnd,
  completeTask,
  addTask,
} from '@/lib/tasks'
import { TaskCard } from './TaskCard'
import { ProgressBar } from './ProgressBar'
import { CountUp } from './CountUp'
import { useToast } from './Toast'
import { useCelebrate } from './Celebration'
import { haptic, playSound, spring, EASE_OUT } from '@/lib/juice'
import { cn } from '@/lib/utils'

/**
 * The "Today" widget — the founder's daily surface. Sits at the top of
 * the Landing page above the hero. Renders:
 *   - Week range + progress meter (done / total)
 *   - Up to 3 "do this today" tasks (closest dueAt; fallback = oldest open)
 *   - "Add task" inline composer
 *   - Overdue row (if any)
 *   - Confetti burst when the last open task of the week is completed
 */
export function TodayPanel() {
  const toast = useToast()
  const navigate = useNavigate()
  const { burst: fireBurst } = useCelebrate()
  const now = Date.now()
  const thisWeek = weekStart()
  const thisWeekEnd = weekEnd(thisWeek)

  const tasks = useLiveQuery(
    () => db.tasks.where('weekOf').equals(thisWeek).toArray(),
    [thisWeek]
  ) || []

  const [showAll, setShowAll] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const prevOpenCount = useRef<number | null>(null)

  const open = tasks.filter((t) => t.status === 'open')
  const done = tasks.filter((t) => t.status === 'done')
  const dropped = tasks.filter((t) => t.status === 'dropped')

  // When the week rolls over (e.g. across midnight Monday), the live query
  // swaps to the new week's (empty) task set. Re-baseline so that drop to 0
  // open tasks isn't misread as "just cleared the week".
  useEffect(() => {
    prevOpenCount.current = null
  }, [thisWeek])

  // Confetti: fires when we transition from N>0 open tasks to 0 open tasks
  useEffect(() => {
    if (prevOpenCount.current === null) {
      prevOpenCount.current = open.length
      return
    }
    if (prevOpenCount.current > 0 && open.length === 0) {
      fireBurst('big')
      toast.success('Week cleared!', 'Every task for this week is done. Take a breath.')
    }
    prevOpenCount.current = open.length
  }, [open.length, toast, fireBurst])

  // Three "do today" tasks: overdue first, then by dueAt, then by createdAt
  const todayList = useMemo(() => {
    const sorted = [...open].sort((a, b) => {
      const aOver = (a.dueAt ?? Infinity) < now
      const bOver = (b.dueAt ?? Infinity) < now
      if (aOver !== bOver) return aOver ? -1 : 1
      if (a.dueAt && b.dueAt) return a.dueAt - b.dueAt
      return a.createdAt - b.createdAt
    })
    return sorted
  }, [open, now])

  const visible = showAll ? open : todayList.slice(0, 3)
  const hiddenCount = Math.max(0, open.length - visible.length)
  const totalCount = tasks.length

  const weekLabel = `${new Date(thisWeek).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })} – ${new Date(thisWeekEnd - 1).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })}`

  const handleQuickAdd = async (title: string) => {
    if (!title.trim()) return
    await addTask({
      title: title.trim(),
      source: 'manual',
      weekOf: thisWeek,
      dueAt: thisWeekEnd,
    })
    toast.success('Task added', title.trim().length > 40 ? title.trim().slice(0, 40) + '…' : title.trim())
  }

  return (
    <div
      id="today-panel"
      className="relative overflow-hidden rounded-2xl border border-border bg-bg-subtle/40 backdrop-blur-sm"
    >
      <div className="flex items-center gap-3 border-b border-border-subtle px-4 py-3">
        <div className="grid h-8 w-8 place-items-center rounded-lg bg-accent/10 text-accent">
          <ListTodo className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <h2 className="text-sm font-semibold">Today</h2>
            <span className="text-[10px] text-fg-subtle">· {weekLabel}</span>
          </div>
          <div className="mt-1">
            <ProgressBar value={done.length} max={Math.max(1, totalCount)} size="xs" glow />
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-fg-muted">
          {open.length === 1 && totalCount > 1 ? (
            <motion.span
              animate={{ opacity: [1, 0.5, 1] }}
              transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
              className="font-semibold text-accent"
            >
              1 left — finish strong
            </motion.span>
          ) : (
            <>
              <CountUp
                value={done.length}
                trigger="change"
                duration={500}
                className="tabular-nums font-semibold text-fg"
              />
              <span>/ {totalCount || 0}</span>
            </>
          )}
          {dropped.length > 0 && (
            <span className="rounded-full bg-bg-muted px-1.5 py-0.5 text-[9px] text-fg-subtle">
              {dropped.length} dropped
            </span>
          )}
        </div>
      </div>

      {open.length === 0 && done.length === 0 && totalCount === 0 ? (
        <EmptyToday onAdd={() => setShowAdd(true)} />
      ) : open.length === 0 ? (
        <ClearedToday done={done.length} dropped={dropped.length} onAdd={() => setShowAdd(true)} />
      ) : (
        <div className="divide-y divide-border-subtle">
          <AnimatePresence initial={false}>
            {visible.map((t) => (
              <TodayTaskRow key={t.id} task={t} />
            ))}
          </AnimatePresence>
        </div>
      )}

      {(open.length > 3 || showAll) && (
        <button
          onClick={() => setShowAll((s) => !s)}
          className="block w-full border-t border-border-subtle px-4 py-2 text-[11px] font-medium text-fg-muted transition hover:bg-bg-muted hover:text-fg"
        >
          {showAll ? 'Show less' : `Show all ${open.length} open tasks`}
        </button>
      )}

      {hiddenCount > 0 && !showAll && (
        <div className="border-t border-border-subtle px-4 py-1.5 text-center text-[10px] text-fg-subtle">
          + {hiddenCount} more
        </div>
      )}

      {/* Friday (or weekend) check-in entry — surfaces the 3-step reflection
          flow at the moment the founder is most likely to use it. */}
      {[5, 6, 0].includes(new Date().getDay()) && open.length === 0 && done.length > 0 && (
        <button
          onClick={() => navigate('/memory?tab=checkins')}
          className="flex w-full items-center gap-2 border-t border-border-subtle bg-accent/5 px-4 py-2.5 text-left text-[11px] font-medium text-accent transition hover:bg-accent/10"
        >
          <PartyPopper className="h-3.5 w-3.5" />
          <span className="flex-1">Wrap up the week — 3-step check-in</span>
          <ChevronRight className="h-3 w-3" />
        </button>
      )}

      <div className="flex items-center gap-2 border-t border-border-subtle bg-bg/40 px-4 py-2">
        {showAdd ? (
          <form
            onSubmit={async (e) => {
              e.preventDefault()
              const form = e.currentTarget
              const input = form.elements.namedItem('title') as HTMLInputElement
              const title = input.value
              await handleQuickAdd(title)
              input.value = ''
              setShowAdd(false)
            }}
            className="flex flex-1 items-center gap-1.5 rounded-lg border border-dashed border-border bg-bg-subtle/30 px-2 py-1"
          >
            <Plus className="h-3 w-3 flex-shrink-0 text-fg-subtle" />
            <input
              name="title"
              autoFocus
              placeholder="Add a task for this week…"
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault()
                  setShowAdd(false)
                }
              }}
              className="min-w-0 flex-1 bg-transparent text-xs text-fg placeholder:text-fg-subtle focus:outline-none"
            />
            <button
              type="button"
              onClick={() => setShowAdd(false)}
              className="rounded-md p-0.5 text-fg-subtle transition hover:bg-bg-muted hover:text-fg"
            >
              <X className="h-3 w-3" />
            </button>
          </form>
        ) : (
          <>
            <button
              onClick={() => setShowAdd(true)}
              className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-medium text-fg-muted transition hover:bg-bg-muted hover:text-fg"
            >
              <Plus className="h-3 w-3" />
              Add task
            </button>
            <div className="flex-1" />
            <Link
              to="/library"
              className="inline-flex items-center gap-1 text-[11px] font-medium text-fg-muted transition hover:text-fg"
              title="Find tasks inside your saved artifacts"
            >
              <Sparkles className="h-3 w-3" />
              Pull from artifacts
              <ChevronRight className="h-2.5 w-2.5" />
            </Link>
          </>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function TodayTaskRow({ task }: { task: Task }) {
  const over = (task.dueAt ?? Infinity) < Date.now()
  const [checking, setChecking] = useState(false)

  const handleComplete = () => {
    if (checking) return
    setChecking(true)
    haptic('success')
    playSound('complete')
    // Small delay so the satisfying check-pop registers before the live query
    // removes the row and the exit animation plays.
    setTimeout(() => completeTask(task.id), 200)
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: 16, height: 0, paddingTop: 0, paddingBottom: 0 }}
      transition={spring.soft}
      className="group flex items-start gap-2 overflow-hidden px-4 py-2.5 transition hover:bg-bg-subtle/60"
    >
      <motion.button
        onClick={handleComplete}
        whileTap={{ scale: 0.8 }}
        animate={checking ? { scale: [1, 1.3, 1] } : { scale: 1 }}
        transition={{ duration: 0.3, ease: EASE_OUT }}
        className={cn(
          'mt-0.5 grid h-5 w-5 flex-shrink-0 place-items-center rounded-full border transition',
          checking
            ? 'border-accent bg-accent text-accent-fg'
            : 'border-border text-transparent hover:border-accent hover:text-accent/40'
        )}
        title="Mark done"
      >
        <CheckCircle2 className="h-3.5 w-3.5" />
      </motion.button>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <div className="flex-1 min-w-0 truncate text-sm text-fg">{task.title}</div>
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-fg-subtle">
          {over && (
            <span className="inline-flex items-center gap-0.5 font-semibold text-danger">
              <AlertCircle className="h-2.5 w-2.5" />
              overdue
            </span>
          )}
          {!over && task.dueAt && (
            <span className="inline-flex items-center gap-0.5">
              <Calendar className="h-2.5 w-2.5" />
              {dueLabelShort(task.dueAt)}
            </span>
          )}
          {task.source && (
            <span className="rounded-full bg-bg-muted px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-fg-muted">
              {task.source}
            </span>
          )}
        </div>
      </div>
      <div className="opacity-0 transition group-hover:opacity-100">
        <TaskCard task={task} compact />
      </div>
    </motion.div>
  )
}

function EmptyToday({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="grid place-items-center px-4 py-8 text-center">
      <Circle className="h-6 w-6 text-fg-subtle" />
      <h3 className="mt-3 text-sm font-medium">No tasks for this week yet</h3>
      <p className="mt-1 max-w-xs text-xs text-fg-muted">
        Add one manually, or pull tasks from a 90-day plan or strategy doc.
      </p>
      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={onAdd}
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-2.5 py-1.5 text-xs font-medium text-accent-fg transition hover:shadow-glow"
        >
          <Plus className="h-3 w-3" />
          Add task
        </button>
        <Link
          to="/library"
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-bg-subtle px-2.5 py-1.5 text-xs font-medium transition hover:bg-bg-muted"
        >
          <Sparkles className="h-3 w-3" />
          Pull from artifacts
        </Link>
      </div>
    </div>
  )
}

function ClearedToday({ done, dropped, onAdd }: { done: number; dropped: number; onAdd: () => void }) {
  return (
    <div className="grid place-items-center px-4 py-6 text-center">
      <motion.div
        initial={{ scale: 0.5, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 220, damping: 18 }}
      >
        <PartyPopper className="h-7 w-7 text-accent" />
      </motion.div>
      <h3 className="mt-2 text-sm font-medium">All clear for this week</h3>
      <p className="mt-1 text-xs text-fg-muted">
        {done} done{dropped > 0 && ` · ${dropped} dropped`}. Want to add more?
      </p>
      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={onAdd}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-bg-subtle px-2.5 py-1.5 text-xs font-medium transition hover:bg-bg-muted"
        >
          <Plus className="h-3 w-3" />
          Add task
        </button>
        <Link
          to="/chat"
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-bg-subtle px-2.5 py-1.5 text-xs font-medium transition hover:bg-bg-muted"
        >
          <MessageSquarePlus className="h-3 w-3" />
          Ask your cofounder
        </Link>
      </div>
    </div>
  )
}

function dueLabelShort(due: number): string {
  const d = new Date(due)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const dStart = new Date(d)
  dStart.setHours(0, 0, 0, 0)
  const diffDays = Math.round((dStart.getTime() - today.getTime()) / 86400000)
  if (diffDays === 0) return 'today'
  if (diffDays === 1) return 'tomorrow'
  if (diffDays < 7) return d.toLocaleDateString(undefined, { weekday: 'short' })
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

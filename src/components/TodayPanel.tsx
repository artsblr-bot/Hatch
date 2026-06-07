import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { motion } from 'framer-motion'
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
import { ConfettiBurst } from './ConfettiBurst'
import { ProgressBar } from './ProgressBar'
import { useToast } from './Toast'

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
  const [burst, setBurst] = useState(false)

  const open = tasks.filter((t) => t.status === 'open')
  const done = tasks.filter((t) => t.status === 'done')
  const dropped = tasks.filter((t) => t.status === 'dropped')

  // Confetti: fires when we transition from N>0 open tasks to 0 open tasks
  useEffect(() => {
    if (prevOpenCount.current === null) {
      prevOpenCount.current = open.length
      return
    }
    if (prevOpenCount.current > 0 && open.length === 0) {
      setBurst(true)
      toast.success('Week cleared!', 'Every task for this week is done. Take a breath.')
    }
    prevOpenCount.current = open.length
  }, [open.length, toast])

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
      {burst && <ConfettiBurst active={burst} onDone={() => setBurst(false)} />}

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
            <ProgressBar value={done.length} max={Math.max(1, totalCount)} size="xs" />
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-fg-muted">
          <span className="tabular-nums font-semibold text-fg">{done.length}</span>
          <span>/ {totalCount || 0}</span>
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
          {visible.map((t) => (
            <TodayTaskRow key={t.id} task={t} />
          ))}
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
      {([5, 6, 0].includes(new Date().getDay()) || done.length > 0) && open.length === 0 && done.length > 0 && (
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
  return (
    <div className="group flex items-start gap-2 px-4 py-2.5 transition hover:bg-bg-subtle/60">
      <button
        onClick={() => completeTask(task.id)}
        className="mt-0.5 grid h-5 w-5 flex-shrink-0 place-items-center rounded-full border border-border text-transparent transition hover:border-accent hover:text-accent/40"
        title="Mark done"
      >
        <CheckCircle2 className="h-3.5 w-3.5" />
      </button>
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
    </div>
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

import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Check, X as XIcon, MoreHorizontal, Pencil, Calendar, Trash2 } from 'lucide-react'
import { cn, relativeTime } from '@/lib/utils'
import { useToast } from './Toast'
import { completeTask, dropTask, reopenTask, deleteTasks, dueLabel, sourceLabel, addTask } from '@/lib/tasks'
import type { Task } from '@/lib/db'

interface Props {
  task: Task
  /** When true, hide the source chip (used in the Today panel where space is tight). */
  compact?: boolean
  /** Called after a state change so the parent can re-derive. */
  onChange?: () => void
}

export function TaskCard({ task, compact, onChange }: Props) {
  const [busy, setBusy] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(task.title)
  const [confirmingDrop, setConfirmingDrop] = useState(false)
  const toast = useToast()
  const inputRef = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const isDone = task.status === 'done'
  const isDropped = task.status === 'dropped'
  const src = sourceLabel(task)

  // Click-outside to close the menu
  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [menuOpen])

  useEffect(() => {
    if (editing) {
      setDraft(task.title)
      requestAnimationFrame(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      })
    }
  }, [editing, task.title])

  const onComplete = async () => {
    if (busy) return
    setBusy(true)
    try {
      await completeTask(task.id)
      onChange?.()
    } finally {
      setBusy(false)
    }
  }

  const onDropClick = () => {
    setConfirmingDrop(true)
    setMenuOpen(false)
  }

  const confirmDrop = async () => {
    setConfirmingDrop(false)
    setBusy(true)
    try {
      await dropTask(task.id)
      onChange?.()
    } finally {
      setBusy(false)
    }
  }

  const onReopen = async () => {
    setBusy(true)
    try {
      await reopenTask(task.id)
      onChange?.()
    } finally {
      setBusy(false)
    }
  }

  const onDelete = async () => {
    setBusy(true)
    try {
      await deleteTasks([task.id])
      setMenuOpen(false)
      onChange?.()
    } finally {
      setBusy(false)
    }
  }

  const onEditSave = async () => {
    const next = draft.trim()
    setEditing(false)
    if (!next || next === task.title) return
    setBusy(true)
    try {
      // Re-create with the new title to keep it simple (no separate edit fn).
      await deleteTasks([task.id])
      await addTask({
        title: next,
        source: task.source,
        sourceId: task.sourceId,
        conversationId: task.conversationId,
        artifactId: task.artifactId,
        messageId: task.messageId,
        dueAt: task.dueAt,
        weekOf: task.weekOf,
        notes: task.notes,
        proposedStrategy: task.proposedStrategy,
      })
      onChange?.()
    } finally {
      setBusy(false)
    }
  }

  if (editing) {
    return (
      <div
        className={cn(
          'flex items-center gap-2 rounded-2xl border bg-bg-subtle/60 p-2.5',
          'border-accent/40'
        )}
      >
        <span className="h-2 w-2 flex-shrink-0 rounded-full bg-accent" />
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              onEditSave()
            } else if (e.key === 'Escape') {
              setDraft(task.title)
              setEditing(false)
            }
          }}
          onBlur={onEditSave}
          className="min-w-0 flex-1 rounded-md border border-accent/40 bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-1 focus:ring-accent/40"
        />
      </div>
    )
  }

  return (
    <div
      className={cn(
        'group relative flex items-center gap-2.5 rounded-2xl border bg-bg-subtle/40 p-2.5 transition',
        isDone && 'opacity-60',
        isDropped && 'opacity-40',
        !isDone && !isDropped && 'hover:border-border hover:bg-bg-subtle/60'
      )}
    >
      {/* Checkbox */}
      <button
        onClick={isDone || isDropped ? onReopen : onComplete}
        disabled={busy}
        className={cn(
          'grid h-5 w-5 flex-shrink-0 place-items-center rounded-md border transition focus-ring',
          isDone
            ? 'border-success/50 bg-success/20 text-success'
            : isDropped
              ? 'border-border bg-bg-muted text-fg-subtle'
              : 'border-border bg-bg hover:border-accent hover:bg-accent/10'
        )}
        title={isDone ? 'Reopen' : isDropped ? 'Reopen' : 'Mark done'}
      >
        {isDone && <Check className="h-3 w-3" />}
        {isDropped && <XIcon className="h-3 w-3" />}
      </button>

      {/* Title + meta */}
      <div className="min-w-0 flex-1">
        <div
          className={cn(
            'truncate text-sm',
            isDone && 'line-through text-fg-muted',
            isDropped && 'line-through text-fg-subtle'
          )}
        >
          {task.title}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[10px]">
          <span className={cn('rounded-full px-1.5 py-0.5 font-medium', src.color)}>
            {src.label}
          </span>
          <span
            className={cn(
              'text-fg-subtle',
              task.dueAt && task.dueAt < Date.now() && task.status === 'open' && 'text-warning'
            )}
          >
            {dueLabel(task)}
          </span>
          {task.completedAt && isDone && (
            <span className="text-fg-subtle">· {relativeTime(task.completedAt)}</span>
          )}
        </div>
      </div>

      {/* Menu */}
      <div ref={menuRef} className="relative flex-shrink-0">
        <button
          onClick={() => setMenuOpen((o) => !o)}
          className="grid h-6 w-6 place-items-center rounded-md text-fg-subtle opacity-0 transition hover:bg-bg-muted hover:text-fg group-hover:opacity-100 focus:opacity-100"
          aria-label="Task actions"
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
        <AnimatePresence>
          {menuOpen && (
            <motion.div
              initial={{ opacity: 0, y: -4, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.97 }}
              transition={{ duration: 0.12 }}
              className="absolute right-0 top-7 z-10 min-w-[140px] overflow-hidden rounded-xl border border-border bg-bg shadow-soft"
            >
              {!compact && (
                <button
                  onClick={() => {
                    setMenuOpen(false)
                    setEditing(true)
                  }}
                  className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs text-fg-muted transition hover:bg-bg-muted hover:text-fg"
                >
                  <Pencil className="h-3 w-3" /> Rename
                </button>
              )}
              {(isDone || isDropped) && (
                <button
                  onClick={() => {
                    setMenuOpen(false)
                    onReopen()
                  }}
                  className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs text-fg-muted transition hover:bg-bg-muted hover:text-fg"
                >
                  <Calendar className="h-3 w-3" /> Reopen
                </button>
              )}
              {!isDone && !isDropped && (
                <button
                  onClick={onDropClick}
                  className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs text-fg-muted transition hover:bg-bg-muted hover:text-fg"
                >
                  <XIcon className="h-3 w-3" /> Drop
                </button>
              )}
              <button
                onClick={() => {
                  toast.info('Not yet', 'Editing due date ships in a follow-up.')
                  setMenuOpen(false)
                }}
                className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs text-fg-muted transition hover:bg-bg-muted hover:text-fg"
              >
                <Calendar className="h-3 w-3" /> Set due date
              </button>
              <button
                onClick={onDelete}
                className="flex w-full items-center gap-2 border-t border-border-subtle px-2.5 py-1.5 text-left text-xs text-danger transition hover:bg-danger/10"
              >
                <Trash2 className="h-3 w-3" /> Delete
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Drop confirm */}
      <AnimatePresence>
        {confirmingDrop && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4 backdrop-blur-sm"
            onClick={() => setConfirmingDrop(false)}
          >
            <motion.div
              initial={{ opacity: 0, y: 8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              transition={{ duration: 0.15 }}
              className="w-full max-w-sm rounded-2xl border border-border bg-bg p-5 shadow-soft"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="text-sm font-semibold">Drop this task?</div>
              <div className="mt-1 text-xs text-fg-muted">
                "{task.title}" will be moved to the trash. You can reopen it from the Done tab.
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <button
                  onClick={() => setConfirmingDrop(false)}
                  className="rounded-lg border border-border bg-bg-subtle px-3 py-1.5 text-xs font-medium transition hover:bg-bg-muted focus-ring"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmDrop}
                  className="rounded-lg bg-warning/90 px-3 py-1.5 text-xs font-medium text-bg transition hover:bg-warning focus-ring"
                >
                  Drop
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

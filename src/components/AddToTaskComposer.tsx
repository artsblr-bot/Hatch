import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, X, Check } from 'lucide-react'
import { addTask } from '@/lib/tasks'
import { useToast } from './Toast'

interface Props {
  /** Where the tasks come from. 'manual' is the Today widget. */
  source?: 'manual' | 'chat'
  conversationId?: string
  messageId?: string
  /** When the button is rendered as an icon button, collapse the placeholder. */
  variant?: 'inline' | 'icon'
  /** Optional pre-fill (e.g. first 80 chars of a chat message). */
  prefill?: string
  /** Called after a task is successfully created. */
  onCreated?: (id: string) => void
}

/**
 * Inline "Add to tasks" composer. Two variants:
 *   - `inline` (default): small input + button, used by the Today widget.
 *   - `icon`: a single "+" button that opens a small popover. Used by the
 *     "Add to tasks" button on chat messages.
 */
export function AddToTaskComposer({
  source = 'manual',
  conversationId,
  messageId,
  variant = 'inline',
  prefill,
  onCreated,
}: Props) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const toast = useToast()

  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus()
    }
  }, [open])

  useEffect(() => {
    if (prefill && open && !text) setText(prefill)
  }, [prefill, open, text])

  const submit = async () => {
    const t = text.trim()
    if (!t || saving) return
    setSaving(true)
    try {
      const created = await addTask({
        title: t,
        source,
        conversationId,
        messageId,
      })
      setDone(true)
      onCreated?.(created.id)
      setTimeout(() => {
        setDone(false)
        setOpen(false)
        setText('')
      }, 800)
      toast.success('Added to tasks', t)
    } catch (e: any) {
      toast.error('Could not add task', e?.message)
    } finally {
      setSaving(false)
    }
  }

  if (variant === 'icon') {
    return (
      <div className="relative">
        <button
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            setOpen((o) => !o)
          }}
          className="inline-flex items-center gap-1 rounded-full border border-border-subtle bg-bg-subtle/60 px-2 py-0.5 text-[10px] font-medium text-fg-muted opacity-0 transition hover:border-accent/40 hover:bg-accent/5 hover:text-accent group-hover:opacity-100 focus:opacity-100"
          title="Add to tasks"
        >
          <Plus className="h-2.5 w-2.5" />
          Tasks
        </button>
        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ opacity: 0, y: -4, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.97 }}
              transition={{ duration: 0.12 }}
              className="absolute right-0 top-7 z-20 w-72 rounded-2xl border border-border bg-bg p-2 shadow-soft"
            >
              <div className="flex items-center gap-2">
                <input
                  ref={inputRef}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      submit()
                    } else if (e.key === 'Escape') {
                      setOpen(false)
                      setText('')
                    }
                  }}
                  placeholder="What needs to happen?"
                  className="min-w-0 flex-1 rounded-lg border border-border bg-bg-subtle px-2.5 py-1.5 text-xs text-fg placeholder:text-fg-subtle focus:border-fg/20 focus:outline-none focus:ring-1 focus:ring-accent/30"
                />
                <button
                  onClick={submit}
                  disabled={!text.trim() || saving}
                  className="grid h-6 w-6 flex-shrink-0 place-items-center rounded-md bg-accent text-accent-fg transition hover:shadow-glow disabled:opacity-50"
                  title="Add"
                >
                  {done ? <Check className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
                </button>
                <button
                  onClick={() => {
                    setOpen(false)
                    setText('')
                  }}
                  className="grid h-6 w-6 flex-shrink-0 place-items-center rounded-md text-fg-subtle hover:bg-bg-muted hover:text-fg"
                  title="Cancel"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
              {prefill && text !== prefill && (
                <button
                  onClick={() => setText(prefill)}
                  className="mt-1.5 line-clamp-2 w-full rounded-md px-2 py-1 text-left text-[10px] text-fg-subtle transition hover:bg-bg-muted hover:text-fg"
                  title="Use the message as the task title"
                >
                  ↩ {prefill}
                </button>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2 rounded-2xl border border-dashed border-border bg-bg-subtle/30 p-1.5">
      <Plus className="h-3.5 w-3.5 flex-shrink-0 text-fg-subtle" />
      <input
        ref={inputRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            submit()
          } else if (e.key === 'Escape') {
            setText('')
            inputRef.current?.blur()
          }
        }}
        placeholder="Add a task…"
        className="min-w-0 flex-1 bg-transparent text-sm text-fg placeholder:text-fg-subtle focus:outline-none"
      />
      {text.trim() && (
        <button
          onClick={submit}
          disabled={saving}
          className="rounded-lg bg-accent px-2.5 py-0.5 text-xs font-medium text-accent-fg transition hover:shadow-glow focus-ring disabled:opacity-50"
        >
          {saving ? 'Adding…' : 'Add'}
        </button>
      )}
    </div>
  )
}

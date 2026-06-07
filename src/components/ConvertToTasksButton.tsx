import { useState, useEffect } from 'react'
import { Sparkles, Loader2, Check, X, ListChecks } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { db, type Artifact, type Settings } from '@/lib/db'
import {
  proposeTasksFromArtifact,
  commitProposedTasks,
  weekStart,
  type ProposeResult,
} from '@/lib/tasks'
import { useToast } from './Toast'
import { cn } from '@/lib/utils'

/**
 * Button on `plan90` and `strategy` artifact cards that extracts action
 * items from the markdown and offers to commit them as real `Task` rows.
 *
 * Behaviour:
 *   1. If the artifact already has a cached `proposedTasks` payload AND its
 *      content hash matches the current content, show the modal directly
 *      (instant — no parser run).
 *   2. Otherwise run the regex pass first. If that returns ≥1 task, show
 *      the modal immediately (no network call).
 *   3. If the regex pass returns 0, show an "AI is thinking…" spinner
 *      while the LLM fallback runs (uses the user's configured provider
 *      via `proposeTasksFromArtifact`).
 *   4. Empty result → show "Couldn't find any tasks" toast.
 */
export function ConvertToTasksButton({ artifact }: { artifact: Artifact }) {
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [proposed, setProposed] = useState<ProposeResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [checked, setChecked] = useState<boolean[]>([])
  const [notes, setNotes] = useState<string[]>([])

  // Re-render hook: when the artifact body changes externally, drop the
  // cached proposal. (The Editor writes back to Dexie via a debounced
  // effect, so we re-fetch the latest artifact and compare.)
  useEffect(() => {
    setProposed(null)
    setChecked([])
    setNotes([])
  }, [artifact.id, artifact.content])

  const handleClick = async () => {
    setOpen(true)
    // 1. Cache hit: same content + same id
    if (
      artifact.proposedTasks &&
      artifact.proposedTasks.ts > 0 &&
      artifact.proposedTasks.tasks.length > 0
    ) {
      setProposed({
        strategy: artifact.proposedTasks.strategy,
        tasks: artifact.proposedTasks.tasks,
      })
      setChecked(artifact.proposedTasks.tasks.map(() => true))
      setNotes(artifact.proposedTasks.tasks.map(() => ''))
      return
    }
    // 2/3. Run the parser (regex → LLM fallback inside)
    setLoading(true)
    try {
      const settings = (await db.settings.get('default')) as Settings | undefined
      if (!settings) {
        toast.error('Settings missing', 'Please set your provider in Settings first.')
        setOpen(false)
        return
      }
      const result = await proposeTasksFromArtifact(artifact, settings)
      if (result.tasks.length === 0) {
        toast.info('No tasks found', result.reason || 'Try a different artifact or write tasks manually.')
        setOpen(false)
        return
      }
      setProposed(result)
      setChecked(result.tasks.map(() => true))
      setNotes(result.tasks.map(() => ''))
    } catch (e: any) {
      toast.error('Could not extract tasks', e?.message || 'Unknown error')
      setOpen(false)
    } finally {
      setLoading(false)
    }
  }

  const handleCommit = async () => {
    if (!proposed) return
    const selected = proposed.tasks
      .map((t, i) => ({ ...t, notes: notes[i] }))
      .filter((_, i) => checked[i])
    if (selected.length === 0) {
      toast.info('Nothing to add', 'Tick at least one task first.')
      return
    }
    const count = await commitProposedTasks(artifact, selected)
    toast.success(
      `Added ${count} task${count === 1 ? '' : 's'}`,
      `Week of ${new Date(weekStart()).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
    )
    setOpen(false)
  }

  const selectCount = checked.filter(Boolean).length

  return (
    <>
      <button
        onClick={handleClick}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-bg-subtle px-2.5 py-1.5 text-xs font-medium text-fg-muted transition hover:border-accent/40 hover:bg-accent/5 hover:text-accent focus-ring"
        title="Extract action items as tasks"
      >
        <ListChecks className="h-3.5 w-3.5" />
        Convert to tasks
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4 backdrop-blur-sm"
            onClick={() => !loading && setOpen(false)}
          >
            <motion.div
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.98 }}
              transition={{ duration: 0.18 }}
              className="relative max-h-[85vh] w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-bg shadow-soft"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-2 border-b border-border-subtle bg-bg-subtle/40 px-4 py-3">
                <ListChecks className="h-4 w-4 text-accent" />
                <div className="flex-1">
                  <div className="text-sm font-semibold">Convert to tasks</div>
                  <div className="text-[11px] text-fg-muted">
                    {proposed
                      ? `Found ${proposed.tasks.length} action item${proposed.tasks.length === 1 ? '' : 's'} from "${artifact.title}"`
                      : 'Reading the artifact…'}
                  </div>
                </div>
                <button
                  onClick={() => setOpen(false)}
                  disabled={loading}
                  className="rounded-lg p-1.5 text-fg-subtle transition hover:bg-bg-muted hover:text-fg disabled:opacity-50"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="max-h-[60vh] overflow-y-auto p-4">
                {loading ? (
                  <div className="grid place-items-center gap-2 py-12 text-center">
                    <Loader2 className="h-5 w-5 animate-spin text-accent" />
                    <div className="text-xs text-fg-muted">
                      {proposed
                        ? 'Generating…'
                        : 'Extracting action items with AI fallback…'}
                    </div>
                  </div>
                ) : proposed ? (
                  <>
                    <div className="mb-3 flex items-center gap-2 text-[11px] text-fg-muted">
                      <span
                        className={cn(
                          'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-semibold',
                          proposed.strategy === 'regex'
                            ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                            : 'bg-violet-500/10 text-violet-700 dark:text-violet-400'
                        )}
                        title={
                          proposed.strategy === 'regex'
                            ? 'Extracted locally from headings + bullets — no API call'
                            : 'Used the AI fallback because the regex pass found nothing'
                        }
                      >
                        <Sparkles className="h-2.5 w-2.5" />
                        {proposed.strategy === 'regex' ? 'regex' : 'AI fallback'}
                      </span>
                      <span>·</span>
                      <span>
                        {selectCount} of {proposed.tasks.length} selected
                      </span>
                    </div>
                    <div className="space-y-1.5">
                      {proposed.tasks.map((t, i) => (
                        <div
                          key={i}
                          className={cn(
                            'rounded-xl border p-2.5 transition',
                            checked[i]
                              ? 'border-accent/40 bg-accent/5'
                              : 'border-border-subtle bg-bg-subtle/30'
                          )}
                        >
                          <label className="flex items-start gap-2">
                            <input
                              type="checkbox"
                              checked={checked[i]}
                              onChange={(e) => {
                                const next = [...checked]
                                next[i] = e.target.checked
                                setChecked(next)
                              }}
                              className="mt-0.5 h-3.5 w-3.5 rounded border-border accent-accent"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="text-sm text-fg">{t.title}</div>
                              {t.week && (
                                <div className="mt-0.5 text-[10px] text-fg-subtle">
                                  Week {t.week} · due{' '}
                                  {new Date(
                                    weekStart() + (t.week - 1) * 7 * 86400000 + 6 * 86400000
                                  ).toLocaleDateString(undefined, {
                                    month: 'short',
                                    day: 'numeric',
                                  })}
                                </div>
                              )}
                              {t.context && (
                                <div className="mt-1 text-[11px] text-fg-muted line-clamp-2">
                                  {t.context}
                                </div>
                              )}
                            </div>
                          </label>
                        </div>
                      ))}
                    </div>
                  </>
                ) : null}
              </div>

              {proposed && (
                <div className="flex items-center gap-2 border-t border-border-subtle bg-bg-subtle/40 px-4 py-3">
                  <button
                    onClick={() => {
                      setChecked(proposed.tasks.map(() => true))
                    }}
                    className="text-[11px] text-fg-muted underline-offset-2 hover:text-fg hover:underline"
                  >
                    Select all
                  </button>
                  <span className="text-[11px] text-fg-subtle">·</span>
                  <button
                    onClick={() => {
                      setChecked(proposed.tasks.map(() => false))
                    }}
                    className="text-[11px] text-fg-muted underline-offset-2 hover:text-fg hover:underline"
                  >
                    Clear
                  </button>
                  <div className="flex-1" />
                  <button
                    onClick={() => setOpen(false)}
                    className="rounded-lg px-3 py-1.5 text-xs font-medium text-fg-muted transition hover:bg-bg-muted hover:text-fg"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleCommit}
                    disabled={selectCount === 0}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg transition hover:shadow-glow disabled:opacity-50"
                  >
                    <Check className="h-3 w-3" />
                    Add {selectCount} task{selectCount === 1 ? '' : 's'}
                  </button>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}

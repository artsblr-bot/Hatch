import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Check,
  X,
  ChevronRight,
  ChevronLeft,
  Sparkles,
  PartyPopper,
  Target,
  Calendar,
  ArrowRight,
} from 'lucide-react'
import { db, type CheckIn } from '@/lib/db'
import { weekStart, weekEnd, tasksThisWeek, carryOverIncomplete } from '@/lib/tasks'
import { useToast } from './Toast'
import { cn } from '@/lib/utils'

type Step = 'shipped' | 'blockers' | 'next' | 'debrief'

function buildDebriefPrefill(shipped: string[], blockers: string[], next: string[]): string {
  const lines: string[] = ['Just closed the week. Here\'s where I landed:\n']
  if (shipped.length)
    lines.push(`✅ Shipped: ${shipped.slice(0, 3).join(', ')}${shipped.length > 3 ? ` (+${shipped.length - 3} more)` : ''}`)
  if (blockers.length)
    lines.push(`🚧 Blocked by: ${blockers.slice(0, 2).join(', ')}`)
  if (next.length)
    lines.push(`🎯 Next week: ${next.slice(0, 3).join(', ')}${next.length > 3 ? ` (+${next.length - 3} more)` : ''}`)
  lines.push('\nWhat\'s your read? What am I missing or should double down on?')
  return lines.join('\n')
}

export function EndWeekDialog({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const toast = useToast()
  const navigate = useNavigate()
  const [step, setStep] = useState<Step>('shipped')
  const [shipped, setShipped] = useState<string[]>([])
  const [blockers, setBlockers] = useState<string[]>([])
  const [next, setNext] = useState<string[]>([])
  const [summary, setSummary] = useState('')
  const [carryOver, setCarryOver] = useState(true)
  const [newItem, setNewItem] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setStep('shipped')
    setNewItem('')
    setSaving(false)
    setCarryOver(true)
    setSummary('')
    ;(async () => {
      const ws = weekStart()
      const all = await tasksThisWeek(ws)
      const done = all.filter((t) => t.status === 'done')
      const openTasks = all.filter((t) => t.status === 'open')
      setShipped(done.map((t) => t.title))
      setNext(openTasks.map((t) => t.title))
      const company = await db.company.get('singleton')
      setBlockers(company?.blockers || [])
    })()
  }, [open])

  const currentList = step === 'shipped' ? shipped : step === 'blockers' ? blockers : next
  const setCurrentList = step === 'shipped' ? setShipped : step === 'blockers' ? setBlockers : setNext

  const addItem = () => {
    if (!newItem.trim()) return
    setCurrentList([...currentList, newItem.trim()])
    setNewItem('')
  }

  const removeItem = (i: number) => {
    setCurrentList(currentList.filter((_, idx) => idx !== i))
  }

  const formSteps: { key: Step; label: string; icon: any }[] = [
    { key: 'shipped', label: 'Shipped', icon: PartyPopper },
    { key: 'blockers', label: 'In the way', icon: Target },
    { key: 'next', label: 'Next week', icon: Calendar },
  ]
  const currentIndex = formSteps.findIndex((s) => s.key === step)

  const nextStep = () => {
    if (currentIndex < formSteps.length - 1) {
      setStep(formSteps[currentIndex + 1].key)
      setNewItem('')
    }
  }
  const back = () => {
    if (currentIndex > 0) {
      setStep(formSteps[currentIndex - 1].key)
      setNewItem('')
    }
  }

  const submit = async () => {
    setSaving(true)
    try {
      const ws = weekStart()
      const checkIn: CheckIn = {
        id: `checkin-${ws}-${Date.now().toString(36)}`,
        weekOf: ws,
        summary: summary.trim() || defaultSummary(shipped, blockers, next),
        highlights: shipped,
        blockers,
        nextWeek: next,
        acknowledged: false,
      }
      await db.checkIns.put(checkIn)
      if (carryOver) {
        const count = await carryOverIncomplete(ws, weekStart(new Date(weekEnd(ws))))
        if (count > 0) toast.info(`Carried over ${count} open task${count === 1 ? '' : 's'} to next week`)
      }
      setStep('debrief')
    } catch (e: any) {
      toast.error('Could not save check-in', e?.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.18 }}
            className="relative flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border bg-bg shadow-soft"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header — hidden on debrief step */}
            {step !== 'debrief' && (
              <div className="flex items-center gap-2 border-b border-border-subtle bg-bg-subtle/40 px-4 py-3">
                <Sparkles className="h-4 w-4 text-accent" />
                <div className="flex-1">
                  <div className="text-sm font-semibold">End-of-week check-in</div>
                  <div className="text-[11px] text-fg-muted">
                    {new Date(weekStart()).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    {' – '}
                    {new Date(weekEnd(weekStart()) - 1).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  </div>
                </div>
                <button
                  onClick={onClose}
                  className="rounded-lg p-1.5 text-fg-subtle transition hover:bg-bg-muted hover:text-fg"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

            {/* Step indicator — hidden on debrief */}
            {step !== 'debrief' && (
              <StepIndicator steps={formSteps} currentIndex={currentIndex} />
            )}

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-4">
              <AnimatePresence mode="wait">
                {step === 'debrief' ? (
                  <motion.div
                    key="debrief"
                    initial={{ opacity: 0, scale: 0.94 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
                    className="flex flex-col items-center gap-4 py-6 text-center"
                  >
                    <motion.div
                      initial={{ scale: 0, rotate: -15 }}
                      animate={{ scale: 1, rotate: 0 }}
                      transition={{ type: 'spring', stiffness: 360, damping: 18, delay: 0.1 }}
                      className="text-5xl"
                    >
                      🎯
                    </motion.div>
                    <div>
                      <motion.div
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.2 }}
                        className="font-serif text-xl font-medium tracking-tight text-fg"
                      >
                        Week captured.
                      </motion.div>
                      <motion.p
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 0.3 }}
                        className="mt-1 text-sm text-fg-muted"
                      >
                        {shipped.length} shipped
                        {blockers.length > 0 && ` · ${blockers.length} blocked`}
                        {next.length > 0 && ` · ${next.length} committed`}
                      </motion.p>
                    </div>

                    <motion.div
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.35 }}
                      className="w-full max-w-xs rounded-xl border border-border bg-bg-subtle/40 p-3 text-left"
                    >
                      {shipped.length > 0 && (
                        <div className="flex items-start gap-1.5 text-xs text-fg-muted">
                          <span className="mt-0.5 flex-shrink-0">✅</span>
                          <span className="line-clamp-2">{shipped.slice(0, 2).join(', ')}{shipped.length > 2 ? ` +${shipped.length - 2}` : ''}</span>
                        </div>
                      )}
                      {blockers.length > 0 && (
                        <div className="mt-1 flex items-start gap-1.5 text-xs text-fg-muted">
                          <span className="mt-0.5 flex-shrink-0">🚧</span>
                          <span className="line-clamp-1">{blockers[0]}</span>
                        </div>
                      )}
                      {next.length > 0 && (
                        <div className="mt-1 flex items-start gap-1.5 text-xs text-fg-muted">
                          <span className="mt-0.5 flex-shrink-0">🎯</span>
                          <span className="line-clamp-1">{next[0]}{next.length > 1 ? ` +${next.length - 1}` : ''}</span>
                        </div>
                      )}
                    </motion.div>

                    <motion.div
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.45 }}
                      className="flex flex-col items-center gap-2 pt-2"
                    >
                      <motion.button
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
                        onClick={() => {
                          onClose()
                          navigate('/chat', { state: { prefill: buildDebriefPrefill(shipped, blockers, next) } })
                        }}
                        className="inline-flex items-center gap-2 rounded-2xl bg-accent px-5 py-2.5 text-sm font-medium text-accent-fg"
                      >
                        Get your cofounder's take
                        <ArrowRight className="h-4 w-4" />
                      </motion.button>
                      <button
                        onClick={onClose}
                        className="text-xs text-fg-muted transition hover:text-fg"
                      >
                        Close
                      </button>
                    </motion.div>
                  </motion.div>
                ) : (
                  <motion.div
                    key={step}
                    initial={{ opacity: 0, x: 12 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -12 }}
                    transition={{ duration: 0.16 }}
                    className="space-y-3"
                  >
                    <div>
                      {step === 'shipped' && (
                        <p className="text-xs text-fg-muted">
                          Pre-filled with tasks you completed this week. Edit, remove, or add to the wins.
                        </p>
                      )}
                      {step === 'blockers' && (
                        <p className="text-xs text-fg-muted">
                          What slowed you down? Pre-filled with your current memory blockers — replace with the real story.
                        </p>
                      )}
                      {step === 'next' && (
                        <p className="text-xs text-fg-muted">
                          Open tasks are pre-filled to carry over. Add the new bets you want to make next week.
                        </p>
                      )}
                    </div>

                    <div className="space-y-1.5">
                      {currentList.map((item, i) => (
                        <div
                          key={i}
                          className="flex items-start gap-2 rounded-lg border border-border-subtle bg-bg-subtle/30 px-2.5 py-1.5"
                        >
                          <div className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-accent" />
                          <div className="flex-1 min-w-0 text-sm">{item}</div>
                          <button
                            onClick={() => removeItem(i)}
                            className="rounded-md p-0.5 text-fg-subtle transition hover:bg-bg-muted hover:text-fg"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                      <div className="flex items-center gap-1.5 rounded-lg border border-dashed border-border bg-bg-subtle/20 px-2 py-1.5">
                        <input
                          value={newItem}
                          onChange={(e) => setNewItem(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault()
                              addItem()
                            }
                          }}
                          placeholder={
                            step === 'shipped'
                              ? 'A win from this week…'
                              : step === 'blockers'
                                ? 'Something that slowed you down…'
                                : 'A bet for next week…'
                          }
                          className="min-w-0 flex-1 bg-transparent text-sm placeholder:text-fg-subtle focus:outline-none"
                        />
                        <button
                          onClick={addItem}
                          disabled={!newItem.trim()}
                          className="rounded-md bg-accent px-2 py-0.5 text-xs font-medium text-accent-fg transition hover:shadow-glow disabled:opacity-30"
                        >
                          Add
                        </button>
                      </div>
                    </div>

                    {step === 'next' && (
                      <label className="mt-2 flex items-start gap-2 rounded-lg border border-border-subtle bg-bg/40 p-2.5 text-xs">
                        <input
                          type="checkbox"
                          checked={carryOver}
                          onChange={(e) => setCarryOver(e.target.checked)}
                          className="mt-0.5 h-3.5 w-3.5 rounded border-border accent-accent"
                        />
                        <div>
                          <div className="font-medium text-fg">Carry over open tasks</div>
                          <div className="text-fg-muted">
                            Move every still-open task to next week's queue with the same title.
                          </div>
                        </div>
                      </label>
                    )}

                    {step === 'next' && (
                      <div>
                        <label className="block text-[11px] font-medium text-fg-muted">
                          One-line summary (optional)
                        </label>
                        <textarea
                          value={summary}
                          onChange={(e) => setSummary(e.target.value)}
                          placeholder="The story of this week in one sentence."
                          rows={2}
                          className="mt-1 w-full resize-none rounded-lg border border-border bg-bg-subtle/40 px-2.5 py-1.5 text-xs text-fg placeholder:text-fg-subtle focus:border-fg/20 focus:outline-none focus:ring-2 focus:ring-accent/20"
                        />
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Footer — hidden on debrief step (buttons live inside the step) */}
            {step !== 'debrief' && (
              <div className="flex items-center gap-2 border-t border-border-subtle bg-bg-subtle/40 px-4 py-3">
                <button
                  onClick={back}
                  disabled={currentIndex === 0}
                  className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-fg-muted transition hover:bg-bg-muted hover:text-fg disabled:opacity-30"
                >
                  <ChevronLeft className="h-3 w-3" />
                  Back
                </button>
                <div className="flex-1" />
                {step !== 'next' ? (
                  <button
                    onClick={nextStep}
                    className="inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg transition hover:shadow-glow"
                  >
                    Next
                    <ChevronRight className="h-3 w-3" />
                  </button>
                ) : (
                  <button
                    onClick={submit}
                    disabled={saving}
                    className="inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg transition hover:shadow-glow disabled:opacity-50"
                  >
                    <Check className="h-3 w-3" />
                    {saving ? 'Saving…' : 'Save check-in'}
                  </button>
                )}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function StepIndicator({
  steps,
  currentIndex,
}: {
  steps: { key: Step; label: string; icon: any }[]
  currentIndex: number
}) {
  return (
    <div className="flex items-center gap-1.5 border-b border-border-subtle bg-bg/40 px-4 py-2.5">
      {steps.map((s, i) => {
        const active = i === currentIndex
        const done = i < currentIndex
        const Icon = s.icon
        return (
          <div key={s.key} className="flex flex-1 items-center gap-1.5">
            <div
              className={cn(
                'grid h-6 w-6 flex-shrink-0 place-items-center rounded-full border transition',
                active
                  ? 'border-accent bg-accent text-accent-fg'
                  : done
                    ? 'border-success/40 bg-success/10 text-success'
                    : 'border-border bg-bg-subtle text-fg-subtle'
              )}
            >
              {done ? <Check className="h-3 w-3" /> : <Icon className="h-3 w-3" />}
            </div>
            <div className={cn('text-[11px] font-medium', active ? 'text-fg' : 'text-fg-muted')}>{s.label}</div>
            {i < steps.length - 1 && (
              <div className={cn('ml-1.5 h-px flex-1', done ? 'bg-success/40' : 'bg-border-subtle')} />
            )}
          </div>
        )
      })}
    </div>
  )
}

function defaultSummary(shipped: string[], blockers: string[], next: string[]): string {
  const parts: string[] = []
  if (shipped.length) parts.push(`shipped ${shipped.length}`)
  if (blockers.length) parts.push(`hit ${blockers.length} blocker${blockers.length === 1 ? '' : 's'}`)
  if (next.length) parts.push(`planning ${next.length} for next week`)
  return parts.join(', ') || 'Quiet week'
}

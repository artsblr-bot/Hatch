import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, updateCompany, type CompanyMemory } from '@/lib/db'
import { Save, Plus, X, Brain, Sparkles, AlertCircle, Calendar } from 'lucide-react'
import { useToast } from '@/components/Toast'
import { motion, AnimatePresence } from 'framer-motion'
import { cn } from '@/lib/utils'
import { CheckInsList } from '@/components/CheckInsList'

const STAGES: { value: CompanyMemory['stage']; label: string; description: string }[] = [
  { value: 'idea', label: 'Idea', description: 'Concept stage, validating' },
  { value: 'validating', label: 'Validating', description: 'Talking to potential users' },
  { value: 'building', label: 'Building', description: 'Building the product' },
  { value: 'launched', label: 'Launched', description: 'Live with first users' },
  { value: 'growing', label: 'Growing', description: 'Scaling' },
]

export function Memory() {
  const company = useLiveQuery(() => db.company.get('singleton'), [])
  const events = useLiveQuery(() => db.memoryEvents.orderBy('ts').reverse().limit(20).toArray(), []) || []
  const pendingEvents = events.filter((e) => !e.confirmed)
  const [draft, setDraft] = useState<CompanyMemory | null>(null)
  const [isDirty, setIsDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [newBlocker, setNewBlocker] = useState('')
  const [activeTab, setActiveTab] = useState<'memory' | 'checkins'>('memory')
  const [searchParams, setSearchParams] = useSearchParams()
  const toast = useToast()

  // Honor ?tab=checkins deep link from the Today panel's "Wrap up the week"
  // entry point. We keep the param in sync when the user switches tabs
  // manually so the URL stays a shareable view of the current page.
  useEffect(() => {
    const t = searchParams.get('tab')
    if (t === 'checkins' && activeTab !== 'checkins') setActiveTab('checkins')
  }, [searchParams])
  useEffect(() => {
    const current = searchParams.get('tab') || 'memory'
    if (current !== activeTab) {
      const next = new URLSearchParams(searchParams)
      next.set('tab', activeTab)
      setSearchParams(next, { replace: true })
    }
  }, [activeTab])

  // Initial load: copy company into draft once
  useEffect(() => {
    if (company && !draft) setDraft(company)
  }, [company, draft])

  // External update (e.g. a memory extraction just landed). Only overwrite
  // the user's draft if they haven't started editing — otherwise we'd
  // silently destroy their in-progress changes.
  useEffect(() => {
    if (company && !isDirty) setDraft(company)
  }, [company, isDirty])

  if (!company || !draft) {
    return (
      <div className="grid flex-1 place-items-center">
        <div className="h-2 w-2 animate-pulse-soft rounded-full bg-accent" />
      </div>
    )
  }

  const save = async () => {
    setSaving(true)
    try {
      await updateCompany(draft)
      setIsDirty(false)
      toast.success('Memory saved')
    } catch (e: any) {
      toast.error('Save failed', e?.message)
    } finally {
      setSaving(false)
    }
  }

  const set = <K extends keyof CompanyMemory>(key: K, val: CompanyMemory[K]) => {
    setIsDirty(true)
    setDraft((d) => (d ? { ...d, [key]: val } : d))
  }

  const addBlocker = () => {
    if (!newBlocker.trim()) return
    set('blockers', [...draft.blockers, newBlocker.trim()])
    setNewBlocker('')
  }

  const removeBlocker = (i: number) => {
    set('blockers', draft.blockers.filter((_, idx) => idx !== i))
  }

  const acceptExtraction = async (id: string) => {
    const ev = events.find((e) => e.id === id)
    if (!ev?.after) return
    const ext = ev.after
    const patch: Partial<CompanyMemory> = {}
    if (ext.name) patch.name = ext.name
    if (ext.oneLiner) patch.oneLiner = ext.oneLiner
    if (ext.idea) patch.idea = ext.idea
    if (ext.icp) patch.icp = ext.icp
    if (ext.stage) patch.stage = ext.stage
    if (ext.goal90d) patch.goal90d = ext.goal90d
    if (ext.goal1y) patch.goal1y = ext.goal1y
    if (ext.blockers) patch.blockers = ext.blockers
    if (ext.newDecisions) {
      patch.decisions = [
        ...draft.decisions,
        ...ext.newDecisions.map((d: any) => ({ ts: Date.now(), decision: d.decision, rationale: d.rationale })),
      ]
    }
    if (ext.newMetrics) {
      patch.metrics = [
        ...draft.metrics,
        ...ext.newMetrics.map((m: any) => ({ name: m.name, value: m.value, updatedAt: Date.now() })),
      ]
    }
    if (ext.newOpenQuestions) {
      patch.openQuestions = [
        ...draft.openQuestions,
        ...ext.newOpenQuestions.map((q: any) => ({ q: q.q, status: q.status, answer: q.answer, ts: Date.now() })),
      ]
    }
    await updateCompany(patch)
    await db.memoryEvents.update(id, { confirmed: true })
    setIsDirty(false)
    toast.success('Memory updated', `Extracted from chat: ${ext.reasoning?.slice(0, 60) || 'updates'}`)
  }

  const dismissExtraction = async (id: string) => {
    await db.memoryEvents.update(id, { confirmed: true })
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <MemoryTabs active={activeTab} onChange={setActiveTab}>
          <MemoryTab id="memory" label="Memory" icon={Brain} active={activeTab} onChange={setActiveTab}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">
                  <Brain className="h-3 w-3" />
                  <span>Company memory</span>
                </div>
                <h1 className="mt-2 font-serif text-3xl font-medium tracking-tight">What Hatch knows about your business</h1>
                <p className="mt-2 text-fg-muted">Edit anything. Hatch uses this in every conversation.</p>
              </div>
              <button
                onClick={save}
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-2xl bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition hover:shadow-glow focus-ring disabled:opacity-50"
              >
                <Save className="h-3.5 w-3.5" />
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>

        {/* Pending extractions */}
        <AnimatePresence>
          {pendingEvents.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              className="mt-6 space-y-2"
            >
              {pendingEvents.map((ev) => {
                const ext = ev.after as any
                if (!ext) return null
                const fields = Object.keys(ext).filter((k) => k !== 'reasoning' && ext[k])
                if (fields.length === 0) return null
                return (
                  <div key={ev.id} className="flex items-start gap-3 rounded-2xl border border-accent/40 bg-accent/5 p-4">
                    <Sparkles className="mt-0.5 h-4 w-4 flex-shrink-0 text-accent" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium">Hatch learned something new</div>
                      <div className="mt-1 text-xs text-fg-muted">
                        {ext.reasoning || `Updates to: ${fields.join(', ')}`}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {fields.slice(0, 6).map((f) => (
                          <span key={f} className="rounded-full bg-bg px-2 py-0.5 text-[10px] text-fg-muted">
                            {f}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => acceptExtraction(ev.id)}
                        className="rounded-lg bg-accent px-2.5 py-1 text-xs font-medium text-accent-fg hover:shadow-glow"
                      >
                        Apply
                      </button>
                      <button
                        onClick={() => dismissExtraction(ev.id)}
                        className="rounded-lg p-1.5 text-fg-subtle hover:bg-bg-muted hover:text-fg"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                )
              })}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Form */}
        <div className="mt-8 space-y-6">
          <Field label="Business name">
            <input
              value={draft.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="e.g. Hatch"
              className="w-full rounded-xl border border-border bg-bg-subtle/40 px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-fg/20 focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
          </Field>

          <Field label="One-liner" hint="One sentence that explains your business.">
            <input
              value={draft.oneLiner}
              onChange={(e) => set('oneLiner', e.target.value)}
              placeholder="e.g. An AI cofounder for non-technical founders."
              className="w-full rounded-xl border border-border bg-bg-subtle/40 px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-fg/20 focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
          </Field>

          <Field label="The idea" hint="Longer description of what you're building.">
            <textarea
              value={draft.idea}
              onChange={(e) => set('idea', e.target.value)}
              placeholder="What is it, who is it for, what problem does it solve?"
              rows={4}
              className="w-full resize-none rounded-xl border border-border bg-bg-subtle/40 px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-fg/20 focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
          </Field>

          <Field label="Ideal customer" hint="Be specific. A real human, not a segment.">
            <textarea
              value={draft.icp}
              onChange={(e) => set('icp', e.target.value)}
              placeholder="e.g. First-time founders with no technical background, in their 30s, working on a B2C product."
              rows={3}
              className="w-full resize-none rounded-xl border border-border bg-bg-subtle/40 px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-fg/20 focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
          </Field>

          <Field label="Stage">
            <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
              {STAGES.map((s) => (
                <button
                  key={s.value}
                  onClick={() => set('stage', s.value)}
                  className={cn(
                    'flex flex-col items-start rounded-xl border p-3 text-left transition focus-ring',
                    draft.stage === s.value
                      ? 'border-accent/40 bg-accent/10'
                      : 'border-border bg-bg-subtle/30 hover:bg-bg-muted'
                  )}
                >
                  <div className="text-sm font-medium">{s.label}</div>
                  <div className="text-[10px] text-fg-subtle">{s.description}</div>
                </button>
              ))}
            </div>
          </Field>

          <div className="grid gap-6 md:grid-cols-2">
            <Field label="90-day goal" hint="What does success look like in 90 days?">
              <textarea
                value={draft.goal90d}
                onChange={(e) => set('goal90d', e.target.value)}
                placeholder="e.g. 100 signups, 10 paying customers."
                rows={3}
                className="w-full resize-none rounded-xl border border-border bg-bg-subtle/40 px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-fg/20 focus:outline-none focus:ring-2 focus:ring-accent/20"
              />
            </Field>
            <Field label="1-year goal" hint="Where do you want to be in a year?">
              <textarea
                value={draft.goal1y}
                onChange={(e) => set('goal1y', e.target.value)}
                placeholder="e.g. $10k MRR, full-time on the business."
                rows={3}
                className="w-full resize-none rounded-xl border border-border bg-bg-subtle/40 px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-fg/20 focus:outline-none focus:ring-2 focus:ring-accent/20"
              />
            </Field>
          </div>

          <Field label="Current blockers" hint="What's getting in the way right now?">
            <div className="space-y-2">
              {draft.blockers.map((b, i) => (
                <div key={i} className="flex items-center gap-2 rounded-lg border border-border bg-bg-subtle/40 px-3 py-2 text-sm">
                  <AlertCircle className="h-3.5 w-3.5 text-warning" />
                  <span className="flex-1">{b}</span>
                  <button onClick={() => removeBlocker(i)} className="text-fg-subtle hover:text-danger">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              <div className="flex items-center gap-2">
                <input
                  value={newBlocker}
                  onChange={(e) => setNewBlocker(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addBlocker()}
                  placeholder="Add a blocker…"
                  className="w-full flex-1 rounded-xl border border-border bg-bg-subtle/40 px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-fg/20 focus:outline-none focus:ring-2 focus:ring-accent/20"
                />
                <button onClick={addBlocker} className="rounded-lg bg-bg-muted p-2 text-fg-muted hover:bg-bg-muted/60 hover:text-fg">
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </Field>

          {draft.decisions.length > 0 && (
            <Field label="Decisions made" hint="Important decisions you've made. Hatch references these.">
              <div className="space-y-1.5">
                {[...draft.decisions].reverse().slice(0, 10).map((d, i) => (
                  <div key={i} className="rounded-lg border border-border-subtle bg-bg-subtle/30 p-2.5 text-sm">
                    <div className="flex items-baseline gap-2">
                      <span className="text-fg-subtle text-[10px] tabular-nums">
                        {new Date(d.ts).toLocaleDateString()}
                      </span>
                      <span className="flex-1">{d.decision}</span>
                    </div>
                    {d.rationale && <div className="mt-1 text-xs text-fg-muted">Because: {d.rationale}</div>}
                  </div>
                ))}
              </div>
            </Field>
          )}
          </div>
        </MemoryTab>

        <MemoryTab id="checkins" label="Weekly check-ins" icon={Calendar} active={activeTab} onChange={setActiveTab}>
          <CheckInsList />
        </MemoryTab>
        </MemoryTabs>
      </div>
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium">{label}</label>
      {hint && <p className="mt-0.5 text-xs text-fg-muted">{hint}</p>}
      <div className="mt-2">{children}</div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tabs (controlled, simple)
// ---------------------------------------------------------------------------

function MemoryTabs({
  active,
  onChange,
  children,
}: {
  active: 'memory' | 'checkins'
  onChange: (id: 'memory' | 'checkins') => void
  children: React.ReactNode
}) {
  const tabs = [
    { id: 'memory' as const, label: 'Memory', icon: Brain },
    { id: 'checkins' as const, label: 'Weekly check-ins', icon: Calendar },
  ]
  return (
    <div>
      <div className="mb-6 flex items-center gap-1 border-b border-border-subtle">
        {tabs.map((t) => {
          const Icon = t.icon
          const isActive = active === t.id
          return (
            <button
              key={t.id}
              onClick={() => onChange(t.id)}
              className={cn(
                'inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition',
                isActive
                  ? 'border-accent text-fg'
                  : 'border-transparent text-fg-muted hover:text-fg'
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {t.label}
            </button>
          )
        })}
      </div>
      {children}
    </div>
  )
}

function MemoryTab({
  id,
  active,
  onChange: _onChange,
  children,
}: {
  id: 'memory' | 'checkins'
  label: string
  icon: any
  active: 'memory' | 'checkins'
  onChange: (id: 'memory' | 'checkins') => void
  children: React.ReactNode
}) {
  if (active !== id) return null
  return <div>{children}</div>
}

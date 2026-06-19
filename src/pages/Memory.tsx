import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, updateCompany, updateFounderProfile, getFounderProfile, type CompanyMemory } from '@/lib/db'
import { Save, Plus, X, Brain, Sparkles, AlertCircle, Calendar, User, Archive, BookText, Trash2, Loader2, RefreshCw, ChevronDown } from 'lucide-react'
import { useToast } from '@/components/Toast'
import { motion, AnimatePresence } from 'framer-motion'
import { cn } from '@/lib/utils'
import { CheckInsList } from '@/components/CheckInsList'
import { deleteMemoryNode } from '@/lib/memoryNodes'
import { compactMemory } from '@/lib/chat'
import { type ProviderId } from '@/lib/providers'

const STAGES: { value: CompanyMemory['stage']; label: string; description: string }[] = [
  { value: 'idea', label: 'Idea', description: 'Concept stage, validating' },
  { value: 'validating', label: 'Validating', description: 'Talking to potential users' },
  { value: 'building', label: 'Building', description: 'Building the product' },
  { value: 'launched', label: 'Launched', description: 'Live with first users' },
  { value: 'growing', label: 'Growing', description: 'Scaling' },
]

type TabId = 'memory' | 'profile' | 'archive' | 'digest' | 'checkins'

export function Memory() {
  const company = useLiveQuery(() => db.company.get('singleton'), [])
  const events = useLiveQuery(() => db.memoryEvents.orderBy('ts').reverse().limit(20).toArray(), []) || []
  const pendingEvents = events.filter((e) => !e.confirmed)
  const [draft, setDraft] = useState<CompanyMemory | null>(null)
  const [isDirty, setIsDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [newBlocker, setNewBlocker] = useState('')
  const [searchParams, setSearchParams] = useSearchParams()
  const toast = useToast()

  // Derive the active tab straight from the URL so deep links (?tab=...) and
  // manual tab switches share one source of truth. (Mirroring the param into
  // separate state with two effects caused an infinite render loop on any deep
  // link where tab !== 'memory', because the effects clobbered each other.)
  const VALID_TABS: TabId[] = ['memory', 'profile', 'archive', 'digest', 'checkins']
  const tabParam = searchParams.get('tab')
  const activeTab: TabId =
    tabParam && VALID_TABS.includes(tabParam as TabId) ? (tabParam as TabId) : 'memory'
  const setActiveTab = useCallback(
    (tab: TabId) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          next.set('tab', tab)
          return next
        },
        { replace: true }
      )
    },
    [setSearchParams]
  )

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
    // Merge extraction into the local draft without clearing isDirty — this
    // preserves any in-progress user edits in fields the extraction didn't touch.
    setDraft((d) => d ? { ...d, ...patch } : d)
    toast.success('Memory updated', `Extracted from chat: ${ext.reasoning?.slice(0, 60) || 'updates'}`)
  }

  const dismissExtraction = async (id: string) => {
    await db.memoryEvents.update(id, { confirmed: true })
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <MemoryTabs active={activeTab} onChange={setActiveTab}>
          <MemoryTab id="memory" label="Core" icon={Brain} active={activeTab} onChange={setActiveTab}>
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
                  <div key={ev.id} className="flex items-start gap-3 rounded-2xl border border-border-subtle bg-bg-subtle/40 p-5 transition hover:border-border">
                    <Sparkles className="mt-0.5 h-4 w-4 flex-shrink-0 text-accent" />
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">What I learned</div>
                      <div className="mt-1.5 text-sm text-fg">
                        {ext.reasoning || `Updates to: ${fields.join(', ')}`}
                      </div>
                      <div className="mt-2.5 flex flex-wrap gap-1.5">
                        {fields.slice(0, 6).map((f) => (
                          <span key={f} className="rounded-full bg-bg-muted px-2 py-0.5 text-[10px] text-fg-muted">
                            {f}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => acceptExtraction(ev.id)}
                        className="rounded-xl bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg transition hover:shadow-glow"
                      >
                        Apply
                      </button>
                      <button
                        onClick={() => dismissExtraction(ev.id)}
                        className="rounded-xl p-1.5 text-fg-subtle transition hover:bg-bg-muted hover:text-fg"
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
        <div className="mt-8 space-y-6 rounded-2xl border border-border-subtle bg-bg-subtle/40 p-6 md:p-8">
          <Field label="Business name">
            <input
              value={draft.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="e.g. Hatch"
              className="w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-fg/20 focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
          </Field>

          <Field label="One-liner" hint="One sentence that explains your business.">
            <input
              value={draft.oneLiner}
              onChange={(e) => set('oneLiner', e.target.value)}
              placeholder="e.g. An AI cofounder for non-technical founders."
              className="w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-fg/20 focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
          </Field>

          <Field label="The idea" hint="Longer description of what you're building.">
            <textarea
              value={draft.idea}
              onChange={(e) => set('idea', e.target.value)}
              placeholder="What is it, who is it for, what problem does it solve?"
              rows={4}
              className="w-full resize-none rounded-xl border border-border bg-bg px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-fg/20 focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
          </Field>

          <Field label="Ideal customer" hint="Be specific. A real human, not a segment.">
            <textarea
              value={draft.icp}
              onChange={(e) => set('icp', e.target.value)}
              placeholder="e.g. First-time founders with no technical background, in their 30s, working on a B2C product."
              rows={3}
              className="w-full resize-none rounded-xl border border-border bg-bg px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-fg/20 focus:outline-none focus:ring-2 focus:ring-accent/20"
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
                      ? 'border-accent/50 bg-accent/10 text-accent'
                      : 'border-border bg-bg hover:bg-bg-muted'
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
                className="w-full resize-none rounded-xl border border-border bg-bg px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-fg/20 focus:outline-none focus:ring-2 focus:ring-accent/20"
              />
            </Field>
            <Field label="1-year goal" hint="Where do you want to be in a year?">
              <textarea
                value={draft.goal1y}
                onChange={(e) => set('goal1y', e.target.value)}
                placeholder="e.g. $10k MRR, full-time on the business."
                rows={3}
                className="w-full resize-none rounded-xl border border-border bg-bg px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-fg/20 focus:outline-none focus:ring-2 focus:ring-accent/20"
              />
            </Field>
          </div>

          <Field label="Current blockers" hint="What's getting in the way right now?">
            <div className="space-y-2">
              {draft.blockers.map((b, i) => (
                <div key={i} className="flex items-center gap-2 rounded-xl border border-border bg-bg px-3 py-2 text-sm">
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
                  className="w-full flex-1 rounded-xl border border-border bg-bg px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-fg/20 focus:outline-none focus:ring-2 focus:ring-accent/20"
                />
                <button onClick={addBlocker} className="rounded-xl bg-bg-muted p-2 text-fg-muted transition hover:bg-bg-muted/60 hover:text-fg">
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </Field>

          {draft.decisions.length > 0 && (
            <Field label="Decisions made" hint="Important decisions you've made. Hatch references these.">
              <div className="space-y-1.5">
                {[...draft.decisions].reverse().slice(0, 10).map((d, i) => (
                  <div key={i} className="rounded-xl border border-border-subtle bg-bg p-2.5 text-sm">
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

          <MemoryTab id="profile" label="Profile" icon={User} active={activeTab} onChange={setActiveTab}>
            <ProfileTab toast={toast} />
          </MemoryTab>

          <MemoryTab id="archive" label="Archive" icon={Archive} active={activeTab} onChange={setActiveTab}>
            <ArchiveTab toast={toast} />
          </MemoryTab>

          <MemoryTab id="digest" label="Digest" icon={BookText} active={activeTab} onChange={setActiveTab}>
            <DigestTab toast={toast} />
          </MemoryTab>

        <MemoryTab id="checkins" label="Check-ins" icon={Calendar} active={activeTab} onChange={setActiveTab}>
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
  active: TabId
  onChange: (id: TabId) => void
  children: React.ReactNode
}) {
  const tabs: { id: TabId; label: string; icon: any }[] = [
    { id: 'memory', label: 'Core', icon: Brain },
    { id: 'profile', label: 'Profile', icon: User },
    { id: 'archive', label: 'Archive', icon: Archive },
    { id: 'digest', label: 'Digest', icon: BookText },
    { id: 'checkins', label: 'Check-ins', icon: Calendar },
  ]
  return (
    <div>
      <div className="mb-8 flex items-center gap-1 overflow-x-auto rounded-2xl border border-border-subtle bg-bg-subtle/40 p-1">
        {tabs.map((t) => {
          const Icon = t.icon
          const isActive = active === t.id
          return (
            <button
              key={t.id}
              onClick={() => onChange(t.id)}
              className={cn(
                'inline-flex flex-shrink-0 items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-medium transition',
                isActive
                  ? 'bg-accent/10 text-accent'
                  : 'text-fg-muted hover:bg-bg-muted/60 hover:text-fg'
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
  children,
}: {
  id: TabId
  label: string
  icon: any
  active: TabId
  onChange: (id: TabId) => void
  children: React.ReactNode
}) {
  if (active !== id) return null
  return <div>{children}</div>
}

// ---------------------------------------------------------------------------
// Profile tab (user.md — freeform founder profile)
// ---------------------------------------------------------------------------

function ProfileTab({ toast }: { toast: ReturnType<typeof useToast> }) {
  const [content, setContent] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    getFounderProfile().then((p) => {
      if (p?.content) setContent(p.content)
      setLoaded(true)
    })
  }, [])

  const save = async () => {
    setSaving(true)
    try {
      await updateFounderProfile(content)
      setDirty(false)
      toast.success('Profile saved')
    } catch (e: any) {
      toast.error('Save failed', e?.message)
    } finally {
      setSaving(false)
    }
  }

  if (!loaded) {
    return <div className="grid h-32 place-items-center"><div className="h-2 w-2 animate-pulse-soft rounded-full bg-accent" /></div>
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">
            <User className="h-3 w-3" />
            <span>Founder profile</span>
          </div>
          <h1 className="mt-2 font-serif text-3xl font-medium tracking-tight">About you</h1>
          <p className="mt-2 text-fg-muted">Write anything about yourself — background, motivations, constraints. Hatch injects this into every conversation.</p>
        </div>
        <button
          onClick={save}
          disabled={saving || !dirty}
          className="inline-flex items-center gap-1.5 rounded-2xl bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition hover:shadow-glow focus-ring disabled:opacity-50"
        >
          <Save className="h-3.5 w-3.5" />
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      <div className="mt-8">
        <textarea
          value={content}
          onChange={(e) => { setContent(e.target.value); setDirty(true) }}
          placeholder={`Example:\nI'm a former teacher who wants to build an edtech product for middle schoolers. I have 6 months runway and work evenings. My biggest constraint is time, not money. I'm comfortable writing but not technical at all.`}
          rows={16}
          className="w-full resize-y rounded-xl border border-border bg-bg-subtle/40 px-4 py-3 font-mono text-sm text-fg placeholder:text-fg-subtle focus:border-fg/20 focus:outline-none focus:ring-2 focus:ring-accent/20"
        />
        <p className="mt-2 text-xs text-fg-subtle">Markdown is supported. This is your private profile — it's never shown to others.</p>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Archive tab (free-form memory nodes)
// ---------------------------------------------------------------------------

const NODE_TYPE_COLORS: Record<string, { badge: string; dot: string }> = {
  insight:  { badge: 'bg-sun-1/15 text-sun-1',     dot: 'bg-sun-1' },
  decision: { badge: 'bg-success/15 text-success', dot: 'bg-success' },
  context:  { badge: 'bg-sun-3/15 text-sun-3',     dot: 'bg-sun-3' },
  metric:   { badge: 'bg-accent/15 text-accent',   dot: 'bg-accent' },
  question: { badge: 'bg-warning/15 text-warning', dot: 'bg-warning' },
  learning: { badge: 'bg-sun-2/15 text-sun-2',     dot: 'bg-sun-2' },
}

function ArchiveTab({ toast }: { toast: ReturnType<typeof useToast> }) {
  const nodes = useLiveQuery(() => db.memoryNodes.orderBy('createdAt').reverse().toArray(), []) || []
  const [filterType, setFilterType] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const filtered = nodes.filter((n) => {
    if (filterType !== 'all' && n.type !== filterType) return false
    if (search.trim()) {
      const q = search.toLowerCase()
      return n.content.toLowerCase().includes(q) || n.tags.some((t) => t.toLowerCase().includes(q))
    }
    return true
  })

  const handleDelete = async (id: string) => {
    try {
      await deleteMemoryNode(id)
      toast.success('Memory deleted')
    } catch (e: any) {
      toast.error('Delete failed', e?.message)
    }
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">
            <Archive className="h-3 w-3" />
            <span>Memory archive</span>
          </div>
          <h1 className="mt-2 font-serif text-3xl font-medium tracking-tight">Long-term memory</h1>
          <p className="mt-2 text-fg-muted">
            Auto-extracted after every conversation. {nodes.length} node{nodes.length === 1 ? '' : 's'} stored.
            {nodes.filter((n) => n.compacted).length > 0 && ` ${nodes.filter((n) => n.compacted).length} compacted into digest.`}
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search memories…"
          className="min-w-0 flex-1 rounded-xl border border-border bg-bg-subtle/40 px-3 py-1.5 text-sm text-fg placeholder:text-fg-subtle focus:border-fg/20 focus:outline-none focus:ring-2 focus:ring-accent/20"
        />
        <div className="flex flex-wrap gap-1">
          {['all', 'insight', 'decision', 'context', 'metric', 'question', 'learning'].map((t) => (
            <button
              key={t}
              onClick={() => setFilterType(t)}
              className={cn(
                'rounded-full px-2.5 py-1 text-xs font-medium transition',
                filterType === t
                  ? 'bg-accent text-accent-fg'
                  : 'bg-bg-muted text-fg-muted hover:bg-bg-muted/60 hover:text-fg'
              )}
            >
              {t === 'all' ? 'All' : t}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 && (
        <div className="mt-12 grid place-items-center text-center">
          <Brain className="h-8 w-8 text-fg-subtle" />
          <p className="mt-3 text-sm text-fg-muted">
            {nodes.length === 0
              ? 'No memories archived yet. They appear here after your first conversation.'
              : 'No memories match your filter.'}
          </p>
        </div>
      )}

      <motion.div
        className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2"
        initial="hidden"
        animate="visible"
        variants={{ visible: { transition: { staggerChildren: 0.04 } }, hidden: {} }}
      >
        <AnimatePresence>
          {filtered.map((node) => {
            const colors = NODE_TYPE_COLORS[node.type] || { badge: 'bg-bg-muted text-fg-muted', dot: 'bg-fg-subtle' }
            const isExpanded = expandedId === node.id
            return (
              <motion.div
                key={node.id}
                layout
                variants={{
                  hidden: { opacity: 0, y: 8 },
                  visible: { opacity: 1, y: 0 },
                }}
                exit={{ opacity: 0, scale: 0.97 }}
                className="group rounded-2xl border border-border bg-bg-subtle/40 p-4 transition hover:border-border-subtle/60 hover:bg-bg-subtle/60"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${colors.badge}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${colors.dot}`} />
                      {node.type}
                    </span>
                    {node.tags.map((tag) => (
                      <span key={tag} className="rounded-full bg-bg-muted px-2 py-0.5 text-[10px] text-fg-subtle">
                        {tag}
                      </span>
                    ))}
                    {node.compacted && (
                      <span className="rounded-full bg-bg-muted px-2 py-0.5 text-[10px] text-fg-subtle">
                        compacted
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => handleDelete(node.id)}
                    className="flex-shrink-0 rounded-lg p-1 text-fg-subtle opacity-0 transition hover:bg-bg-muted hover:text-danger group-hover:opacity-100"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>

                <div className="mt-2.5">
                  <p className={cn('text-sm leading-relaxed text-fg', !isExpanded && node.content.length > 120 && 'line-clamp-3')}>
                    {node.content}
                  </p>
                  {node.content.length > 120 && (
                    <button
                      onClick={() => setExpandedId(isExpanded ? null : node.id)}
                      className="mt-1 flex items-center gap-1 text-[11px] text-fg-subtle hover:text-fg"
                    >
                      <ChevronDown className={cn('h-3 w-3 transition-transform', isExpanded && 'rotate-180')} />
                      {isExpanded ? 'Show less' : 'Show more'}
                    </button>
                  )}
                </div>

                {/* Importance bar */}
                <div className="mt-3 flex items-center gap-2">
                  <div className="h-1 flex-1 overflow-hidden rounded-full bg-bg-muted">
                    <div
                      className="h-full rounded-full bg-accent/60 transition-all"
                      style={{ width: `${Math.round(node.importance * 100)}%` }}
                    />
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-fg-subtle">
                    {node.recallCount > 0 && <span>{node.recallCount}× recalled</span>}
                    <span>{new Date(node.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                  </div>
                </div>
              </motion.div>
            )
          })}
        </AnimatePresence>
      </motion.div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Digest tab (memory.md — compacted prose summary)
// ---------------------------------------------------------------------------

function DigestTab({ toast }: { toast: ReturnType<typeof useToast> }) {
  const digest = useLiveQuery(() => db.memoryDigest.get('singleton'), [])
  const uncompactedCount = useLiveQuery(async () => {
    const all = await db.memoryNodes.toArray()
    return all.filter((n) => !n.compacted).length
  }, []) ?? 0
  const settings = useLiveQuery(() => db.settings.get('singleton'), [])
  const [compacting, setCompacting] = useState(false)

  const handleCompact = useCallback(async () => {
    const provider = (settings?.defaultProvider as ProviderId) || 'browser-ai'
    if (provider === 'browser-ai') {
      toast.error('Compaction unavailable', 'Add an API key in Settings to use this feature.')
      return
    }
    setCompacting(true)
    try {
      const result = await compactMemory(provider, settings?.defaultModel || '')
      if (result) {
        toast.success('Digest updated', `${uncompactedCount} memor${uncompactedCount === 1 ? 'y' : 'ies'} compacted.`)
      } else {
        toast.info('Nothing to compact', 'All memories are already in the digest.')
      }
    } catch (e: any) {
      toast.error('Compaction failed', e?.message)
    } finally {
      setCompacting(false)
    }
  }, [settings, uncompactedCount, toast])

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">
            <BookText className="h-3 w-3" />
            <span>Memory digest</span>
          </div>
          <h1 className="mt-2 font-serif text-3xl font-medium tracking-tight">Compacted memory</h1>
          <p className="mt-2 text-fg-muted">
            A prose summary of your archived memories, injected into every conversation.
            Auto-compacts at 40 uncompacted nodes.
            {uncompactedCount > 0 && (
              <span className={cn('ml-1 font-medium', uncompactedCount >= 30 ? 'text-warning' : 'text-fg')}>
                {uncompactedCount}/40 uncompacted.
              </span>
            )}
          </p>
        </div>
        <button
          onClick={handleCompact}
          disabled={compacting || uncompactedCount === 0}
          className="inline-flex items-center gap-1.5 rounded-2xl bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition hover:shadow-glow focus-ring disabled:opacity-50"
        >
          {compacting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          {compacting ? 'Compacting…' : 'Compact now'}
        </button>
      </div>

      {digest ? (
        <div className="mt-8">
          <div className="flex items-center justify-between">
            <span className="text-xs text-fg-subtle">
              {digest.nodeCount} node{digest.nodeCount === 1 ? '' : 's'} · last updated {new Date(digest.generatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </span>
          </div>
          <div className="mt-3 rounded-2xl border border-border bg-bg-subtle/40 px-5 py-4">
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-fg">{digest.content}</p>
          </div>
          <p className="mt-3 text-xs text-fg-subtle">This text is read-only — it's auto-generated from your archived memories. Edit memories in the Archive tab.</p>
        </div>
      ) : (
        <div className="mt-12 grid place-items-center text-center">
          <BookText className="h-8 w-8 text-fg-subtle" />
          <p className="mt-3 text-sm text-fg-muted">No digest yet. Archive memories first, then click "Compact now".</p>
          {uncompactedCount > 0 && (
            <button
              onClick={handleCompact}
              disabled={compacting}
              className="mt-4 inline-flex items-center gap-1.5 rounded-2xl bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:shadow-glow focus-ring disabled:opacity-50"
            >
              {compacting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              {compacting ? 'Compacting…' : `Compact ${uncompactedCount} memor${uncompactedCount === 1 ? 'y' : 'ies'}`}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

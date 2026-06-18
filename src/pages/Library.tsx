import { useState, useMemo, useEffect } from 'react'
import { Link, useSearchParams, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/lib/db'
import { ARTIFACT_TEMPLATES, ARTIFACT_LIST } from '@/lib/artifacts'
import { searchArtifacts } from '@/lib/artifactSearch'
import { Search, Pin, Plus, Download, Trash2, FileText, X, FlaskConical, Database, Check, AlertCircle, Sparkles } from 'lucide-react'
import { relativeTime } from '@/lib/utils'
import { useToast } from '@/components/Toast'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { nanoid } from 'nanoid'
import { motion, AnimatePresence } from 'framer-motion'
import { AmbientAurora } from '@/components/AmbientAurora'
import { ConvertToTasksButton } from '@/components/ConvertToTasksButton'
import { cn } from '@/lib/utils'

export function Library() {
  const artifacts = useLiveQuery(() => db.artifacts.orderBy('updatedAt').reverse().toArray(), []) || []
  const [search, setSearch] = useState('')
  const [filterType, setFilterType] = useState<string>('all')
  const [searchParams] = useSearchParams()
  const [openId, setOpenId] = useState<string | null>(() => searchParams.get('open'))
  const toast = useToast()
  const navigate = useNavigate()

  const filtered = useMemo(() => {
    let out = artifacts
    if (filterType !== 'all') out = out.filter((a) => a.type === filterType)
    if (search.trim()) {
      const q = search.toLowerCase()
      out = out.filter(
        (a) =>
          a.title.toLowerCase().includes(q) ||
          a.content.toLowerCase().includes(q) ||
          a.tags?.some((t) => t.toLowerCase().includes(q))
      )
    }
    return out
  }, [artifacts, search, filterType])

  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    artifacts.forEach((a) => { counts[a.type] = (counts[a.type] || 0) + 1 })
    return counts
  }, [artifacts])

  const open = artifacts.find((a) => a.id === openId)
  const template = open ? ARTIFACT_TEMPLATES[open.type] : null

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this artifact?')) return
    await db.artifacts.delete(id)
    if (openId === id) setOpenId(null)
    toast.info('Artifact deleted')
  }

  const handlePin = async (id: string, pinned: boolean) => {
    await db.artifacts.update(id, { pinned: !pinned, updatedAt: Date.now() })
  }

  const handleDownload = (a: typeof artifacts[0]) => {
    const blob = new Blob([a.content], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a2 = document.createElement('a')
    a2.href = url
    a2.download = `${a.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.md`
    document.body.appendChild(a2)
    a2.click()
    document.body.removeChild(a2)
    URL.revokeObjectURL(url)
  }

  const handleNewBlank = async () => {
    const id = nanoid(12)
    await db.artifacts.put({
      id,
      type: 'custom',
      title: 'Untitled artifact',
      content: '# Untitled\n\n',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    setOpenId(id)
  }

  // -------------------------------------------------------------------------
  // Self-test: seeds a sample library, runs several search queries, and
  // surfaces the results in a side panel. This lets the founder verify the
  // RAG plumbing (the same code the agents call via `search_artifacts`)
  // works end-to-end without setting up a real provider.
  // -------------------------------------------------------------------------
  const [diag, setDiag] = useState<{ query: string; ok: boolean; scanned: number; hits: any[]; error?: string; tookMs: number }[] | null>(null)
  const [diagRunning, setDiagRunning] = useState(false)

  const handleSelfTest = async () => {
    setDiagRunning(true)
    try {
      // Seed fixtures the first time the user runs the test
      if (artifacts.length < 3) {
        await seedSampleArtifacts()
        toast.info('Seeded sample artifacts', 'Running search tests…')
      }
      const probes: { name: string; query: string; types?: any[]; pinnedOnly?: boolean }[] = [
        { name: 'Broad: "pricing"', query: 'pricing tiers' },
        { name: 'Specific: "freemium"', query: 'freemium model' },
        { name: 'Multi-word: "90 day plan"', query: '90 day plan' },
        { name: 'Type filter: "teardown"', query: 'competitor teardown', types: ['teardown'] },
        { name: 'Pinned only', query: 'strategy', pinnedOnly: true },
        { name: 'No match', query: 'qzxwcnvbnm' },
        // NEW: broad-recall probes (stem + prefix + body-content)
        { name: 'Stem fallback: "pric" → pricing/prices', query: 'pric' },
        { name: 'Prefix fallback: "strate" → strategy/strategies', query: 'strate' },
        { name: 'Body-only: "MRR" (in investor doc body, not title)', query: 'MRR' },
        { name: 'Body-only: "payback" (only in pricing doc body)', query: 'payback' },
        { name: 'Body-only: "freemium" (pricing + pitch docs)', query: 'freemium' },
      ]
      const results: typeof diag = []
      for (const p of probes) {
        const start = performance.now()
        try {
          const r = await searchArtifacts({ query: p.query, types: p.types, pinnedOnly: p.pinnedOnly })
          results.push({
            query: `${p.name} → "${p.query}"`,
            ok: true,
            scanned: r.scanned,
            hits: r.hits.slice(0, 3),
            tookMs: Math.round(performance.now() - start),
          })
        } catch (e: any) {
          results.push({ query: p.name, ok: false, scanned: 0, hits: [], error: e?.message, tookMs: 0 })
        }
      }
      setDiag(results)
    } finally {
      setDiagRunning(false)
    }
  }

  return (
    <div className="grid h-full grid-cols-[1fr_2fr] divide-x divide-border-subtle">
      {/* List */}
      <div className="flex min-h-0 flex-col">
        <div className="flex-shrink-0 border-b border-border-subtle p-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="font-serif text-2xl font-medium tracking-tight">Library</h1>
              {artifacts.length > 0 && (
                <p className="mt-0.5 text-[11px] text-fg-muted tabular-nums">
                  {artifacts.length} artifact{artifacts.length !== 1 ? 's' : ''} built
                </p>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={handleSelfTest}
                disabled={diagRunning}
                title="Run a self-test of the artifact search (the same engine the agents use)"
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-bg-subtle px-2.5 py-1.5 text-xs font-medium transition hover:bg-bg-muted focus-ring disabled:opacity-50"
              >
                <FlaskConical className="h-3 w-3" />
                <span>{diagRunning ? 'Running…' : 'Self-test'}</span>
              </button>
              <button
                onClick={handleNewBlank}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-bg-subtle px-2.5 py-1.5 text-xs font-medium transition hover:bg-bg-muted focus-ring"
              >
                <Plus className="h-3 w-3" />
                <span>New</span>
              </button>
            </div>
          </div>
          <div className="relative mt-3">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-subtle" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search artifacts…"
              className="w-full rounded-lg border border-border bg-bg-subtle/40 py-1.5 pl-8 pr-3 text-sm placeholder:text-fg-subtle focus:border-fg/20 focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
          </div>
          <div className="mt-3 flex flex-wrap gap-1">
            <FilterChip active={filterType === 'all'} onClick={() => setFilterType('all')}>
              All
            </FilterChip>
            {ARTIFACT_LIST.map((t) => (
              <FilterChip
                key={t.type}
                active={filterType === t.type}
                onClick={() => setFilterType(t.type)}
              >
                <span className="mr-1">{t.emoji}</span>
                {t.name}
                {(typeCounts[t.type] || 0) > 0 && (
                  <span className="ml-1.5 tabular-nums opacity-50">{typeCounts[t.type]}</span>
                )}
              </FilterChip>
            ))}
          </div>
        </div>

        <div className="relative flex-1 overflow-y-auto p-2">
          {filtered.length === 0 ? (
            <div className="relative grid h-full place-items-center overflow-hidden p-8 text-center">
              {artifacts.length === 0 && (
                <>
                  <AmbientAurora intensity={1} color="orange" fixed={false} />
                  <div className="pointer-events-none absolute inset-0">
                    {/* Floating artifact silhouettes */}
                    {ARTIFACT_LIST.slice(0, 4).map((t, i) => (
                      <div
                        key={t.type}
                        className="absolute select-none text-3xl opacity-30 animate-float"
                        style={{
                          left: `${15 + i * 18}%`,
                          top: `${20 + (i % 2) * 50}%`,
                          animationDelay: `${-i * 1.3}s`,
                          animationDuration: `${5 + i * 0.5}s`,
                        }}
                      >
                        {t.emoji}
                      </div>
                    ))}
                  </div>
                </>
              )}
              <div className="relative">
                <FileText className="mx-auto h-8 w-8 text-fg-subtle" />
                <h3 className="mt-3 text-sm font-medium">
                  {artifacts.length === 0 ? 'No artifacts yet' : 'No matches'}
                </h3>
                <p className="mt-1 max-w-xs text-xs text-fg-muted">
                  {artifacts.length === 0
                    ? 'Ask any agent to draft an artifact in chat, and it\'ll show up here.'
                    : 'Try a different search or filter.'}
                </p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {filtered.map((a, i) => {
                const t = ARTIFACT_TEMPLATES[a.type]
                return (
                  <motion.button
                    key={a.id}
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(i * 0.04, 0.22), duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                    whileHover={{ y: -1 }}
                    onClick={() => setOpenId(a.id)}
                    className={cn(
                      'group flex flex-col gap-1 rounded-xl border p-3 text-left transition focus-ring',
                      openId === a.id
                        ? 'border-accent/40 bg-accent/5'
                        : 'border-border-subtle bg-bg-subtle/30 hover:border-border hover:bg-bg-subtle/60'
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-base">{t.emoji}</span>
                      <div className="flex-1 min-w-0 truncate text-sm font-medium">{a.title}</div>
                      {a.pinned && <Pin className="h-3 w-3 fill-current text-accent" />}
                    </div>
                    {/* Prefer the AI summary (what the model sees) over the raw body
                        slice. The summary is what gets grounded into chat answers, so
                        the user should recognise it here too. */}
                    {a.summary ? (
                      <div className="line-clamp-2 text-xs text-fg-muted">
                        {a.summary}
                      </div>
                    ) : (
                      <div className="line-clamp-2 text-xs text-fg-muted">
                        {a.content.slice(0, 200)}
                      </div>
                    )}
                    <div className="mt-1 flex items-center gap-2 text-[10px] text-fg-subtle">
                      <span>{t.name}</span>
                      <span>·</span>
                      <span>{relativeTime(a.updatedAt)}</span>
                      {a.summary ? (
                        <>
                          <span>·</span>
                          <span className="inline-flex items-center gap-1 text-violet-600 dark:text-violet-400" title="AI-generated summary cached for context efficiency">
                            <Sparkles className="h-2.5 w-2.5" /> summarised
                          </span>
                        </>
                      ) : (
                        <>
                          <span>·</span>
                          <span className="inline-flex items-center gap-1 text-fg-subtle/70" title="Summary pending — will be generated by the background scheduler">
                            <Sparkles className="h-2.5 w-2.5 animate-pulse" /> summarising
                          </span>
                        </>
                      )}
                    </div>
                  </motion.button>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Editor */}
      <AnimatePresence mode="wait">
        {open ? (
          <ArtifactEditor
            key={open.id}
            artifact={open}
            template={template!}
            onClose={() => setOpenId(null)}
            onDelete={() => handleDelete(open.id)}
            onPin={() => handlePin(open.id, !!open.pinned)}
            onDownload={() => handleDownload(open)}
            onChange={async (patch) => {
              await db.artifacts.update(open.id, { ...patch, updatedAt: Date.now() })
            }}
          />
        ) : (
          <motion.div
            key="empty"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="relative grid place-items-center overflow-hidden p-12 text-center"
          >
            <div className="pointer-events-none absolute inset-0">
              {ARTIFACT_LIST.slice(0, 6).map((t, i) => (
                <div
                  key={t.type}
                  className="absolute select-none text-2xl opacity-25 animate-float"
                  style={{
                    left: `${10 + (i * 16) % 80}%`,
                    top: `${15 + (i * 23) % 70}%`,
                    animationDelay: `${-i * 0.9}s`,
                    animationDuration: `${6 + (i % 3)}s`,
                  }}
                >
                  {t.emoji}
                </div>
              ))}
            </div>
            <div className="relative text-center">
              <h3 className="text-base font-semibold text-fg">What do you want to build?</h3>
              <p className="mt-1 text-sm text-fg-muted">Ask your cofounder to draft one →</p>
              <div className="mt-5 mx-auto grid max-w-xs grid-cols-2 gap-2">
                {ARTIFACT_LIST.slice(0, 4).map((t, i) => (
                  <motion.button
                    key={t.type}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.06, duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                    whileHover={{ y: -2, scale: 1.03 }}
                    whileTap={{ scale: 0.97 }}
                    onClick={() => navigate('/chat', { state: { prefill: `Let's draft a ${t.name} for my business` } })}
                    className="flex flex-col items-center gap-2 rounded-xl border border-border bg-bg-subtle/40 p-4 transition hover:border-accent/30 hover:bg-bg-subtle hover:shadow-glow"
                  >
                    <span className="text-2xl">{t.emoji}</span>
                    <span className="text-[11px] font-medium text-fg">{t.name}</span>
                  </motion.button>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Self-test diagnostic overlay */}
      <AnimatePresence>
        {diag && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 grid place-items-center bg-black/40 p-4 backdrop-blur-sm"
            onClick={() => setDiag(null)}
          >
            <motion.div
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.98 }}
              transition={{ duration: 0.18 }}
              className="relative max-h-[85vh] w-full max-w-2xl overflow-hidden rounded-2xl border border-border bg-bg shadow-soft"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-2 border-b border-border-subtle bg-bg-subtle/40 px-4 py-3">
                <Database className="h-4 w-4 text-violet-500" />
                <div className="flex-1">
                  <div className="text-sm font-semibold">Artifact search self-test</div>
                  <div className="text-[11px] text-fg-muted">
                    Runs the same search engine the agents call via <span className="font-mono text-fg">search_artifacts</span>. Results below mirror what your cofounder would see.
                  </div>
                </div>
                <button
                  onClick={() => setDiag(null)}
                  className="rounded-lg p-1.5 text-fg-subtle transition hover:bg-bg-muted hover:text-fg"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="max-h-[70vh] overflow-y-auto p-4">
                <div className="space-y-3">
                  {diag.map((r, i) => (
                    <div
                      key={i}
                      className={cn(
                        'rounded-xl border p-3 text-[12px]',
                        r.ok ? 'border-border-subtle bg-bg-subtle/30' : 'border-danger/30 bg-danger/5'
                      )}
                    >
                      <div className="flex items-center gap-2">
                        {r.ok ? (
                          r.hits.length > 0 ? (
                            <Check className="h-3.5 w-3.5 text-success" />
                          ) : (
                            <Check className="h-3.5 w-3.5 text-fg-subtle" />
                          )
                        ) : (
                          <AlertCircle className="h-3.5 w-3.5 text-danger" />
                        )}
                        <div className="flex-1 font-mono text-[11px] text-fg">{r.query}</div>
                        <div className="text-[10px] text-fg-subtle tabular-nums">
                          {r.tookMs}ms · scanned {r.scanned} · {r.hits.length} hit{r.hits.length === 1 ? '' : 's'}
                        </div>
                      </div>
                      {r.error && (
                        <div className="mt-2 text-[11px] text-danger">{r.error}</div>
                      )}
                      {r.hits.length > 0 && (
                        <ul className="mt-2 space-y-1.5">
                          {r.hits.map((h, j) => (
                            <li key={j} className="rounded-lg border border-border-subtle bg-bg/50 p-2">
                              <div className="flex items-center gap-2">
                                <span className="text-base">
                                  {ARTIFACT_TEMPLATES[h.type as keyof typeof ARTIFACT_TEMPLATES]?.emoji || '📄'}
                                </span>
                                <div className="flex-1 min-w-0 truncate font-medium text-fg">{h.title}</div>
                                <div className="rounded-full bg-violet-500/15 px-1.5 py-0.5 font-mono text-[10px] text-violet-700 dark:text-violet-300">
                                  score {h.score.toFixed(2)}
                                </div>
                                {h.pinned && <Pin className="h-2.5 w-2.5 fill-current text-accent" />}
                                {h.broadRecall && (
                                  <span
                                    className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-300"
                                    title="Matched via broad-recall (stem/prefix fallback)"
                                  >
                                    broad
                                  </span>
                                )}
                              </div>
                              {h.matchedFields?.length > 0 && (
                                <div className="mt-1 flex flex-wrap gap-1">
                                  {h.matchedFields.map((f: string) => (
                                    <span
                                      key={f}
                                      className="rounded-full bg-bg-muted px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-fg-muted"
                                    >
                                      {f}
                                    </span>
                                  ))}
                                </div>
                              )}
                              {h.matchDetails && h.matchDetails.length > 0 && (
                                <div className="mt-1 flex flex-wrap items-center gap-1 text-[9px] text-fg-subtle">
                                  <span>matched:</span>
                                  {h.matchDetails.map((m: any, k: number) => (
                                    <span
                                      key={k}
                                      className={cn(
                                        'rounded px-1 py-0.5 font-mono',
                                        m.exact
                                          ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                                          : 'bg-amber-500/10 text-amber-700 dark:text-amber-300'
                                      )}
                                      title={m.exact ? 'exact match' : 'stem/prefix fallback'}
                                    >
                                      {m.term}
                                    </span>
                                  ))}
                                </div>
                              )}
                              {h.snippet && (
                                <div className="mt-1.5 line-clamp-2 text-[11px] leading-relaxed text-fg-muted">
                                  {h.snippet}
                                </div>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] transition',
        active
          ? 'border-accent/40 bg-accent/10 text-accent'
          : 'border-border bg-bg-subtle/30 text-fg-muted hover:bg-bg-muted'
      )}
    >
      {children}
    </button>
  )
}

function ArtifactEditor({
  artifact,
  template,
  onClose,
  onDelete,
  onPin,
  onDownload,
  onChange,
}: {
  artifact: any
  template: any
  onClose: () => void
  onDelete: () => void
  onPin: () => void
  onDownload: () => void
  onChange: (patch: any) => Promise<void>
}) {
  // Round-trip nav: when the artifact was saved from a chat message, show
  // a "📍 From this conversation" badge that jumps back into the chat at
  // that exact message (Feature 5).
  const sourceConv = useLiveQuery(
    async () => {
      if (!artifact.conversationId) return undefined
      return await db.conversations.get(artifact.conversationId)
    },
    [artifact.conversationId]
  ) as import('@/lib/db').Conversation | undefined
  const [title, setTitle] = useState(artifact.title)
  const [content, setContent] = useState(artifact.content)
  const [mode, setMode] = useState<'edit' | 'preview'>('preview')
  const [saving, setSaving] = useState(false)

  // Save on change (debounced)
  useEffect(() => {
    const id = setTimeout(async () => {
      if (title !== artifact.title || content !== artifact.content) {
        setSaving(true)
        await onChange({ title, content })
        setSaving(false)
      }
    }, 600)
    return () => clearTimeout(id)
  }, [title, content])

  return (
    <motion.div
      key={artifact.id}
      initial={{ opacity: 0, x: 8 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 8 }}
      transition={{ duration: 0.18 }}
      className="flex min-h-0 flex-col"
    >
      <div className="flex-shrink-0 border-b border-border-subtle p-4">
        <div className="flex items-start gap-3">
          <div className="text-2xl">{template.emoji}</div>
          <div className="flex-1 min-w-0">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-transparent text-xl font-semibold tracking-tight focus:outline-none"
            />
            <div className="mt-1 flex items-center gap-2 text-[11px] text-fg-subtle">
              <span>{template.name}</span>
              <span>·</span>
              <span>Updated {relativeTime(artifact.updatedAt)}</span>
              {saving && <span>· saving…</span>}
              {artifact.sourceMessageId && sourceConv && (
                <Link
                  to={`/chat/${artifact.conversationId}?msg=${artifact.sourceMessageId}`}
                  className="ml-1 inline-flex items-center gap-1 rounded-full border border-accent/30 bg-accent/5 px-1.5 py-0.5 font-medium text-accent transition hover:border-accent/50 hover:bg-accent/10"
                  title="Jump back to the message this was saved from"
                >
                  <span>📍</span>
                  <span className="max-w-[120px] truncate">
                    {sourceConv.title || 'From this conversation'}
                  </span>
                </Link>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setMode(mode === 'edit' ? 'preview' : 'edit')}
              className={cn(
                'rounded-lg px-2.5 py-1.5 text-xs transition focus-ring',
                mode === 'edit' ? 'bg-accent text-accent-fg' : 'border border-border bg-bg-subtle hover:bg-bg-muted'
              )}
            >
              {mode === 'edit' ? 'Preview' : 'Edit'}
            </button>
            {(artifact.type === 'plan90' || artifact.type === 'strategy') && (
              <ConvertToTasksButton artifact={artifact} />
            )}
            <button
              onClick={onPin}
              className={cn(
                'rounded-lg p-1.5 transition focus-ring',
                artifact.pinned
                  ? 'text-accent hover:bg-accent/10'
                  : 'text-fg-subtle hover:bg-bg-muted hover:text-fg'
              )}
              title={artifact.pinned ? 'Unpin' : 'Pin'}
            >
              <Pin className={cn('h-4 w-4', artifact.pinned && 'fill-current')} />
            </button>
            <button
              onClick={onDownload}
              className="rounded-lg p-1.5 text-fg-subtle transition hover:bg-bg-muted hover:text-fg focus-ring"
              title="Download as Markdown"
            >
              <Download className="h-4 w-4" />
            </button>
            <button
              onClick={onDelete}
              className="rounded-lg p-1.5 text-fg-subtle transition hover:bg-danger/10 hover:text-danger focus-ring"
              title="Delete"
            >
              <Trash2 className="h-4 w-4" />
            </button>
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-fg-subtle transition hover:bg-bg-muted hover:text-fg focus-ring md:hidden"
              title="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        {mode === 'edit' ? (
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="prose-chat h-full w-full resize-none border-0 bg-transparent font-mono text-sm focus:outline-none"
            style={{ minHeight: 400 }}
          />
        ) : (
          <div className="prose-chat max-w-2xl text-[15px]">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          </div>
        )}
      </div>
    </motion.div>
  )
}

// ---------------------------------------------------------------------------
// Self-test fixture data. Seeds a representative sample of the 9 artifact
// types so the founder can verify the search engine end-to-end without
// manually saving anything.
// ---------------------------------------------------------------------------

async function seedSampleArtifacts() {
  const now = Date.now()
  const samples: Array<Omit<import('@/lib/db').Artifact, 'id' | 'createdAt' | 'updatedAt'>> = [
    {
      type: 'strategy',
      title: 'Hatch — 2026 strategy',
      content: `# Strategy

## Positioning
For non-technical first-time founders. The AI cofounder team that ships.

## ICP
First-time founders, 28-40, in the US/UK/India, with a B2C product idea, no technical co-founder.

## Bets
- Win the "first 100 paying founders" wedge
- Build the artifact search & RAG layer so every agent has perfect recall
- Ship the cheapest BYOK stack in the market
`,
      tags: ['go-to-market', 'positioning'],
      pinned: true,
    },
    {
      type: 'pricing',
      title: 'Pricing model v1',
      content: `# Pricing

## Tier 1: Free
\$0/mo. 50 messages, 1 conversation, BYOK key required.

## Tier 2: Pro — \$19/mo (anchor)
Unlimited messages, all 4 agents, 1GB artifact storage, web search.

## Tier 3: Team — \$49/mo
Everything in Pro, 5 seats, shared library, 10GB storage.

## Unit economics
- Rough CAC: \$25 (content + community)
- Rough LTV at Pro: \$228 (12mo avg retention)
- Payback: 1.3 months
`,
      tags: ['pricing', 'unit-economics'],
    },
    {
      type: 'plan90',
      title: 'Q1 90-day plan',
      content: `# 90-day plan

**Definition of done:** 100 signups, 10 paying Pro subscribers, 1 public case study.

## Week 1
- Ship the artifact search & RAG tool

## Week 2
- Onboard 5 beta founders, ship their feedback

## Week 3
- Launch the public waitlist + landing page

## Week 4
- Convert waitlist to first 10 Pro subscribers
`,
    },
    {
      type: 'teardown',
      title: 'Competitive teardown — AI cofounder space',
      content: `# Competitive teardown

## Competitor 1: Generalist AI assistant
- What they do: ChatGPT-style single agent.
- Where they win: Brand, breadth.
- Where they're vulnerable: No multi-agent team, no artifact library, no founder context.

## Competitor 2: Vertical AI advisor
- What they do: Coach-style chat for founders.
- Where they win: Personality, accountability.
- Where they're vulnerable: No execution, no artifacts, no RAG over the founder's prior work.

## Our wedge
The only multi-agent team that remembers the founder's full library of artifacts, plans, and pitches — and grounds every answer in their own materials.
`,
    },
    {
      type: 'pitch',
      title: 'Elevator pitch v2',
      content: `# Pitch

## Hook
Non-technical founders waste 6 months rebuilding what their AI cofounder could ship in a weekend.

## Problem
Every founder is alone with their AI. No memory. No team. No artifacts.

## Solution
Hatch is a 4-agent AI cofounder that remembers everything, grounds every answer in your saved library, and ships artifacts you can take to investors.

## Why now
LLMs + BYOK + cheap embeddings have converged. The 1-person billion-dollar company is real, but only if the AI remembers the company.

## Ask
Looking for 5 design partners in week 1 and a \$500k pre-seed by Q2.
`,
    },
    {
      type: 'review',
      title: 'Weekly review — week of May 25',
      content: `# Weekly review

## What I said I'd do
- Ship the artifact search tool
- Talk to 3 design partners
- Write the public landing page

## What actually happened
- Shipped the artifact search tool (took 2 days, not 1)
- Talked to 1 design partner (not 3)
- Did not write the landing page

## What I learned
The CTO agent is now the bottleneck for shipping features. Need to recruit a technical co-founder or outsource.

## What changes next week
- Move the CTO workload to outsourced dev shop
- Cut the "talk to 3 design partners" goal to 1
- Drop the landing page and ship a Typeform waitlist first
`,
    },
    {
      type: 'investor',
      title: 'Investor update — May 2026',
      content: `# Investor update — May 2026

**TL;DR:** Shipped the RAG layer and artifact search. 3 design partners signed. Raising a \$500k pre-seed.

## Numbers
- MRR: \$0 (+0% MoM)
- Users: 12 (+20% MoM)
- Runway: 14 months

## Progress
- 4-agent team in production
- Artifact library with BM25 search
- Reasoning mode for OpenAI o-series and Claude extended thinking

## Setbacks
- Browser AI is only on Chrome/Edge; we lose Safari users

## Asks
- Intro to Maven or similar community for design partners
- 1 intro to a US-based pre-seed fund
`,
    },
  ]

  await db.transaction('rw', db.artifacts, async () => {
    for (const s of samples) {
      const id = `sample-${s.type}`
      const existing = await db.artifacts.get(id)
      if (existing) continue
      await db.artifacts.put({ ...s, id, createdAt: now, updatedAt: now })
    }
  })
}

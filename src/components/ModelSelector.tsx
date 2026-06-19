import { useState, useRef, useEffect, useCallback } from 'react'
import { Cpu, Check, Search, Sparkles, ChevronDown, RefreshCw, Loader2 } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  PROVIDERS,
  getProviderModels,
  listAvailableModels,
  type ProviderId,
  type ModelInfo,
  type ModelTag,
  type ModelListResult,
} from '@/lib/providers'
import { cn } from '@/lib/utils'

interface Props {
  providerId: ProviderId
  modelId: string
  onChange: (modelId: string) => void
  disabled?: boolean
}

const TAG_STYLES: Record<ModelTag, string> = {
  flagship: 'bg-sun-1/15 text-sun-1 ring-1 ring-sun-1/25',
  smart: 'bg-accent/15 text-accent ring-1 ring-accent/25',
  fast: 'bg-sun-3/15 text-sun-3 ring-1 ring-sun-3/25',
  reasoning: 'bg-warning/15 text-warning ring-1 ring-warning/25',
  cheap: 'bg-success/15 text-success ring-1 ring-success/25',
  free: 'bg-success/20 text-success ring-1 ring-success/30',
  'long-context': 'bg-fg/10 text-fg-muted ring-1 ring-border',
  'open-source': 'bg-sun-2/15 text-sun-2 ring-1 ring-sun-2/25',
}

const TAG_ORDER: ModelTag[] = [
  'flagship',
  'smart',
  'reasoning',
  'long-context',
  'fast',
  'cheap',
  'free',
  'open-source',
]

function Tag({ tag }: { tag: ModelTag }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider',
        TAG_STYLES[tag]
      )}
    >
      {tag.replace('-', ' ')}
    </span>
  )
}

function ModelRow({
  model,
  selected,
  recommended,
  onSelect,
}: {
  model: ModelInfo
  selected: boolean
  recommended: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'group flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left transition',
        'hover:bg-bg-muted focus:outline-none focus-visible:bg-bg-muted',
        selected && 'bg-bg-muted'
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <div className="truncate text-sm font-medium leading-tight">{model.name}</div>
          {recommended && (
            <span className="inline-flex flex-shrink-0 items-center gap-0.5 rounded-full bg-accent/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-accent">
              <Sparkles className="h-2.5 w-2.5" />
              Recommended
            </span>
          )}
          {selected && <Check className="ml-auto h-3.5 w-3.5 flex-shrink-0 text-accent" />}
        </div>
        <div className="mt-0.5 line-clamp-2 text-[11px] text-fg-muted leading-snug">
          {model.description}
        </div>
        {model.tags.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {TAG_ORDER.filter((t) => model.tags.includes(t)).map((t) => (
              <Tag key={t} tag={t} />
            ))}
          </div>
        )}
      </div>
    </button>
  )
}

export function ModelSelector({ providerId, modelId, onChange, disabled }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const provider = PROVIDERS[providerId]
  const [live, setLive] = useState<ModelListResult | null>(null)
  const [loadingModels, setLoadingModels] = useState(false)

  // Show the live list (everything the user's key can access) when we have it,
  // otherwise the curated catalog.
  const models = live?.models ?? getProviderModels(providerId)
  const current = models.find((m) => m.id === modelId) || models.find((m) => m.recommended) || models[0]

  // Drop the cached live list when the provider changes.
  useEffect(() => {
    setLive(null)
  }, [providerId])

  const loadModels = useCallback(async () => {
    if (providerId === 'browser-ai') return
    setLoadingModels(true)
    try {
      setLive(await listAvailableModels(providerId))
    } finally {
      setLoadingModels(false)
    }
  }, [providerId])

  // Fetch the live model list the first time the dropdown opens for a provider.
  useEffect(() => {
    if (open && !live && !loadingModels && providerId !== 'browser-ai') {
      void loadModels()
    }
  }, [open, live, loadingModels, providerId, loadModels])

  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 80)
      return () => clearTimeout(t)
    }
    setQuery('')
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  const filtered = query.trim()
    ? models.filter((m) => {
        const q = query.toLowerCase()
        return (
          m.id.toLowerCase().includes(q) ||
          m.name.toLowerCase().includes(q) ||
          m.description.toLowerCase().includes(q) ||
          m.tags.some((t) => t.toLowerCase().includes(q))
        )
      })
    : models

  // Sort: recommended first, then by tag priority, then alphabetical
  const sorted = [...filtered].sort((a, b) => {
    if (a.recommended && !b.recommended) return -1
    if (b.recommended && !a.recommended) return 1
    return a.name.localeCompare(b.name)
  })

  if (!provider) return null
  const isAuto = !modelId || modelId === provider.defaultModel

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => !disabled && setOpen((o) => !o)}
        disabled={disabled}
        className={cn(
          'flex items-center gap-1.5 rounded-lg border border-border-subtle bg-bg-subtle/40 px-2.5 py-1 text-[11px] text-fg-muted transition',
          'hover:bg-bg-muted hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/30',
          disabled && 'opacity-50 cursor-not-allowed'
        )}
        title="Change model"
      >
        <Cpu className="h-3 w-3" />
        <span className="font-medium text-fg">{current?.name || (isAuto ? 'Auto' : modelId)}</span>
        <ChevronDown className={cn('h-3 w-3 text-fg-subtle transition', open && 'rotate-180')} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.97 }}
            transition={{ duration: 0.12 }}
            className="absolute right-0 top-full z-30 mt-1.5 flex w-[26rem] max-w-[calc(100vw-2rem)] flex-col rounded-2xl border border-border bg-bg p-2 shadow-soft"
          >
            <div className="px-1 pb-1.5 pt-1">
              <div className="flex items-baseline justify-between px-1">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
                  {provider.name} models
                </div>
                <div className="flex items-center gap-1.5">
                  {loadingModels && <Loader2 className="h-3 w-3 animate-spin text-fg-subtle" />}
                  <span className="text-[10px] text-fg-muted">
                    {models.length} {models.length === 1 ? 'model' : 'models'}
                  </span>
                  {providerId !== 'browser-ai' && (
                    <button
                      type="button"
                      onClick={() => void loadModels()}
                      disabled={loadingModels}
                      title="Refresh the list from your API key"
                      className="rounded p-0.5 text-fg-subtle transition hover:bg-bg-muted hover:text-fg disabled:opacity-50"
                    >
                      <RefreshCw className={cn('h-3 w-3', loadingModels && 'animate-spin')} />
                    </button>
                  )}
                </div>
              </div>
            </div>

            {models.length > 4 && (
              <div className="relative mb-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-fg-subtle" />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search models…"
                  className="w-full rounded-lg border border-border bg-bg-subtle/60 py-1.5 pl-7 pr-2.5 text-sm placeholder:text-fg-subtle focus:border-fg/20 focus:outline-none focus:ring-2 focus:ring-accent/20"
                />
              </div>
            )}

            <div className="max-h-80 overflow-y-auto overscroll-contain pr-0.5">
              {sorted.length === 0 ? (
                <div className="px-3 py-8 text-center text-sm text-fg-muted">
                  No models match "{query}"
                </div>
              ) : (
                <div className="space-y-0.5">
                  {sorted.map((m) => (
                    <ModelRow
                      key={m.id}
                      model={m}
                      selected={m.id === modelId || (!modelId && m.id === provider.defaultModel)}
                      recommended={!!m.recommended}
                      onSelect={() => {
                        onChange(m.id)
                        setOpen(false)
                      }}
                    />
                  ))}
                </div>
              )}
            </div>

            <div className="mt-1 border-t border-border-subtle px-1 pt-2 pb-1">
              <p className="text-[10px] text-fg-muted">
                {live?.source === 'live'
                  ? `Live list from your ${provider.name} key. `
                  : live?.note
                    ? `${live.note} `
                    : ''}
                Applies to new messages.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

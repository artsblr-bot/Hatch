import { useState, useRef, useEffect } from 'react'
import { Cpu, Check, Search, Sparkles, ChevronDown } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { PROVIDERS, getProviderModels, type ProviderId, type ModelInfo, type ModelTag } from '@/lib/providers'
import { cn } from '@/lib/utils'

interface Props {
  providerId: ProviderId
  modelId: string
  onChange: (modelId: string) => void
  disabled?: boolean
}

const TAG_STYLES: Record<ModelTag, string> = {
  flagship: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 ring-1 ring-amber-500/20',
  smart: 'bg-violet-500/15 text-violet-700 dark:text-violet-300 ring-1 ring-violet-500/20',
  fast: 'bg-sky-500/15 text-sky-700 dark:text-sky-300 ring-1 ring-sky-500/20',
  reasoning: 'bg-rose-500/15 text-rose-700 dark:text-rose-300 ring-1 ring-rose-500/20',
  cheap: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-500/20',
  free: 'bg-teal-500/15 text-teal-700 dark:text-teal-300 ring-1 ring-teal-500/20',
  'long-context': 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 ring-1 ring-indigo-500/20',
  'open-source': 'bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300 ring-1 ring-fuchsia-500/20',
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
  const models = getProviderModels(providerId)
  const current = models.find((m) => m.id === modelId) || models.find((m) => m.recommended) || models[0]

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
                <div className="text-[10px] text-fg-muted">
                  {models.length} {models.length === 1 ? 'model' : 'models'}
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
                Model applies to new messages. Switch providers in Settings.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

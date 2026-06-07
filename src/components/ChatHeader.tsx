import { useState } from 'react'
import { ChevronDown, Loader2 } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { AGENTS, type AgentMeta } from '@/lib/agents'
import { type ProviderId } from '@/lib/providers'
import { ModelSelector } from './ModelSelector'
import { cn } from '@/lib/utils'

interface Props {
  agent: AgentMeta
  providerId: ProviderId
  model: string
  onAgentSwitch: (role: any) => void
  onModelChange: (modelId: string) => void
  isStreaming: boolean
}

export function ChatHeader({ agent, providerId, model, onAgentSwitch, onModelChange, isStreaming }: Props) {
  const [open, setOpen] = useState(false)

  return (
    <header className="relative z-10 flex h-14 flex-shrink-0 items-center gap-3 border-b border-border-subtle bg-bg/80 px-5 backdrop-blur">
      {/* Agent switcher */}
      <div className="relative">
        <button
          onClick={() => setOpen((o) => !o)}
          className="group flex items-center gap-2.5 rounded-xl border border-border bg-bg-subtle/60 px-3 py-1.5 transition hover:bg-bg-muted focus-ring"
        >
          <div
            className="grid h-7 w-7 place-items-center rounded-lg text-base"
            style={{
              backgroundColor: `hsl(var(--agent-${agent.color}) / 0.18)`,
              color: `hsl(var(--agent-${agent.color}))`,
            }}
          >
            {agent.emoji}
          </div>
          <div className="text-left">
            <div className="text-sm font-semibold leading-tight">{agent.name}</div>
            <div className="text-[10px] uppercase tracking-wider text-fg-subtle leading-none">{agent.role}</div>
          </div>
          <ChevronDown className={cn('h-3.5 w-3.5 text-fg-subtle transition', open && 'rotate-180')} />
        </button>
        <AnimatePresence>
          {open && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
              <motion.div
                initial={{ opacity: 0, y: -4, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -4, scale: 0.97 }}
                transition={{ duration: 0.12 }}
                className="absolute left-0 top-full z-20 mt-1.5 w-80 rounded-2xl border border-border bg-bg p-1.5 shadow-soft"
              >
                {Object.values(AGENTS).map((a) => (
                  <button
                    key={a.id}
                    onClick={() => {
                      onAgentSwitch(a.id)
                      setOpen(false)
                    }}
                    className={cn(
                      'flex w-full items-start gap-3 rounded-xl p-2.5 text-left transition hover:bg-bg-muted',
                      a.id === agent.id && 'bg-bg-muted'
                    )}
                  >
                    <div
                      className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-lg text-lg"
                      style={{
                        backgroundColor: `hsl(var(--agent-${a.color}) / 0.15)`,
                        color: `hsl(var(--agent-${a.color}))`,
                      }}
                    >
                      {a.emoji}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold leading-tight">{a.name}</div>
                      <div className="text-[10px] uppercase tracking-wider text-fg-subtle">{a.role}</div>
                      <div className="mt-0.5 text-xs text-fg-muted text-pretty">{a.description}</div>
                    </div>
                  </button>
                ))}
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>

      <div className="flex-1" />

      {/* Model selector (replaces the static badge) */}
      <div className="hidden sm:block">
        <ModelSelector
          providerId={providerId}
          modelId={model}
          onChange={onModelChange}
          disabled={isStreaming}
        />
      </div>

      {/* Streaming indicator */}
      {isStreaming && (
        <div className="flex items-center gap-1.5 text-[11px] text-fg-muted">
          <Loader2 className="h-3 w-3 animate-spin" />
          <span>Streaming</span>
        </div>
      )}
    </header>
  )
}

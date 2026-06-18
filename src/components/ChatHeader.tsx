import { Loader2 } from 'lucide-react'
import { type AgentMeta } from '@/lib/agents'
import { type ProviderId } from '@/lib/providers'
import { ModelSelector } from './ModelSelector'

interface Props {
  agent: AgentMeta
  providerId: ProviderId
  model: string
  onModelChange: (modelId: string) => void
  isStreaming: boolean
}

export function ChatHeader({ agent, providerId, model, onModelChange, isStreaming }: Props) {
  return (
    <header className="relative z-10 flex h-14 flex-shrink-0 items-center gap-3 border-b border-border-subtle bg-bg/80 px-5 backdrop-blur">
      {/* Agent identity — static, no dropdown */}
      <div className="flex items-center gap-2.5">
        <div
          className="grid h-7 w-7 place-items-center rounded-lg text-base"
          style={{
            backgroundColor: `hsl(var(--agent-${agent.color}) / 0.18)`,
            color: `hsl(var(--agent-${agent.color}))`,
          }}
        >
          {agent.emoji}
        </div>
        <div>
          <div className="text-sm font-semibold leading-tight">{agent.name}</div>
          <div className="text-[10px] uppercase tracking-wider text-fg-subtle leading-none">{agent.role}</div>
        </div>
      </div>

      <div className="flex-1" />

      {/* Model selector */}
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

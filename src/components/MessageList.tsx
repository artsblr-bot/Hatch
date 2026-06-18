import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { motion, AnimatePresence } from 'framer-motion'
import { Save, X, Check, AlertCircle, BookOpen, Brain, ChevronDown, Database, Pin, ArrowRight, Globe, Link2, Clock, ExternalLink, AlertTriangle, FileText, Bookmark, Loader2, RotateCw } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { nanoid } from 'nanoid'
import {
  db,
  type Message,
  type AgentRole,
  type Artifact,
} from '@/lib/db'
import { AGENTS } from '@/lib/agents'
import { useRotatingWords } from '@/hooks/useRotatingWords'
import { useToast } from './Toast'
import { ARTIFACT_TEMPLATES, parseArtifacts, stripArtifacts, parseHtmlBlocks, stripHtmlBlocks } from '@/lib/artifacts'
import { highlightSnippet, tokenizeForSearch } from '@/lib/artifactSearch'
import { HtmlPreviewCard } from './HtmlPreviewCard'
import { AmbientAurora } from './AmbientAurora'
import { ParticleField } from './ParticleField'
import { AddToTaskComposer } from './AddToTaskComposer'
import { SaveArtifactModal } from './SaveArtifactModal'
import { cn } from '@/lib/utils'

interface Props {
  messages: Message[]
  streamingMsgId: string | null
  streamingText: string
  streamingReasoning: string
  streaming: boolean
  stepOverrides: Record<string, 'pending' | 'active' | 'done' | 'error'>
  /**
   * Tool-call overrides keyed by toolCallId (preferred) or by tool name (legacy fallback).
   * Includes the tool name on the value so we can render the right icon.
   */
  toolOverrides: Record<string, { status: 'pending' | 'ok' | 'error'; result?: any; name?: string }>
  verbList: string[]
  activeAgent: AgentRole
  endRef: React.RefObject<HTMLDivElement>
  /**
   * Re-run a tool call the model wrote in prose (i.e. the missed-call row).
   * Fired when the user clicks the "Run this search now" button on a missed
   * call. Receives the row's pseudoId, the tool name, the args the model
   * tried to send, and the assistant message id (so the rerun can be
   * persisted to IndexedDB).
   */
  onRerunMissedToolCall?: (pseudoId: string, name: string, args: any, assistantMsgId?: string) => void
}

export function MessageList({ messages, streamingMsgId, streamingText, streamingReasoning, streaming, stepOverrides, toolOverrides, verbList, activeAgent, endRef, onRerunMissedToolCall }: Props) {
  // Pre-resolve which messages already produced an artifact, so the action
  // pill can show a "View artifact" badge without each card re-querying.
  // Scoped to the current conversation via the message set — if a message
  // is in `messages`, its conversation is the one being viewed.
  const artifactsByMsg = useLiveQuery(
    async () => {
      const conversationIds = new Set(messages.map((m) => m.conversationId))
      if (conversationIds.size === 0) return new Map<string, Artifact[]>()
      const all = await db.artifacts.toArray()
      const map = new Map<string, Artifact[]>()
      for (const a of all) {
        if (!a.sourceMessageId) continue
        if (!conversationIds.has(a.conversationId || '')) continue
        const arr = map.get(a.sourceMessageId) || []
        arr.push(a)
        map.set(a.sourceMessageId, arr)
      }
      return map
    },
    [messages.map((m) => m.id).join(',')]
  ) || new Map<string, Artifact[]>()

  // Track when streaming finishes to fire the done-glow animation
  const [recentlyDoneId, setRecentlyDoneId] = useState<string | null>(null)
  const prevStreamingIdRef = useRef<string | null>(null)
  useEffect(() => {
    if (prevStreamingIdRef.current && !streamingMsgId) {
      const id = prevStreamingIdRef.current
      setRecentlyDoneId(id)
      const t = setTimeout(() => setRecentlyDoneId(null), 1100)
      return () => clearTimeout(t)
    }
    prevStreamingIdRef.current = streamingMsgId
  }, [streamingMsgId])

  if (messages.length === 0 && !streaming) {
    return <EmptyState verbList={verbList} activeAgent={activeAgent} />
  }

  return (
    <div className="relative flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-6 px-5 py-8">
        {messages.map((m) => {
          const linked = artifactsByMsg.get(m.id) || []
          const inner =
            m.id === streamingMsgId ? (
              <StreamingMessage
                key={m.id}
                message={m}
                streamingText={streamingText}
                streamingReasoning={streamingReasoning}
                stepOverrides={stepOverrides}
                toolOverrides={toolOverrides}
                verbList={verbList}
              />
            ) : (
              <StoredMessage
                key={m.id}
                message={m}
                verbList={verbList}
                onRerunMissedToolCall={onRerunMissedToolCall}
              />
            )
          return (
            <div key={m.id} className={cn('group/message relative', m.id === recentlyDoneId && 'animate-done-glow rounded-2xl')} data-message-id={m.id}>
              {inner}
              <MessageActions
                message={m}
                artifacts={linked}
                conversationId={m.conversationId}
              />
              {linked.length > 0 && <ArtifactBadge artifacts={linked} />}
            </div>
          )
        })}
        <div ref={endRef} className="h-1" />
      </div>
    </div>
  )
}

function EmptyState({ activeAgent }: { verbList: string[]; activeAgent: AgentRole }) {
  const agent = AGENTS[activeAgent]
  return (
    <div className="relative flex flex-1 items-center justify-center overflow-hidden px-6 py-16">
      <AmbientAurora intensity={1} color="orange" fixed={false} />
      <div className="pointer-events-none absolute inset-0">
        <ParticleField count={14} color="orange" energy={1} />
      </div>
      <div className="relative max-w-xl text-center">
        <motion.div
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', damping: 18 }}
          className="mx-auto"
        >
          <div
            className="mx-auto grid h-20 w-20 place-items-center rounded-3xl text-4xl animate-breathe"
            style={{
              backgroundColor: `hsl(var(--agent-${agent.color}) / 0.22)`,
              color: `hsl(var(--agent-${agent.color}))`,
              boxShadow: `0 0 40px hsl(var(--agent-${agent.color}) / 0.25)`,
            }}
          >
            {agent.emoji}
          </div>
        </motion.div>
        <h2 className="mt-6 font-serif text-2xl font-medium tracking-tight">
          Hi, I'm your {agent.name}.
        </h2>
        <p className="mt-2 text-fg-muted text-pretty">{agent.description}</p>
        <p className="mt-4 text-sm text-fg-subtle">
          Tell me about what you're building. I'll remember it next time.
        </p>
      </div>
    </div>
  )
}

function StoredMessage({
  message,
  onRerunMissedToolCall,
}: {
  message: Message
  verbList: string[]
  onRerunMissedToolCall?: (pseudoId: string, name: string, args: any, assistantMsgId?: string) => void
}) {
  if (message.role === 'user') {
    return <UserBubble content={message.content} />
  }
  if (message.role === 'assistant') {
    return (
      <AssistantBubble
        message={message}
        content={message.content}
        artifacts={parseArtifacts(message.content)}
        onRerunMissedToolCall={onRerunMissedToolCall}
      />
    )
  }
  return null
}

function UserBubble({ content }: { content: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      className="flex justify-end"
    >
      <div className="max-w-[85%] rounded-2xl rounded-tr-md border border-border-subtle bg-bg-muted px-4 py-2.5 text-sm text-fg shadow-soft">
        <div className="whitespace-pre-wrap break-words">{content}</div>
      </div>
    </motion.div>
  )
}

function AssistantBubble({
  message,
  content,
  artifacts,
  onRerunMissedToolCall,
}: {
  message: Message
  content: string
  artifacts: ReturnType<typeof parseArtifacts>
  onRerunMissedToolCall?: (pseudoId: string, name: string, args: any, assistantMsgId?: string) => void
}) {
  const htmlBlocks = parseHtmlBlocks(content)
  const displayContent = stripHtmlBlocks(stripArtifacts(content))

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      className="flex flex-col gap-2"
    >
      {/* Steps (status pipeline) */}
      {message.steps && message.steps.length > 0 && (
        <div className="rounded-2xl border border-border-subtle bg-bg-subtle/40 p-3">
          <div className="flex flex-col gap-1.5">
            {message.steps.map((s) => (
              <StepRow key={s.id} step={s} />
            ))}
          </div>
        </div>
      )}

      {/* Tool calls */}
      {message.toolCalls && message.toolCalls.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {message.toolCalls.map((tc, i) => (
            <ToolCallRow key={i} call={tc} onRerun={onRerunMissedToolCall} assistantMsgId={message.id} />
          ))}
        </div>
      )}

      {/* Reasoning (chain-of-thought) — expanded by default */}
      {message.reasoning && message.reasoning.trim().length > 0 && (
        <ReasoningBlock text={message.reasoning} live={false} />
      )}

      {/* Content (with HTML code blocks stripped — they're rendered below) */}
      {displayContent && (
        <div className="prose-chat max-w-none text-[15px]">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{displayContent}</ReactMarkdown>
        </div>
      )}

      {/* HTML previews — live-rendered mockups / designs / landing pages */}
      {htmlBlocks.length > 0 && (
        <div className="flex flex-col gap-3">
          {htmlBlocks.map((b, i) => (
            <HtmlPreviewCard
              key={`${b.startIndex}-${i}`}
              html={b.html}
              live={b.partial}
              context={b.context}
            />
          ))}
        </div>
      )}

      {/* Aborted indicator */}
      {message.aborted && (
        <div className="flex items-center gap-1.5 text-xs text-fg-subtle">
          <X className="h-3 w-3" />
          <span>Generation stopped</span>
        </div>
      )}

      {/* Error indicator */}
      {message.error && (
        <div className="flex items-center gap-1.5 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
          <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
          <span>{message.error}</span>
        </div>
      )}

      {/* Artifacts */}
      {artifacts.length > 0 && (
        <div className="flex flex-col gap-2">
          {artifacts.map((a) => (
            <ArtifactCard key={a.startIndex} artifact={a} sourceMessageId={message.id} conversationId={message.conversationId} />
          ))}
        </div>
      )}
    </motion.div>
  )
}

function StreamingMessage({
  message,
  streamingText,
  streamingReasoning,
  stepOverrides,
  toolOverrides,
  verbList,
}: {
  message: Message
  streamingText: string
  streamingReasoning: string
  stepOverrides: Record<string, 'pending' | 'active' | 'done' | 'error'>
  toolOverrides: Record<string, { status: 'pending' | 'ok' | 'error'; result?: any; name?: string }>
  verbList: string[]
}) {
  const isThinking = !streamingText && !streamingReasoning

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      className="flex flex-col gap-2"
    >
      {/* Pre-text: rich thinking orb. During text: compact rotating step. */}
      <AnimatePresence>
        {isThinking
          ? <ThinkingOrb key="orb" verbList={verbList} />
          : <RotatingStep key="step" verbList={verbList} isStreaming={true} />
        }
      </AnimatePresence>

      {/* Steps */}
      {message.steps && message.steps.length > 0 && (
        <div className="rounded-2xl border border-border-subtle bg-bg-subtle/40 p-3">
          <div className="flex flex-col gap-1.5">
            {message.steps.map((s) => {
              const status = stepOverrides[s.id] || s.status
              return <StepRow key={s.id} step={{ ...s, status }} />
            })}
          </div>
        </div>
      )}

      {/* Tool calls. Key the override lookup by toolCallId (preferred) or by
          name (fallback) so multiple parallel tool calls don't clobber. */}
      {message.toolCalls && message.toolCalls.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {message.toolCalls.map((tc, i) => {
            const key = tc.toolCallId || `name:${tc.name}:${i}`
            const ov = toolOverrides[key] || toolOverrides[tc.name]
            return <ToolCallRow key={key + ':' + i} call={{ ...tc, ...(ov || {}) }} />
          })}
        </div>
      )}

      {/* Reasoning (chain-of-thought). Shown expanded by default so the user
          can see the model's thinking in real-time. */}
      {streamingReasoning && (
        <ReasoningBlock text={streamingReasoning} live />
      )}

      {/* Streaming content + blinking cursor */}
      {streamingText ? (
        <>
          <div className="prose-chat max-w-none text-[15px]">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {stripHtmlBlocks(stripArtifacts(streamingText))}
            </ReactMarkdown>
          </div>
          <span className="h-3.5 w-0.5 self-start animate-blink rounded-full bg-accent/70" />
        </>
      ) : null}

      {/* HTML previews — render in real-time as the model writes HTML. Each
          HtmlPreviewCard is debounced internally so the iframe doesn't thrash. */}
      {streamingText && (() => {
        const blocks = parseHtmlBlocks(streamingText)
        if (blocks.length === 0) return null
        return (
          <div className="flex flex-col gap-3">
            {blocks.map((b, i) => (
              <HtmlPreviewCard
                key={`live-${i}-${b.startIndex}`}
                html={b.html}
                live={b.partial}
                context={b.context}
              />
            ))}
          </div>
        )
      })()}

      {/* Inline artifact extraction while streaming */}
      <PendingArtifacts text={streamingText} conversationId={message.conversationId} messageId={message.id} />
    </motion.div>
  )
}

function ReasoningBlock({ text, live }: { text: string; live: boolean }) {
  // Open by default so the user can watch the model's chain-of-thought
  // stream in real-time. They can collapse it once the answer is in.
  const [open, setOpen] = useState(true)
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (live && open && ref.current) {
      ref.current.scrollTop = ref.current.scrollHeight
    }
  }, [text, live, open])

  const preview = text.replace(/\s+/g, ' ').trim().slice(0, 80)

  return (
    <div className="rounded-2xl border border-border-subtle bg-bg-subtle/30">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] transition hover:bg-bg-muted/60"
      >
        <Brain className="h-3.5 w-3.5 text-accent" />
        <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-fg-muted">
          {live ? 'Thinking…' : 'View reasoning'}
        </span>
        {!open && preview && (
          <span className="flex-1 truncate font-mono text-[11px] text-fg-subtle">{preview}…</span>
        )}
        <ChevronDown
          className={cn(
            'h-3.5 w-3.5 text-fg-muted transition-transform',
            open ? 'rotate-0' : '-rotate-90'
          )}
        />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="reasoning-body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <div
              ref={ref}
              className="max-h-72 overflow-y-auto border-t border-border-subtle px-4 py-3 font-mono text-[12.5px] leading-relaxed text-fg-muted whitespace-pre-wrap"
            >
              {text}
              {live && (
                <span className="ml-0.5 inline-block h-3 w-1.5 -translate-y-px animate-pulse rounded-sm bg-fg-muted align-middle" />
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function ThinkingOrb({ verbList }: { verbList: string[] }) {
  const { word, visible } = useRotatingWords({ words: verbList, enabled: true, intervalMs: [2000, 3200] })
  const agent = AGENTS.cofounder
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
      className="flex flex-col gap-3.5"
    >
      <div className="flex items-center gap-3.5">
        <div className="relative flex-shrink-0">
          {[0, 1].map((i) => (
            <motion.div
              key={i}
              className="absolute inset-0 rounded-full border border-accent/25"
              animate={{ scale: [1, 2.1], opacity: [0.5, 0] }}
              transition={{ duration: 2.4, delay: i * 0.9, repeat: Infinity, ease: 'easeOut' }}
            />
          ))}
          <div
            className="relative flex h-11 w-11 items-center justify-center rounded-full text-2xl animate-orb-breathe"
            style={{
              background: 'hsl(var(--accent) / 0.12)',
              border: '1px solid hsl(var(--accent) / 0.28)',
              boxShadow: '0 0 24px hsl(var(--accent) / 0.16)',
            }}
          >
            {agent.emoji}
          </div>
        </div>
        <div className="flex flex-col gap-0.5">
          <AnimatePresence mode="wait">
            <motion.span
              key={word}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: visible ? 1 : 0.7, y: 0 }}
              exit={{ opacity: 0, y: -3 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              className="text-[15px] font-medium text-fg"
            >
              {word}…
            </motion.span>
          </AnimatePresence>
          <span className="text-[12px] text-fg-subtle">Your cofounder is thinking</span>
        </div>
      </div>
      <div className="flex flex-col gap-2.5 pl-0.5">
        {[56, 38, 44].map((w, i) => (
          <div
            key={i}
            className="h-2.5 rounded-full shimmer"
            style={{ width: `${w}%`, animationDelay: `${i * 0.18}s` }}
          />
        ))}
      </div>
    </motion.div>
  )
}

function RotatingStep({ verbList, isStreaming }: { verbList: string[]; isStreaming: boolean }) {
  const { word, visible } = useRotatingWords({ words: verbList, enabled: isStreaming, intervalMs: [2000, 3000] })
  if (!isStreaming) return null
  return (
    <div className="flex items-center gap-2 text-[12px] text-fg-muted">
      <div className="relative h-2 w-2">
        <div className="absolute inset-0 animate-think-pulse rounded-full bg-accent" />
      </div>
      <motion.span
        animate={{ opacity: visible ? 1 : 0, y: visible ? 0 : 4 }}
        transition={{ duration: 0.22, ease: 'easeOut' }}
        className="font-medium tracking-wide"
      >
        {word}…
      </motion.span>
    </div>
  )
}

function StepRow({ step }: { step: { id: string; label: string; status: 'pending' | 'active' | 'done' | 'error'; detail?: string } }) {
  return (
    <div className="flex items-center gap-2 text-[12px]">
      <div className="flex h-4 w-4 flex-shrink-0 items-center justify-center">
        {step.status === 'done' && (
          <span className="inline-flex animate-check-pop">
            <Check className="h-3 w-3 text-success" />
          </span>
        )}
        {step.status === 'active' && (
          <div className="relative h-2 w-2">
            <div className="absolute inset-0 animate-think-pulse rounded-full bg-accent" />
          </div>
        )}
        {step.status === 'pending' && <div className="h-1.5 w-1.5 rounded-full bg-border" />}
        {step.status === 'error' && <AlertCircle className="h-3 w-3 text-danger" />}
      </div>
      <span
        className={cn(
          'transition',
          step.status === 'active' && 'text-fg',
          step.status === 'done' && 'text-fg-muted',
          step.status === 'pending' && 'text-fg-subtle',
          step.status === 'error' && 'text-danger'
        )}
      >
        {step.label}
        {step.detail && <span className="ml-1 text-fg-subtle">— {step.detail}</span>}
      </span>
    </div>
  )
}

function ToolCallRow({
  call,
  onRerun,
  assistantMsgId,
}: {
  call: { toolCallId?: string; name: string; args?: any; result?: any; status: 'pending' | 'ok' | 'error' }
  /**
   * Fired when the user clicks the "Run this search now" button on a missed
   * tool call row. The parent re-runs the tool against the real providers
   * and drops the result back into the row's state.
   */
  onRerun?: (pseudoId: string, name: string, args: any, assistantMsgId?: string) => void
  /** Assistant message id — needed so the rerun can persist to IndexedDB. */
  assistantMsgId?: string
}) {
  // "Missed" tool calls: the model wrote the call in prose instead of invoking
  // the tool via the API. We still want the founder to see what the model
  // tried to do, so we render a dedicated warning row with a one-click
  // "Run this search now" button to actually invoke the tool.
  const isMissed = !!call.result?.missed
  // A missed call is "rerunning" when the row is in pending state (the rerun
  // flips the row from error→pending→ok/error). The `result` will be cleared
  // of `missed: true` once the rerun completes, at which point this flips
  // back to the regular Claude-style result renderer.
  const isRerunning = isMissed && call.status === 'pending'
  const isArtifactSearch = call.name === 'search_artifacts'
  const isWebSearch = call.name === 'web_search'
  const isFetchUrl = call.name === 'fetch_url'
  const isFetchArtifact = call.name === 'fetch_artifact'
  const isRecallMemory = call.name === 'recall_memory'
  const navigate = useNavigate()

  const [open, setOpen] = useState(
    // Auto-open on success for tools whose results are useful to skim, AND on
    // missed calls (the founder needs to see what the model attempted).
    isMissed || (call.status === 'ok' && (isArtifactSearch || isWebSearch || isFetchUrl || isFetchArtifact || isRecallMemory))
  )

  // Auto-expand on first done so the user sees what was searched
  useEffect(() => {
    if (call.status === 'ok' && (isArtifactSearch || isWebSearch || isFetchUrl || isFetchArtifact || isRecallMemory)) setOpen(true)
  }, [call.status, isArtifactSearch, isWebSearch, isFetchUrl, isFetchArtifact, isRecallMemory])

  const Icon = isMissed
    ? AlertTriangle
    : isWebSearch
      ? Globe
      : isFetchUrl
        ? Link2
        : isArtifactSearch
          ? Database
          : isFetchArtifact
            ? FileText
            : isRecallMemory
              ? Brain
              : BookOpen
  const accentClass = isMissed
    ? 'text-amber-600 dark:text-amber-400'
    : isArtifactSearch
      ? 'text-violet-600 dark:text-violet-400'
      : isWebSearch
        ? 'text-sky-600 dark:text-sky-400'
        : isFetchUrl
          ? 'text-emerald-600 dark:text-emerald-400'
          : isFetchArtifact
            ? 'text-violet-600 dark:text-violet-400'
            : isRecallMemory
              ? 'text-indigo-600 dark:text-indigo-400'
              : 'text-fg-muted'
  const borderClass = isMissed
    ? 'border-amber-500/30 bg-amber-500/5'
    : isArtifactSearch
      ? 'border-violet-500/30 bg-violet-500/5'
      : isWebSearch
        ? 'border-sky-500/30 bg-sky-500/5'
        : isFetchUrl
          ? 'border-emerald-500/30 bg-emerald-500/5'
          : isFetchArtifact
            ? 'border-violet-500/30 bg-violet-500/5'
            : isRecallMemory
              ? 'border-indigo-500/30 bg-indigo-500/5'
              : 'border-border-subtle bg-bg-subtle/30'

  // Headline label for the row (the "what is the agent doing" part)
  const label = isMissed
    ? `Could not call ${call.name.replace(/_/g, ' ')}`
    : isWebSearch
      ? 'Searched the web'
      : isFetchUrl
        ? 'Read page'
        : isArtifactSearch
          ? 'Searched your library'
          : isFetchArtifact
            ? 'Read artifact'
            : isRecallMemory
              ? 'Recalled memory'
              : call.name

  return (
    <div className={cn('overflow-hidden rounded-2xl border text-[12px] transition', borderClass)}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition hover:bg-bg-muted/60"
      >
        <Icon className={cn('h-3.5 w-3.5 flex-shrink-0', accentClass)} />
        <span className="font-medium text-fg">{label}</span>
        {call.args?.query && (
          <span className="flex-1 truncate text-fg-muted">"{call.args.query}"</span>
        )}
        {call.args?.url && (
          <span className="flex-1 truncate font-mono text-[10.5px] text-fg-muted">{call.args.url}</span>
        )}
        {call.args?.id && isFetchArtifact && (
          <span className="flex-1 truncate font-mono text-[10.5px] text-fg-muted">id={call.args.id}</span>
        )}
        {!call.args?.query && !call.args?.url && !call.args?.id && call.args?.types && Array.isArray(call.args.types) && (
          <span className="flex-1 truncate text-fg-muted">{call.args.types.join(', ')}</span>
        )}
        <div className="flex items-center gap-2">
          {isWebSearch && call.status === 'ok' && typeof call.result?.count === 'number' && (
            <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-sky-700 dark:text-sky-300">
              {call.result.count} result{call.result.count === 1 ? '' : 's'}
              {call.result?.source && call.result.source !== 'none' && (
                <span className="ml-1 font-normal normal-case tracking-normal opacity-75">· {call.result.source}</span>
              )}
            </span>
          )}
          {isWebSearch && call.status === 'ok' && typeof call.result?.tookMs === 'number' && (
            <span className="hidden items-center gap-0.5 text-[10px] text-fg-subtle sm:flex">
              <Clock className="h-2.5 w-2.5" />
              {call.result.tookMs}ms
            </span>
          )}
          {isArtifactSearch && call.status === 'ok' && (call.result?.fullHits?.length ?? call.result?.hits?.length ?? 0) > 0 && (
            <span className="rounded-full bg-violet-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-violet-700 dark:text-violet-300">
              {call.result?.fullHits?.length ?? call.result?.hits?.length ?? 0} match
              {(call.result?.fullHits?.length ?? call.result?.hits?.length ?? 0) === 1 ? '' : 'es'}
            </span>
          )}
          {isFetchArtifact && call.status === 'ok' && typeof call.result?.contentLength === 'number' && (
            <span className="rounded-full bg-violet-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-violet-700 dark:text-violet-300">
              {call.result.contentLength} chars
              {call.result.truncated && <span className="ml-1 font-normal normal-case tracking-normal opacity-75">· trimmed</span>}
            </span>
          )}
          {isRecallMemory && call.status === 'ok' && typeof call.result?.count === 'number' && (
            <span className="rounded-full bg-indigo-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-indigo-700 dark:text-indigo-300">
              {call.result.count} memor{call.result.count === 1 ? 'y' : 'ies'}
            </span>
          )}
          {isFetchUrl && call.status === 'ok' && call.result?.url && (
            <a
              href={call.result.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="rounded p-1 text-fg-subtle transition hover:bg-bg-muted hover:text-fg"
              title="Open in new tab"
            >
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
          {call.status === 'pending' && (
            <span className="flex items-center gap-1 text-fg-subtle">
              <span className="h-1.5 w-1.5 animate-think-pulse rounded-full bg-accent" />
              {isWebSearch ? 'searching…' : isFetchUrl ? 'fetching…' : isArtifactSearch ? 'searching library…' : isFetchArtifact ? 'reading…' : isRecallMemory ? 'recalling…' : 'running…'}
            </span>
          )}
          {call.status === 'ok' && <span className="text-success">done</span>}
          {call.status === 'error' && (
            <span className={isMissed ? 'text-amber-600 dark:text-amber-400' : 'text-danger'}>
              {isMissed ? 'missed' : 'failed'}
            </span>
          )}
          <ChevronDown
            className={cn('h-3.5 w-3.5 text-fg-subtle transition-transform', open ? 'rotate-0' : '-rotate-90')}
          />
        </div>
      </button>

      {open && isMissed && (
        <div className="border-t border-amber-500/20 bg-amber-500/5 p-3 text-[11.5px] leading-relaxed text-amber-900 dark:text-amber-100">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="flex-1 min-w-0">
              <div className="font-medium">
                The model tried to call <code className="rounded bg-amber-500/15 px-1 py-0.5 font-mono text-[10.5px]">{call.name}</code> but wrote it in prose instead of invoking the tool.
              </div>
              <div className="mt-1 text-amber-800/80 dark:text-amber-200/80">
                {isRerunning
                  ? 'Running the tool for you now…'
                  : "This usually means the model doesn't support function calling. You can run the tool yourself, or switch to a model that does."}
              </div>
              {call.args && Object.keys(call.args).length > 0 && !isRerunning && (
                <div className="mt-2">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-300">Arguments the model tried to send</div>
                  <pre className="mt-1 max-h-32 overflow-auto rounded bg-amber-500/10 p-2 font-mono text-[10.5px] text-amber-900 dark:text-amber-100">
{JSON.stringify(call.args, null, 2)}
                  </pre>
                </div>
              )}
              {/* Rerun action — turn the missed call into a real tool call.
                  Once it completes, the row flips to status='ok' with no
                  `missed: true` flag, so the body re-renders as the regular
                  Claude-style result panel (WebSearchResults / FetchUrlResults
                  / ArtifactSearchResults) instead of this amber box. */}
              {onRerun && call.toolCallId && (
                <div className="mt-3 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      onRerun(call.toolCallId!, call.name, call.args, assistantMsgId)
                    }}
                    disabled={isRerunning}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-semibold transition',
                      'bg-amber-500/20 text-amber-900 hover:bg-amber-500/30 dark:text-amber-100',
                      isRerunning && 'cursor-not-allowed opacity-60'
                    )}
                    title="Actually run this tool call now (uses your configured search provider)"
                  >
                    {isRerunning ? (
                      <>
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Running…
                      </>
                    ) : (
                      <>
                        <RotateCw className="h-3 w-3" />
                        {call.name === 'web_search' && 'Run this search now'}
                        {call.name === 'fetch_url' && 'Read this page now'}
                        {call.name === 'search_artifacts' && 'Search my library now'}
                        {call.name === 'fetch_artifact' && 'Read this artifact now'}
                      </>
                    )}
                  </button>
                  {!isRerunning && (
                    <span className="text-[10px] text-amber-700/70 dark:text-amber-300/70">
                      Uses your configured search provider
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {open && isWebSearch && !isMissed && <WebSearchResults call={call} />}
      {open && isFetchUrl && !isMissed && <FetchUrlResults call={call} />}
      {open && isArtifactSearch && !isMissed && call.status === 'ok' && (
        <ArtifactSearchResults call={call} onJumpToLibrary={() => navigate('/library')} />
      )}
      {open && isArtifactSearch && !isMissed && call.status === 'error' && (
        <div className="border-t border-border-subtle bg-bg-subtle/50 p-3 text-[11px] text-danger">
          {call.result?.error || 'Artifact search failed.'}
        </div>
      )}
      {open && isArtifactSearch && !isMissed && call.status === 'pending' && (
        <div className="border-t border-border-subtle bg-bg-subtle/50 p-3 text-[11px] text-fg-muted">
          Searching the founder's saved library for "{call.args?.query || '…'}"…
        </div>
      )}
      {open && isFetchArtifact && !isMissed && <FetchArtifactResults call={call} onJumpToLibrary={() => navigate('/library')} />}
      {open && isRecallMemory && !isMissed && <RecallMemoryResults call={call} />}
      {open && !isMissed && !isArtifactSearch && !isWebSearch && !isFetchUrl && !isFetchArtifact && !isRecallMemory && call.result && (
        <div className="border-t border-border-subtle bg-bg-subtle/50 p-3 font-mono text-[11px] text-fg-muted">
          <pre className="whitespace-pre-wrap break-words">{JSON.stringify(call.result, null, 2).slice(0, 600)}</pre>
        </div>
      )}
    </div>
  )
}

function RecallMemoryResults({ call }: { call: { args?: any; result?: any; status: string } }) {
  if (call.status === 'pending') {
    return (
      <div className="border-t border-indigo-500/20 bg-indigo-500/5 p-3 text-[11.5px] text-fg-muted">
        <div className="flex items-center gap-2">
          <Brain className="h-3 w-3 text-indigo-500" />
          <span>Searching memory for <span className="text-fg">"{call.args?.query}"</span>…</span>
        </div>
      </div>
    )
  }
  if (call.status === 'error') {
    return (
      <div className="border-t border-indigo-500/20 bg-indigo-500/5 p-3 text-[11.5px] text-danger">
        {call.result?.error || 'Memory recall failed.'}
      </div>
    )
  }
  const hits: any[] = call.result?.hits || []
  if (hits.length === 0) {
    return (
      <div className="border-t border-indigo-500/20 bg-indigo-500/5 p-3 text-[11.5px] text-fg-muted">
        No memories found for "{call.args?.query}".
      </div>
    )
  }
  const TYPE_COLOR: Record<string, string> = {
    insight: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
    decision: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
    context: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
    metric: 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
    question: 'bg-orange-500/15 text-orange-700 dark:text-orange-300',
    learning: 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
  }
  return (
    <div className="border-t border-indigo-500/20 bg-indigo-500/5 divide-y divide-indigo-500/10">
      {hits.map((h: any, i: number) => (
        <div key={h.id || i} className="flex items-start gap-2.5 px-3 py-2.5">
          <span className="mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-indigo-500/20 text-[9px] font-bold text-indigo-700 dark:text-indigo-300">
            {i + 1}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              {h.type && (
                <span className={`rounded-full px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wider ${TYPE_COLOR[h.type] || 'bg-bg-muted text-fg-muted'}`}>
                  {h.type}
                </span>
              )}
              {h.tags?.map((t: string) => (
                <span key={t} className="rounded-full bg-bg-muted px-1.5 py-0.5 text-[9.5px] text-fg-subtle">{t}</span>
              ))}
              {h.createdAt && (
                <span className="text-[9.5px] text-fg-subtle tabular-nums">
                  {new Date(h.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </span>
              )}
            </div>
            <p className="mt-1 text-[11.5px] leading-relaxed text-fg">{h.content}</p>
          </div>
        </div>
      ))}
    </div>
  )
}

function WebSearchResults({ call }: { call: { args?: any; result?: any; status: string } }) {
  if (call.status === 'pending') {
    return <WebSearchPending call={call} />
  }
  if (call.status === 'error') {
    return (
      <div className="border-t border-sky-500/20 bg-sky-500/5 p-3 text-[11.5px] text-danger">
        <div className="flex items-center gap-2">
          <Globe className="h-3 w-3" />
          <span>{call.result?.error || 'Web search failed.'}</span>
        </div>
      </div>
    )
  }
  const results: any[] = call.result?.fullResults || call.result?.results || []
  if (results.length === 0) {
    return (
      <div className="border-t border-sky-500/20 bg-sky-500/5 p-3 text-[11.5px] text-fg-muted">
        <div className="flex items-center gap-2">
          <Globe className="h-3 w-3 text-sky-500" />
          <span>No results for <span className="text-fg">"{call.args?.query}"</span>.</span>
        </div>
      </div>
    )
  }
  return (
    <WebSearchSources
      query={call.args?.query}
      results={results}
      source={call.result?.source}
      topic={call.args?.topic}
      recencyDays={call.args?.recencyDays}
      tookMs={call.result?.tookMs}
    />
  )
}

/**
 * Claude-style web search results. The header shows the query + a
 * compact meta line ("N sources · tavily · 245ms"). Each source is a
 * card with a circular hostname-letter badge, a clickable title, the
 * hostname + favicon-style metadata, a snippet, and a cite number the
 * user can reference in conversation.
 */
function WebSearchSources({
  query,
  results,
  source,
  topic,
  recencyDays,
  tookMs,
}: {
  query?: string
  results: any[]
  source?: string
  topic?: string
  recencyDays?: number
  tookMs?: number
}) {
  return (
    <div className="border-t border-sky-500/20 bg-sky-500/[0.03]">
      {/* Header — like Claude's "Web search" header */}
      <div className="flex items-center gap-2.5 border-b border-sky-500/15 px-3 py-2">
        <div className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-md bg-sky-500/10 text-sky-500">
          <Globe className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold text-fg">Web search</div>
          {query && (
            <div className="truncate text-[10.5px] text-fg-muted">
              {query}
              {topic === 'news' && <span className="ml-1.5 text-fg-subtle">· news</span>}
              {recencyDays ? <span className="ml-1.5 text-fg-subtle">· last {recencyDays}d</span> : null}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-fg-subtle">
          <span className="rounded-full bg-sky-500/10 px-1.5 py-0.5 font-semibold text-sky-700 dark:text-sky-300">
            {results.length} {results.length === 1 ? 'source' : 'sources'}
          </span>
          {source && source !== 'none' && (
            <span className="rounded-full bg-bg-muted px-1.5 py-0.5 normal-case">{source}</span>
          )}
          {typeof tookMs === 'number' && (
            <span className="hidden items-center gap-0.5 sm:flex">
              <Clock className="h-2.5 w-2.5" />
              {tookMs}ms
            </span>
          )}
        </div>
      </div>
      {/* Source cards */}
      <ul className="divide-y divide-border-subtle/60">
        {results.map((r: any, i: number) => (
          <WebSearchSourceCard key={r.url || i} index={i + 1} result={r} />
        ))}
      </ul>
    </div>
  )
}

function WebSearchSourceCard({ index, result }: { index: number; result: any }) {
  const url = result.url || ''
  let host = ''
  try {
    if (url) host = new URL(url).hostname.replace(/^www\./, '')
  } catch {
    /* malformed URL — leave host empty */
  }
  const initial = (host || result.title || '?').charAt(0).toUpperCase()
  return (
    <li className="group px-3 py-2.5 text-[11.5px] transition hover:bg-sky-500/5">
      <div className="flex items-start gap-2.5">
        <div className="flex flex-col items-center gap-1 pt-0.5">
          <span
            className="grid h-7 w-7 place-items-center rounded-md bg-gradient-to-br from-sky-500/15 to-sky-500/5 font-mono text-[12px] font-semibold text-sky-700 dark:text-sky-300"
            title={host || url || result.title}
          >
            {initial}
          </span>
          <span className="text-[9px] font-medium text-fg-subtle">#{index}</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <a
              href={url || '#'}
              target="_blank"
              rel="noopener noreferrer"
              className="min-w-0 flex-1 truncate font-medium text-fg hover:text-sky-700 hover:underline dark:hover:text-sky-300"
            >
              {result.title || host || url || '(untitled)'}
            </a>
            {result.publishedDate && (
              <span className="flex-shrink-0 rounded bg-bg-muted px-1.5 py-0.5 text-[9.5px] tabular-nums text-fg-subtle">
                {result.publishedDate}
              </span>
            )}
          </div>
          {host && (
            <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-fg-subtle">
              <span className="font-mono">{host}</span>
              {url && url !== `https://${host}` && url !== `http://${host}` && (
                <span className="truncate text-fg-subtle/70">· {url}</span>
              )}
            </div>
          )}
          {result.snippet && (
            <p className="mt-1.5 line-clamp-2 text-[11.5px] leading-relaxed text-fg-muted">
              {result.snippet}
            </p>
          )}
        </div>
        <a
          href={url || '#'}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-0.5 grid h-6 w-6 flex-shrink-0 place-items-center rounded-md text-fg-subtle opacity-0 transition hover:bg-bg-muted hover:text-fg group-hover:opacity-100"
          title="Open in new tab"
        >
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    </li>
  )
}

function WebSearchPending({ call }: { call: { args?: any; status: string } }) {
  return (
    <div className="border-t border-sky-500/20 bg-sky-500/[0.03] px-3 py-2.5">
      <div className="flex items-center gap-2.5">
        <div className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-md bg-sky-500/10 text-sky-500">
          <Globe className="h-3.5 w-3.5 animate-pulse" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold text-fg">Searching the web</div>
          <div className="truncate text-[10.5px] text-fg-muted">
            "{call.args?.query || '…'}"
            {call.args?.topic === 'news' && <span className="ml-1.5 text-fg-subtle">· news</span>}
            {call.args?.recencyDays ? <span className="ml-1.5 text-fg-subtle">· last {call.args.recencyDays}d</span> : null}
          </div>
        </div>
        <div className="flex items-center gap-1 text-fg-subtle">
          <span className="h-1.5 w-1.5 animate-think-pulse rounded-full bg-accent" />
          <span className="text-[10px]">searching…</span>
        </div>
      </div>
    </div>
  )
}

function FetchUrlResults({ call }: { call: { args?: any; result?: any; status: string } }) {
  if (call.status === 'pending') {
    return (
      <div className="border-t border-emerald-500/20 bg-emerald-500/[0.03] px-3 py-2.5">
        <div className="flex items-center gap-2.5">
          <div className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-md bg-emerald-500/10 text-emerald-500">
            <Link2 className="h-3.5 w-3.5 animate-pulse" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-semibold text-fg">Reading page</div>
            <div className="truncate font-mono text-[10.5px] text-fg-muted">{call.args?.url || '…'}</div>
          </div>
          <div className="flex items-center gap-1 text-fg-subtle">
            <span className="h-1.5 w-1.5 animate-think-pulse rounded-full bg-accent" />
            <span className="text-[10px]">fetching…</span>
          </div>
        </div>
      </div>
    )
  }
  if (call.status === 'error') {
    return (
      <div className="border-t border-emerald-500/20 bg-emerald-500/5 p-3 text-[11.5px] text-danger">
        <div className="flex items-center gap-2">
          <Link2 className="h-3 w-3" />
          <span>{call.result?.error || 'Fetch failed.'}</span>
        </div>
      </div>
    )
  }
  const title = call.result?.title
  const url = call.result?.url || call.args?.url
  const text = typeof call.result?.text === 'string' ? call.result.text : ''
  const byteLength: number = call.result?.byteLength || text.length
  let host = ''
  try {
    if (url) host = new URL(url).hostname.replace(/^www\./, '')
  } catch {
    /* malformed URL */
  }
  return (
    <div className="border-t border-emerald-500/20 bg-emerald-500/[0.03]">
      <div className="flex items-center gap-2.5 border-b border-emerald-500/15 px-3 py-2">
        <div className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-md bg-gradient-to-br from-emerald-500/15 to-emerald-500/5 font-mono text-[12px] font-semibold text-emerald-700 dark:text-emerald-300">
          {(host || url || '?').charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold text-fg">Reading page</div>
          <div className="truncate text-[10.5px] text-fg-muted">
            {title ? <span className="text-fg">{title}</span> : null}
            {title && host ? <span className="mx-1.5 text-fg-subtle">·</span> : null}
            {host && <span className="font-mono">{host}</span>}
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-fg-subtle">
          {byteLength > 0 && (
            <span className="rounded-full bg-emerald-500/10 px-1.5 py-0.5 font-semibold text-emerald-700 dark:text-emerald-300">
              {(byteLength / 1000).toFixed(1)}k chars
            </span>
          )}
          {url && (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="grid h-6 w-6 place-items-center rounded-md text-fg-subtle transition hover:bg-bg-muted hover:text-fg"
              title="Open in new tab"
            >
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      </div>
      {text && (
        <div className="px-3 py-2">
          <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-bg/60 p-2.5 font-mono text-[10.5px] leading-relaxed text-fg-muted">
            {text.slice(0, 1200)}{text.length > 1200 && '…'}
          </pre>
        </div>
      )}
    </div>
  )
}

function ArtifactSearchResults({
  call,
  onJumpToLibrary,
}: {
  call: { args?: any; result?: any }
  onJumpToLibrary: () => void
}) {
  const result = call.result || {}
  const hits: any[] = result.fullHits || result.hits || []
  const summary: string = result.summary || ''
  const scanned: number = result.scanned || 0

  if (hits.length === 0) {
    return (
      <div className="border-t border-border-subtle bg-bg-subtle/50 p-3 text-[11px] text-fg-muted">
        <div className="flex items-center gap-2">
          <Database className="h-3 w-3 text-violet-500" />
          <span>
            {summary || `No saved artifacts matched.`}{' '}
            {scanned > 0 && <span className="text-fg-subtle">(scanned {scanned})</span>}
          </span>
        </div>
        <button
          onClick={onJumpToLibrary}
          className="mt-2 inline-flex items-center gap-1 text-[10px] text-fg-subtle hover:text-fg"
        >
          Open library <ArrowRight className="h-2.5 w-2.5" />
        </button>
      </div>
    )
  }

  return (
    <div className="border-t border-border-subtle bg-bg-subtle/40">
      <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-1.5 text-[10px] uppercase tracking-wider text-fg-subtle">
        <Database className="h-3 w-3 text-violet-500" />
        <span>Library matches</span>
        <span className="ml-auto text-fg-muted normal-case tracking-normal">
          {hits.length} of {scanned}
        </span>
      </div>
      <ul className="divide-y divide-border-subtle">
        {hits.map((h: any, i: number) => (
          <li key={h.id || i} className="px-3 py-2 text-[11.5px]">
            <div className="flex items-baseline gap-2">
              {h.type && (
                <span className="text-base leading-none" title={h.type}>
                  {(ARTIFACT_TEMPLATES as any)[h.type]?.emoji || '📄'}
                </span>
              )}
              <div className="flex-1 min-w-0 truncate font-medium text-fg">
                {h.title || h.id}
              </div>
              {h.pinned && <Pin className="h-2.5 w-2.5 fill-current text-accent" />}
              {h.matchedFields && h.matchedFields.length > 0 && (
                <div className="flex flex-shrink-0 items-center gap-0.5">
                  {h.matchedFields.includes('title') && (
                    <span className="rounded-full bg-violet-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-violet-700 dark:text-violet-300">
                      title
                    </span>
                  )}
                  {h.matchedFields.includes('tags') && (
                    <span className="rounded-full bg-fuchsia-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-fuchsia-700 dark:text-fuchsia-300">
                      tag
                    </span>
                  )}
                  {h.matchedFields.includes('content') && (
                    <span className="rounded-full bg-indigo-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-indigo-700 dark:text-indigo-300">
                      body
                    </span>
                  )}
                  {h.broadRecall && (
                    <span
                      className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-300"
                      title="Matched via broad-recall (stem/prefix fallback)"
                    >
                      broad
                    </span>
                  )}
                </div>
              )}
            </div>
            {/* Show the match terms so the user can see why this artifact was
                surfaced. Exact matches in emerald; stem/prefix in amber. */}
            {h.matchDetails && h.matchDetails.length > 0 && (
              <div className="mt-1 flex flex-wrap items-center gap-1 text-[9px]">
                {h.matchDetails.map((m: any, k: number) => (
                  <span
                    key={k}
                    className={
                      m.exact
                        ? 'rounded bg-emerald-500/10 px-1 py-0.5 font-mono text-emerald-700 dark:text-emerald-300'
                        : 'rounded bg-amber-500/10 px-1 py-0.5 font-mono text-amber-700 dark:text-amber-300'
                    }
                    title={m.exact ? 'exact match' : 'stem/prefix fallback'}
                  >
                    {m.term}
                  </span>
                ))}
              </div>
            )}
            {/* AI summary is the main thing — it's what the model saw, so showing it to
                the user keeps the chat legible. Falls back to the body snippet if the
                summarizer hasn't run yet. */}
            {h.summary ? (
              <div className="mt-1 text-[11.5px] leading-relaxed text-fg-muted">
                {h.summary}
              </div>
            ) : h.snippet ? (
              <div className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-fg-muted">
                {highlightSnippet(h.snippet, tokenizeForSearch(call.args?.query)).map((seg, i) =>
                  seg.match ? (
                    <mark key={i} className="rounded bg-violet-500/20 px-0.5 text-violet-700 dark:text-violet-300">
                      {seg.text}
                    </mark>
                  ) : (
                    <span key={i}>{seg.text}</span>
                  )
                )}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      <button
        onClick={onJumpToLibrary}
        className="flex w-full items-center justify-center gap-1.5 border-t border-border-subtle bg-bg-subtle/30 py-1.5 text-[10px] text-fg-muted transition hover:bg-bg-muted hover:text-fg"
      >
        Open full library <ArrowRight className="h-2.5 w-2.5" />
      </button>
    </div>
  )
}

/**
 * Render the result of a `fetch_artifact` tool call — the model deep-read a
 * specific saved artifact. Shows the summary (if any) and the trimmed body
 * in a scrollable preview, with an "Open in library" button to edit it.
 */
function FetchArtifactResults({
  call,
  onJumpToLibrary,
}: {
  call: { args?: any; result?: any; status: string }
  onJumpToLibrary: () => void
}) {
  if (call.status === 'pending') {
    return (
      <div className="border-t border-border-subtle bg-bg-subtle/50 p-3 text-[11px] text-fg-muted">
        <div className="flex items-center gap-2">
          <FileText className="h-3 w-3 animate-pulse text-violet-500" />
          <span>Reading artifact <span className="font-mono">{call.args?.id || '…'}</span>…</span>
        </div>
      </div>
    )
  }
  if (call.status === 'error') {
    return (
      <div className="border-t border-border-subtle bg-bg-subtle/50 p-3 text-[11px] text-danger">
        {call.result?.error || 'Fetch artifact failed.'}
      </div>
    )
  }
  const title = call.result?.title || call.args?.id || 'Artifact'
  const summary = call.result?.summary
  const content = call.result?.content || ''
  const contentLength = call.result?.contentLength || content.length
  const truncated = !!call.result?.truncated
  return (
    <div className="border-t border-border-subtle bg-bg-subtle/40">
      <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-1.5 text-[10px] uppercase tracking-wider text-fg-subtle">
        <FileText className="h-3 w-3 text-violet-500" />
        <span className="font-mono text-fg-muted normal-case tracking-normal">
          {title}
        </span>
        {truncated && (
          <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-300">
            trimmed
          </span>
        )}
        <span className="ml-auto text-fg-subtle normal-case tracking-normal">
          {contentLength.toLocaleString()} chars
        </span>
      </div>
      <div className="px-3 py-2">
        {summary && (
          <div className="mb-2 rounded-md border border-violet-500/20 bg-violet-500/5 p-2 text-[11.5px] leading-relaxed text-fg-muted">
            <span className="font-semibold text-fg">Summary: </span>
            {summary}
          </div>
        )}
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border-subtle bg-bg/50 p-2 font-mono text-[10.5px] leading-relaxed text-fg-muted">
{content}
        </pre>
        <button
          onClick={onJumpToLibrary}
          className="mt-2 inline-flex items-center gap-1 text-[10px] text-fg-subtle hover:text-fg"
        >
          Open in library <ArrowRight className="h-2.5 w-2.5" />
        </button>
      </div>
    </div>
  )
}

function ArtifactCard({ artifact, sourceMessageId, conversationId }: { artifact: ReturnType<typeof parseArtifacts>[0]; sourceMessageId: string; conversationId: string }) {
  const toast = useToast()
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const template = ARTIFACT_TEMPLATES[artifact.type]

  const save = async () => {
    setSaving(true)
    try {
      const id = nanoid(12)
      await db.artifacts.put({
        id,
        type: artifact.type,
        title: artifact.title || template.defaultTitle,
        content: artifact.content,
        sourceMessageId,
        conversationId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      setSaved(true)
      toast.success('Saved to library', artifact.title || template.defaultTitle)
    } catch (e: any) {
      toast.error('Save failed', e?.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 4, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.2 }}
      className="group overflow-hidden rounded-2xl border border-accent/30 bg-gradient-to-br from-accent/5 via-bg-subtle to-bg-subtle"
    >
      <div className="flex items-center gap-2 border-b border-border-subtle bg-bg-subtle/50 px-4 py-2">
        <div className="text-base">{template.emoji}</div>
        <div className="flex-1 min-w-0">
          <div className="truncate font-serif text-base font-medium tracking-tight text-fg">{artifact.title || template.defaultTitle}</div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-fg-subtle">{template.name}</div>
        </div>
        <button
          onClick={save}
          disabled={saving || saved}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition focus-ring',
            saved
              ? 'bg-success/15 text-success'
              : 'bg-accent text-accent-fg hover:shadow-glow'
          )}
        >
          {saved ? <Check className="h-3 w-3" /> : <Save className="h-3 w-3" />}
          {saved ? 'Saved' : saving ? 'Saving…' : 'Save to library'}
        </button>
      </div>
      <div className="prose-chat max-h-96 overflow-y-auto p-4 text-sm">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{artifact.content}</ReactMarkdown>
      </div>
    </motion.div>
  )
}

function PendingArtifacts({ text, conversationId, messageId }: { text: string; conversationId: string; messageId: string }) {
  const seenRef = useRef<Set<number>>(new Set())
  const artifacts = parseArtifacts(text)
  const fresh = artifacts.filter((a) => !seenRef.current.has(a.startIndex))

  useEffect(() => {
    fresh.forEach((a) => seenRef.current.add(a.startIndex))
  }, [fresh])

  if (fresh.length === 0) return null
  return (
    <div className="flex flex-col gap-2">
      {fresh.map((a) => (
        <ArtifactCard
          key={`${a.startIndex}-${a.endIndex}`}
          artifact={a}
          sourceMessageId={messageId}
          conversationId={conversationId}
        />
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Message actions (Add to tasks, Save as artifact) + artifact badge
// (round-trip nav).
// ---------------------------------------------------------------------------

/**
 * Action pill that appears at the top-right of each message on hover.
 * Both the user and assistant messages get the same controls so the
 * user can promote anything they see to a task or saved library doc.
 */
function MessageActions({
  message,
  conversationId,
}: {
  message: Message
  artifacts: Artifact[]
  conversationId: string
}) {
  const [saveOpen, setSaveOpen] = useState(false)
  const isUser = message.role === 'user'

  // Pre-fill the "Add to tasks" popover with the first 80 chars of the
  // message — the user can hit Enter immediately if the message is the
  // task itself.
  const firstLine = useMemo(() => {
    const t = (message.content || '').replace(/\n+/g, ' ').trim()
    if (t.length <= 80) return t
    return t.slice(0, 77).trimEnd() + '…'
  }, [message.content])

  return (
    <>
      <div
        className={cn(
          'pointer-events-none absolute -top-2 z-10 flex items-center gap-1 opacity-0 transition',
          isUser ? 'right-2' : 'right-0',
          'group-hover/message:opacity-100 group-hover/message:pointer-events-auto focus-within:opacity-100 focus-within:pointer-events-auto'
        )}
      >
        <AddToTaskComposer
          variant="icon"
          source="chat"
          conversationId={conversationId}
          messageId={message.id}
          prefill={firstLine}
        />
        <button
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            setSaveOpen(true)
          }}
          className="inline-flex items-center gap-1 rounded-full border border-border-subtle bg-bg-subtle/60 px-2 py-0.5 text-[10px] font-medium text-fg-muted opacity-0 transition hover:border-accent/40 hover:bg-accent/5 hover:text-accent group-hover/message:opacity-100 focus:opacity-100"
          title="Save this message to your library"
        >
          <Bookmark className="h-2.5 w-2.5" />
          Save
        </button>
      </div>
      <SaveArtifactModal
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        content={message.content}
        sourceMessageId={message.id}
        conversationId={conversationId}
      />
    </>
  )
}

/**
 * Inline badge shown below messages that have produced at least one
 * saved artifact. Clicking the badge opens that artifact in the
 * Library (round-trip nav — Feature 5).
 */
function ArtifactBadge({ artifacts }: { artifacts: Artifact[] }) {
  const navigate = useNavigate()
  if (artifacts.length === 0) return null
  const template = ARTIFACT_TEMPLATES[artifacts[0].type]
  return (
    <button
      onClick={() => {
        navigate(`/library?open=${artifacts[0].id}`)
      }}
      className="mt-1 inline-flex items-center gap-1.5 rounded-full border border-violet-500/30 bg-violet-500/5 px-2 py-0.5 text-[10px] font-medium text-violet-700 transition hover:border-violet-500/50 hover:bg-violet-500/10 dark:text-violet-300"
      title="Open in library"
    >
      <Bookmark className="h-2.5 w-2.5 fill-current" />
      <span>Saved → {template.emoji} {artifacts[0].title || template.defaultTitle}</span>
      {artifacts.length > 1 && (
        <span className="rounded-full bg-violet-500/20 px-1 text-[9px]">+{artifacts.length - 1}</span>
      )}
    </button>
  )
}

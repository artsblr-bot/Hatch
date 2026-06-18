import { useEffect, useRef, useState, useCallback } from 'react'
import { useNavigate, useParams, useSearchParams, useLocation } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { nanoid } from 'nanoid'
import {
  db,
  updateCompany,
  type AgentRole,
  type Message,
  type Conversation,
  type CompanyMemory,
} from '@/lib/db'
import { shouldInfer, inferPersonalityStyle } from '@/lib/personalityInfer'
import { AGENTS } from '@/lib/agents'
import { runChat, extractMemory, extractArchivalMemories, rerunMissedToolCall } from '@/lib/chat'
import { isUnlocked } from '@/lib/crypto'
import { type ProviderId, getModelInfo } from '@/lib/providers'
import { useToast } from '@/components/Toast'
import { ChatHeader } from '@/components/ChatHeader'
import { MessageList } from '@/components/MessageList'
import { ChatComposer } from '@/components/ChatComposer'
import { useJitterBuffer } from '@/hooks/useJitterBuffer'

// ---------------------------------------------------------------------------
// First-chat welcome message — personalised from onboarding data
// ---------------------------------------------------------------------------

function buildWelcomeMessage(c: CompanyMemory): string {
  const stage  = c.stage  || 'idea'
  const idea   = c.idea?.trim()
  const icp    = c.icp?.trim()
  const name   = c.name?.trim()

  const hooks: Record<string, string> = {
    idea:       "The idea stage is where most founders spin their wheels — overthinking instead of testing. Let's skip that.",
    validating: "Validation mode is where momentum is made or lost. Let's make sure you're running the right experiments.",
    building:   "Building is where scope creep quietly kills momentum. Let's keep your priorities sharp.",
    launched:   "Being live is huge — most people never get here. Growth mode is a completely different game.",
  }

  const questions: Record<string, string> = {
    idea:       "**What's the one assumption about this idea that scares you the most?** That's where we start.",
    validating: "**What does your current validation look like?** Are you talking to real people yet, or still figuring out how to reach them?",
    building:   "**What's the one thing you absolutely need to ship this week?** Let's protect it from everything else.",
    launched:   "**What's your biggest bottleneck right now** — getting people to find you, or getting them to come back?",
  }

  let msg = ''
  if (name && idea && icp) {
    msg += `Hey — I've got your context. You're building **${idea}** for **${icp}**.\n\n`
  } else if (idea) {
    msg += `Hey — I know you're working on **${idea}**.\n\n`
  } else if (name) {
    msg += `Hey — I'm your cofounder for **${name}**. Let's build something people actually want.\n\n`
  } else {
    msg += `Hey — I'm your AI cofounder. Strategy, product, marketing, finance — all in one.\n\n`
  }

  msg += hooks[stage] ?? hooks.idea
  msg += '\n\n'
  msg += questions[stage] ?? questions.idea

  return msg
}

export function ChatPage() {
  const { conversationId: paramId } = useParams<{ conversationId: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const toast = useToast()
  const settings              = useLiveQuery(() => db.settings.get('singleton'), [])
  const company               = useLiveQuery(() => db.company.get('singleton'), [])
  const totalConversationCount = useLiveQuery(() => db.conversations.count(), [])
  const userMessageCount      = useLiveQuery(() => db.messages.where('role').equals('user').count(), []) || 0

  const [conversationId, setConversationId] = useState<string | null>(paramId || null)
  const activeAgent: AgentRole = 'cofounder'
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamingMsgId, setStreamingMsgId] = useState<string | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()
  const highlightMsgId = searchParams.get('msg')
  const [stepOverrides, setStepOverrides] = useState<Record<string, 'pending' | 'active' | 'done' | 'error'>>({})
  // Tool overrides are keyed by toolCallId (not tool name) so multiple parallel
  // calls to the same tool don't clobber each other. We keep a name→id map
  // for backward compat with stored messages that don't have toolCallId.
  const [toolOverrides, setToolOverrides] = useState<Record<string, { status: 'pending' | 'ok' | 'error'; result?: any; name?: string }>>({})
  const [streamingReasoning, setStreamingReasoning] = useState('')
  const streamTextRef = useRef('')
  const streamReasoningRef = useRef('')
  const abortRef = useRef<AbortController | null>(null)
  /** Conversation ID the in-flight stream belongs to (null when idle) */
  const streamingConvIdRef = useRef<string | null>(null)
  /** Abort controller for an in-flight "rerun missed call" request (separate
   * from the chat stream abort, so a rerun can be cancelled independently) */
  const rerunAbortRef = useRef<AbortController | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const jitter = useJitterBuffer({ charsPerSecond: 90, tickMs: 32, immediate: true })

  // Quick-prompt prefill from Landing page chips
  const prefillRef = useRef<string | null>(
    typeof (location.state as any)?.prefill === 'string' ? (location.state as any).prefill : null
  )
  const prefillSentRef = useRef(false)

  // Sync state when the URL param changes (clicking a different conversation
  // in the sidebar, ⌘K, etc.). React re-uses the same component instance when
  // only the route param changes, so useState's initialiser doesn't re-run.
  // Without this, all queries stay pinned to the first conversation opened.
  useEffect(() => {
    const next = paramId || null
    if (next === conversationId) return

    // Abort any in-flight stream that belongs to a different conversation
    if (streamingConvIdRef.current && streamingConvIdRef.current !== next) {
      abortRef.current?.abort()
      // Clear local streaming state so the UI shows the new chat cleanly
      setIsStreaming(false)
      setStreamingMsgId(null)
      setStreamingReasoning('')
      setStepOverrides({})
      setToolOverrides({})
      streamTextRef.current = ''
      streamReasoningRef.current = ''
      jitter.clear()
    }

    setConversationId(next)
  }, [paramId, conversationId, jitter])

  const messages = useLiveQuery(
    () =>
      conversationId
        ? db.messages.where('conversationId').equals(conversationId).sortBy('createdAt')
        : Promise.resolve([] as Message[]),
    [conversationId]
  ) || []

  const conversation: Conversation | undefined = useLiveQuery(
    () => (conversationId ? db.conversations.get(conversationId) : Promise.resolve(undefined)),
    [conversationId]
  ) as Conversation | undefined

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages.length, isStreaming])

  // Deep-link support: ?msg=<id> scrolls to that message and flashes it
  // (used by the Library "From this conversation" badge — Feature 5).
  useEffect(() => {
    if (!highlightMsgId || !messages.length) return
    // Wait a tick so the message DOM nodes are mounted
    const t = setTimeout(() => {
      const el = document.querySelector(`[data-message-id="${highlightMsgId}"]`) as HTMLElement | null
      if (!el) return
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el.classList.add('ring-2', 'ring-accent/40', 'transition', 'duration-300')
      // Pulse the highlight: clear after a few seconds
      setTimeout(() => {
        el.classList.remove('ring-2', 'ring-accent/40')
        // Strip the query param so re-navigating doesn't keep flashing
        const next = new URLSearchParams(searchParams)
        next.delete('msg')
        setSearchParams(next, { replace: true })
      }, 2500)
    }, 120)
    return () => clearTimeout(t)
  }, [highlightMsgId, messages.length])

  const ensureConversation = useCallback(
    async (agent: AgentRole): Promise<string> => {
      if (conversationId) return conversationId
      const id = nanoid(12)
      const conv: Conversation = {
        id,
        agentRole: agent,
        title: 'New conversation',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messageCount: 0,
      }
      await db.conversations.put(conv)
      setConversationId(id)
      navigate(`/chat/${id}`, { replace: true })
      return id
    },
    [conversationId, navigate]
  )

  const handleSend = useCallback(
    async (text: string) => {
      if (!settings || !text.trim()) return
      if (!isUnlocked()) {
        toast.error('Vault is locked', 'Unlock your data to chat.')
        return
      }

      const convId = await ensureConversation(activeAgent)
      const now = Date.now()

      // Optimistic user message
      const userMsg: Message = {
        id: nanoid(12),
        conversationId: convId,
        role: 'user',
        content: text,
        createdAt: now,
      }
      await db.messages.put(userMsg)

      // Auto-title from first message
      const allMsgs = await db.messages.where('conversationId').equals(convId).count()
      if (allMsgs === 1) {
        const title = text.slice(0, 60).replace(/\n/g, ' ').trim() + (text.length > 60 ? '…' : '')
        await db.conversations.update(convId, { title, updatedAt: now, messageCount: 1 })
      } else {
        await db.conversations.update(convId, { updatedAt: now, messageCount: allMsgs })
      }

      // Build message history from current messages + new user message
      const all = await db.messages.where('conversationId').equals(convId).sortBy('createdAt')
      const history = all
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))

      const provider = (settings.defaultProvider as ProviderId) || 'browser-ai'
      const model = settings.defaultModel || ''

      // Pre-create empty assistant message
      const assistantId = nanoid(12)
      const stepId = 'plan'
      await db.messages.put({
        id: assistantId,
        conversationId: convId,
        role: 'assistant',
        content: '',
        createdAt: Date.now() + 1,
        steps: [{ id: stepId, label: AGENTS[activeAgent].verbs[0], status: 'active' }],
      })

      setIsStreaming(true)
      setStreamingMsgId(assistantId)
      setStepOverrides({ [stepId]: 'active' })
      setToolOverrides({})
      streamTextRef.current = ''
      streamReasoningRef.current = ''
      setStreamingReasoning('')
      jitter.clear()

      const ac = new AbortController()
      abortRef.current = ac
      streamingConvIdRef.current = convId

      try {
        await runChat(
          {
            agentRole: activeAgent,
            provider,
            model,
            messages: history,
            conversationId: convId,
            signal: ac.signal,
            verbList: settings.verbLists[activeAgent] ?? AGENTS.cofounder.verbs,
            onStep: async (step) => {
              setStepOverrides((prev) => ({ ...prev, [step.id]: step.status }))
              // Persist into the assistant message
              const fresh = await db.messages.get(assistantId)
              if (!fresh) return
              const steps = fresh.steps || []
              const existing = steps.find((s) => s.id === step.id)
              const next = existing
                ? steps.map((s) => (s.id === step.id ? { ...s, ...step } : s))
                : [...steps, step]
              await db.messages.update(assistantId, { steps: next })
            },
            onToolCall: async (call) => {
              // Key overrides by toolCallId (unique) — falls back to name only
              // for legacy in-flight calls that haven't received an id yet.
              const key = call.toolCallId || `name:${call.name}:${Date.now()}`
              setToolOverrides((prev) => {
                const next = { ...prev }
                next[key] = { status: call.status, result: call.result, name: call.name }
                return next
              })
              const fresh = await db.messages.get(assistantId)
              if (!fresh) return
              const calls = fresh.toolCalls || []
              // Match by toolCallId first, then by (name + pending)
              let idx = -1
              if (call.toolCallId) {
                idx = calls.findIndex((c) => c.toolCallId === call.toolCallId)
              }
              if (idx < 0) idx = calls.findIndex((c) => c.name === call.name && c.status === 'pending')
              if (idx >= 0) {
                calls[idx] = { ...calls[idx], ...call }
              } else {
                calls.push({ ...call })
              }
              await db.messages.update(assistantId, { toolCalls: calls })
            },
            onMissedToolCall: async (missed) => {
              // Some smaller models (Hermes, NousResearch, etc.) write tool
              // calls as text in their reply instead of invoking them via the
              // API. The chat engine strips that prose, and we surface a
              // synthetic "missed tool call" row so the user can see what the
              // model tried to do and why nothing actually happened.
              const key = missed.pseudoId
              const synthResult = {
                ok: false,
                missed: true,
                reason: missed.reason,
                args: missed.args,
              }
              setToolOverrides((prev) => ({ ...prev, [key]: { status: 'error', result: synthResult, name: missed.name } }))
              const fresh = await db.messages.get(assistantId)
              if (!fresh) return
              const calls = fresh.toolCalls || []
              calls.push({
                toolCallId: missed.pseudoId,
                name: missed.name,
                args: missed.args,
                result: synthResult,
                status: 'error',
              })
              await db.messages.update(assistantId, { toolCalls: calls })
            },
          },
          {
            onToken: (t) => {
              streamTextRef.current += t
              jitter.push(t)
            },
            onReasoningDelta: (t) => {
              streamReasoningRef.current += t
              setStreamingReasoning(streamReasoningRef.current)
            },
            onDone: async (info) => {
              jitter.finish()
              // Wait briefly for the jitter buffer to drain
              await new Promise((r) => setTimeout(r, 100))
              const finalText = streamTextRef.current
              const finalReasoning = streamReasoningRef.current
              const fresh = await db.messages.get(assistantId)
              if (fresh) {
                await db.messages.update(assistantId, {
                  content: finalText,
                  reasoning: finalReasoning || undefined,
                  provider: info.provider,
                  model: info.model,
                  usage: info.usage,
                  steps: (fresh.steps || []).map((s) => ({ ...s, status: 'done' as const })),
                })
              }
              const total = await db.messages.where('conversationId').equals(convId).count()
              await db.conversations.update(convId, { messageCount: total, updatedAt: Date.now() })
              setIsStreaming(false)
              setStreamingMsgId(null)
              setStreamingReasoning('')
              streamingConvIdRef.current = null
              // Schedule memory extraction
              scheduleMemoryExtraction(convId, settings, activeAgent)
            },
            onError: async (e) => {
              const finalText = streamTextRef.current
              const finalReasoning = streamReasoningRef.current
              const fresh = await db.messages.get(assistantId)
              if (fresh) {
                await db.messages.update(assistantId, {
                  content: finalText,
                  reasoning: finalReasoning || undefined,
                  error: e?.message || 'Generation failed',
                })
              }
              setIsStreaming(false)
              setStreamingMsgId(null)
              setStreamingReasoning('')
              streamingConvIdRef.current = null
              toast.error('Generation failed', e?.message || 'Try again or check your provider settings.')
            },
            onAbort: async () => {
              const finalText = streamTextRef.current
              const finalReasoning = streamReasoningRef.current
              const fresh = await db.messages.get(assistantId)
              if (fresh) {
                await db.messages.update(assistantId, {
                  content: finalText,
                  reasoning: finalReasoning || undefined,
                  aborted: true,
                })
              }
              setIsStreaming(false)
              setStreamingMsgId(null)
              setStreamingReasoning('')
              streamingConvIdRef.current = null
              toast.info('Generation stopped')
            },
          }
        )
      } finally {
        abortRef.current = null
        streamingConvIdRef.current = null
      }
    },
    [settings, activeAgent, ensureConversation, jitter, toast]
  )

  // Fire prefill from Landing quick-prompt chips once settings are ready
  useEffect(() => {
    if (!prefillRef.current || prefillSentRef.current || !settings) return
    prefillSentRef.current = true
    const text = prefillRef.current
    prefillRef.current = null
    window.history.replaceState({}, '', window.location.href)
    handleSend(text)
  }, [settings, handleSend])

  // Inject a personalized welcome message the very first time the user opens chat
  const welcomeSentRef = useRef(false)
  useEffect(() => {
    if (welcomeSentRef.current) return
    if (!settings || !company || totalConversationCount === undefined) return
    if (totalConversationCount !== 0) return
    if (isStreaming) return
    welcomeSentRef.current = true

    const inject = async () => {
      const convId = await ensureConversation(activeAgent)
      // Brief pause so the chat UI renders before the message appears
      await new Promise((r) => setTimeout(r, 650))
      const welcomeText = buildWelcomeMessage(company)
      const msg: Message = {
        id: nanoid(12),
        conversationId: convId,
        role: 'assistant',
        content: welcomeText,
        createdAt: Date.now(),
      }
      await db.messages.put(msg)
      await db.conversations.update(convId, {
        title: 'Getting started',
        messageCount: 1,
        updatedAt: Date.now(),
      })
    }

    inject()
  }, [settings, company, totalConversationCount, isStreaming, ensureConversation, activeAgent])

  // Personality inference — runs in the background after enough messages accumulate.
  // Updates company.personalityStyle so buildSystemPrompt can adapt the cofounder's tone.
  useEffect(() => {
    if (!company || !shouldInfer(company.personalityStyle, userMessageCount)) return
    ;(async () => {
      const msgs = await db.messages.where('role').equals('user').toArray()
      const style = inferPersonalityStyle(msgs)
      if (style) await updateCompany({ personalityStyle: style })
    })()
  }, [userMessageCount]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleStop = () => {
    abortRef.current?.abort()
  }

  const handleModelChange = async (modelId: string) => {
    await db.settings.update('singleton', { defaultModel: modelId })
    const info = getModelInfo((settings?.defaultProvider as ProviderId) || 'browser-ai', modelId)
    if (info) {
      toast.info('Model changed', `Now using ${info.name}`)
    } else {
      toast.info('Model changed', modelId)
    }
  }

  /**
   * Re-run a tool call the model wrote in prose (i.e. the synthetic "missed
   * tool call" row). The user clicks "Run this search now" on the row and
   * we actually invoke the tool against the configured providers. The
   * result is dropped into `toolOverrides` keyed by the missed row's
   * `pseudoId`, so the existing `ToolCallRow` re-renders from amber-missed
   * to a regular Claude-style result panel.
   *
   * Abort support: a new AbortController is created for each rerun, so
   * starting a fresh rerun (or starting a new chat stream) cancels the
   * previous one.
   */
  const handleRerunMissedToolCall = useCallback(async (pseudoId: string, name: string, args: any, assistantMsgId?: string) => {
    // Cancel any in-flight rerun
    rerunAbortRef.current?.abort()
    const ac = new AbortController()
    rerunAbortRef.current = ac
    // 1. Flip the row to "pending" so the user sees the spinning indicator
    setToolOverrides((prev) => ({ ...prev, [pseudoId]: { name, args, status: 'pending' } }))
    // Also update the stored tool call (if we have a message id) so the
    // pending state survives a page reload
    if (assistantMsgId) {
      try {
        const fresh = await db.messages.get(assistantMsgId)
        if (fresh?.toolCalls) {
          const calls = fresh.toolCalls.map((tc: any) =>
            tc.toolCallId === pseudoId ? { ...tc, status: 'pending' as const, result: undefined } : tc
          )
          await db.messages.update(assistantMsgId, { toolCalls: calls })
        }
      } catch { /* best-effort */ }
    }
    // 2. Run the tool
    let outcome: Awaited<ReturnType<typeof rerunMissedToolCall>>
    try {
      outcome = await rerunMissedToolCall({ name, args, signal: ac.signal })
    } catch (e: any) {
      // Aborted or unexpected throw — record the error on the row
      const errMsg = e?.name === 'AbortError' ? 'Cancelled' : e?.message || String(e)
      setToolOverrides((prev) => ({ ...prev, [pseudoId]: { name, args, status: 'error', result: { error: errMsg } } }))
      if (assistantMsgId) {
        try {
          const fresh = await db.messages.get(assistantMsgId)
          if (fresh?.toolCalls) {
            const calls = fresh.toolCalls.map((tc: any) =>
              tc.toolCallId === pseudoId ? { ...tc, status: 'error' as const, result: { error: errMsg } } : tc
            )
            await db.messages.update(assistantMsgId, { toolCalls: calls })
          }
        } catch { /* best-effort */ }
      }
      return
    }
    // 3. Drop the result into the override. Crucially, the new result does
    // NOT have `missed: true`, so `isMissed` in `ToolCallRow` becomes false
    // and the body renders the Claude-style result component instead of the
    // amber missed-call box.
    setToolOverrides((prev) => ({ ...prev, [pseudoId]: { name: outcome.name, args, status: outcome.status, result: outcome.result } }))
    if (assistantMsgId) {
      try {
        const fresh = await db.messages.get(assistantMsgId)
        if (fresh?.toolCalls) {
          const calls = fresh.toolCalls.map((tc: any) =>
            tc.toolCallId === pseudoId
              ? { ...tc, name: outcome.name, status: outcome.status, result: outcome.result, args }
              : tc
          )
          await db.messages.update(assistantMsgId, { toolCalls: calls })
        }
      } catch { /* best-effort */ }
    }
    // 4. Toast the outcome
    if (outcome.status === 'ok') {
      const okResult = outcome.result as any
      if (name === 'web_search') {
        toast.info('Search complete', `${okResult.count ?? 0} result${okResult.count === 1 ? '' : 's'} from ${okResult.source}`)
      } else if (name === 'fetch_url') {
        toast.info('Page read', `${(okResult.byteLength / 1000).toFixed(1)}k chars`)
      } else if (name === 'search_artifacts') {
        toast.info('Library search', `${okResult.fullHits?.length ?? okResult.hits?.length ?? 0} match${(okResult.fullHits?.length ?? okResult.hits?.length ?? 0) === 1 ? '' : 'es'}`)
      } else if (name === 'fetch_artifact') {
        toast.info('Artifact read', okResult.title || okResult.id)
      }
    } else {
      const errMsg = (outcome.result as any)?.error || 'Tool failed'
      toast.error('Rerun failed', errMsg)
    }
  }, [toast])

  if (!settings) return null
  const activeProviderId = (settings.defaultProvider as ProviderId) || 'browser-ai'

  return (
    <div className="flex h-full flex-col">
      <ChatHeader
        agent={AGENTS[activeAgent]}
        providerId={activeProviderId}
        model={settings.defaultModel || ''}
        onModelChange={handleModelChange}
        isStreaming={isStreaming}
      />

      <MessageList
        messages={messages}
        streamingMsgId={streamingMsgId}
        streamingText={jitter.state.text}
        streamingReasoning={streamingReasoning}
        streaming={isStreaming}
        stepOverrides={stepOverrides}
        toolOverrides={toolOverrides}
        verbList={settings.verbLists[activeAgent] ?? AGENTS.cofounder.verbs}
        activeAgent={activeAgent}
        endRef={messagesEndRef}
        onRerunMissedToolCall={handleRerunMissedToolCall}
      />

      <ChatComposer
        onSend={handleSend}
        onStop={handleStop}
        disabled={isStreaming}
        placeholder={messages.length === 0 ? placeholderFor(activeAgent) : 'Reply…'}
        activeAgent={activeAgent}
      />
    </div>
  )
}

function placeholderFor(_role: AgentRole): string {
  return "What's on your mind? Tell me about your idea or what you're stuck on."
}

const extractionQueue = new Map<string, ReturnType<typeof setTimeout>>()
function scheduleMemoryExtraction(
  conversationId: string,
  settings: any,
  _agent: AgentRole
) {
  const existing = extractionQueue.get(conversationId)
  if (existing) clearTimeout(existing)
  const t = setTimeout(async () => {
    extractionQueue.delete(conversationId)
    const provider = (settings?.defaultProvider as ProviderId) || 'browser-ai'
    if (provider === 'browser-ai') return
    const model = settings?.defaultModel || ''
    const recent = await db.messages
      .where('conversationId')
      .equals(conversationId)
      .sortBy('createdAt')
    const last10 = recent.slice(-10)
    const extraction = await extractMemory(
      provider,
      model,
      last10.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))
    )
    if (extraction && Object.keys(extraction).filter((k) => k !== 'reasoning').length > 0) {
      await db.memoryEvents.put({
        id: nanoid(12),
        ts: Date.now(),
        trigger: 'extraction',
        field: 'all',
        after: extraction,
        confirmed: false,
      })
    }
    // Also run the archival extraction (auto-saved, no approval needed)
    await extractArchivalMemories(
      provider,
      model,
      last10.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      conversationId
    )
  }, 2500)
  extractionQueue.set(conversationId, t)
}

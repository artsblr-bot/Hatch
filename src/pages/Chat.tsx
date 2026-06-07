import { useEffect, useRef, useState, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { nanoid } from 'nanoid'
import {
  db,
  type AgentRole,
  type Message,
  type Conversation,
} from '@/lib/db'
import { AGENTS } from '@/lib/agents'
import { runChat, extractMemory } from '@/lib/chat'
import { isUnlocked } from '@/lib/crypto'
import { type ProviderId, getModelInfo } from '@/lib/providers'
import { useToast } from '@/components/Toast'
import { ChatHeader } from '@/components/ChatHeader'
import { MessageList } from '@/components/MessageList'
import { ChatComposer } from '@/components/ChatComposer'
import { useJitterBuffer } from '@/hooks/useJitterBuffer'

export function ChatPage() {
  const { conversationId: paramId } = useParams<{ conversationId: string }>()
  const navigate = useNavigate()
  const toast = useToast()
  const settings = useLiveQuery(() => db.settings.get('singleton'), [])

  const [conversationId, setConversationId] = useState<string | null>(paramId || null)
  const [activeAgent, setActiveAgent] = useState<AgentRole>('mentor')
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamingMsgId, setStreamingMsgId] = useState<string | null>(null)
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
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const jitter = useJitterBuffer({ charsPerSecond: 90, tickMs: 32, immediate: true })

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

  // Sync active agent with conversation
  useEffect(() => {
    if (conversation?.agentRole) {
      setActiveAgent(conversation.agentRole)
    }
  }, [conversation?.agentRole])

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages.length, jitter.state.text, isStreaming])

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
            verbList: settings.verbLists[activeAgent],
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

  const handleStop = () => {
    abortRef.current?.abort()
  }

  const handleAgentSwitch = async (role: AgentRole) => {
    setActiveAgent(role)
    if (conversationId) {
      await db.conversations.update(conversationId, { agentRole: role })
    }
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

  if (!settings) return null
  const activeProviderId = (settings.defaultProvider as ProviderId) || 'browser-ai'

  return (
    <div className="flex h-full flex-col">
      <ChatHeader
        agent={AGENTS[activeAgent]}
        providerId={activeProviderId}
        model={settings.defaultModel || ''}
        onAgentSwitch={handleAgentSwitch}
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
        verbList={settings.verbLists[activeAgent]}
        activeAgent={activeAgent}
        endRef={messagesEndRef}
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

function placeholderFor(role: AgentRole): string {
  switch (role) {
    case 'mentor':
      return 'Tell me about your idea, and what stage you\'re at.'
    case 'cto':
      return 'What are you trying to build? I\'ll suggest the simplest stack.'
    case 'cmo':
      return 'Who are you trying to reach, and what\'s your story so far?'
    case 'cfo':
      return 'What\'s your pricing today, and what\'s worrying you about the numbers?'
  }
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
      .reverse()
      .sortBy('createdAt')
    const last10 = recent.slice(-10).reverse()
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
  }, 2500)
  extractionQueue.set(conversationId, t)
}

import { useEffect, useRef, useState, useCallback, KeyboardEvent } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Send, Square, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { AgentRole } from '@/lib/db'

interface Props {
  onSend: (text: string) => void
  onStop: () => void
  disabled?: boolean
  placeholder?: string
  activeAgent?: AgentRole
}

const FOLLOW_UP_POOL = [
  'Go deeper on this',
  'Give me a concrete example',
  "What's the biggest risk here?",
  'How do I start today?',
  'Make this simpler',
  "What am I missing?",
  'Challenge my assumption',
  'What would you prioritize first?',
  'Turn this into action steps',
  "What's the fastest way to test this?",
  'Break this into 3 next steps',
  "What would a skeptic say?",
]

const SUGGESTIONS: { agent: string; prompts: string[] }[] = [
  {
    agent: 'cofounder',
    prompts: [
      "I'm not sure what to focus on this week. Help me prioritise.",
      "What's the fastest way to validate this idea without building anything?",
      "Write me a one-liner for my landing page.",
      "Should I use a no-code tool or hire a developer for this?",
      "Should I charge per month or per use?",
      "Where should I focus to find my first 100 customers?",
    ],
  },
]

export function ChatComposer({ onSend, onStop, disabled, placeholder = 'Reply…', activeAgent = 'cofounder' }: Props) {
  const [text, setText] = useState('')
  const [focused, setFocused] = useState(false)
  const [chips, setChips] = useState<string[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const lastSubmitRef = useRef(0)
  const wasDisabledRef = useRef(false)

  // Auto-resize
  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 240) + 'px'
  }, [text])

  // Show follow-up chips when a response finishes (disabled flips true → false)
  useEffect(() => {
    if (wasDisabledRef.current && !disabled) {
      const shuffled = [...FOLLOW_UP_POOL].sort(() => Math.random() - 0.5)
      setChips(shuffled.slice(0, 3))
      const t = setTimeout(() => setChips([]), 30000)
      return () => clearTimeout(t)
    }
    wasDisabledRef.current = !!disabled
  }, [disabled])

  // Clear chips when user starts typing
  useEffect(() => {
    if (text.length > 0) setChips([])
  }, [text])

  const submit = useCallback(() => {
    const t = text.trim()
    if (!t || disabled) return
    // Debounce
    const now = Date.now()
    if (now - lastSubmitRef.current < 250) return
    lastSubmitRef.current = now
    onSend(t)
    setText('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
  }, [text, disabled, onSend])

  const handleKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <div className="flex-shrink-0 border-t border-border-subtle bg-bg/80 px-5 py-4 backdrop-blur">
      <div className="mx-auto max-w-3xl">
        <div
          className={cn(
            'group relative overflow-hidden rounded-3xl border bg-bg-subtle/60 transition-all',
            focused
              ? 'border-fg/20 shadow-soft ring-2 ring-accent/20'
              : 'border-border hover:border-fg/10'
          )}
        >
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKey}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={placeholder}
            rows={1}
            disabled={disabled}
            className="block w-full resize-none border-0 bg-transparent px-4 pb-12 pt-4 text-[15px] leading-relaxed text-fg placeholder:text-fg-subtle focus:outline-none focus:ring-0 disabled:opacity-50"
            style={{ maxHeight: 240 }}
          />

          {/* Bottom toolbar */}
          <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between gap-2 px-3 py-2">
            <div className="flex items-center gap-1 text-[11px] text-fg-subtle">
              <Sparkles className="h-3 w-3" />
              <span className="hidden sm:inline">Enter to send · Shift+Enter for new line</span>
            </div>
            <div className="flex items-center gap-1.5">
              {disabled ? (
                <button
                  onClick={onStop}
                  className="group/stop inline-flex items-center gap-1.5 rounded-full bg-fg px-3 py-1.5 text-xs font-medium text-bg transition hover:bg-fg/90 focus-ring"
                >
                  <Square className="h-3 w-3 fill-current" />
                  <span>Stop</span>
                </button>
              ) : (
                <motion.button
                  onClick={submit}
                  disabled={!text.trim()}
                  whileTap={text.trim() ? { scale: 0.9 } : {}}
                  transition={{ type: 'spring', stiffness: 500, damping: 20 }}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition focus-ring',
                    text.trim()
                      ? 'bg-accent text-accent-fg hover:shadow-glow'
                      : 'bg-bg-muted text-fg-subtle'
                  )}
                >
                  <Send className="h-3 w-3" />
                  <span>Send</span>
                </motion.button>
              )}
            </div>
          </div>
        </div>

        {/* Follow-up chips (post-response) or starter suggestions (idle) */}
        {text.length === 0 && !disabled && (
          <div className="mt-3">
            <AnimatePresence mode="wait">
              {chips.length > 0 ? (
                <motion.div
                  key="chips"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0, transition: { duration: 0.12 } }}
                  className="flex flex-wrap gap-1.5"
                >
                  {chips.map((chip, i) => (
                    <motion.button
                      key={chip}
                      initial={{ opacity: 0, y: 7 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.08, duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                      whileTap={{ scale: 0.95 }}
                      onClick={() => { setText(chip); setChips([]) }}
                      className="inline-flex items-center gap-1 rounded-full border border-accent/25 bg-accent/[0.08] px-3 py-1 text-xs font-medium text-accent transition hover:bg-accent/[0.15] hover:border-accent/40"
                    >
                      {chip} →
                    </motion.button>
                  ))}
                </motion.div>
              ) : (
                <motion.div
                  key="suggestions"
                  initial={false}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0, transition: { duration: 0.1 } }}
                  className="flex flex-wrap gap-1.5"
                >
                  {(SUGGESTIONS.find((s) => s.agent === activeAgent)?.prompts.slice(0, 2) ?? []).map((p, i) => (
                    <button
                      key={i}
                      onClick={() => setText(p)}
                      className="inline-flex items-center gap-1.5 rounded-full border border-border bg-bg-subtle/40 px-3 py-1 text-xs text-fg-muted transition hover:border-border hover:bg-bg-muted hover:text-fg"
                    >
                      {p}
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  )
}

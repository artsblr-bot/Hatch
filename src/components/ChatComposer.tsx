import { useEffect, useRef, useState, useCallback, KeyboardEvent } from 'react'
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

const SUGGESTIONS: { agent: string; prompts: string[] }[] = [
  {
    agent: 'mentor',
    prompts: [
      "I'm not sure what to focus on this week. Help me figure it out.",
      "I keep getting stuck on this one thing. Can we talk it through?",
      "How do I know if I'm building the right thing?",
    ],
  },
  {
    agent: 'cto',
    prompts: [
      "I want to build a landing page this weekend. What's the fastest stack?",
      "Should I use a no-code tool or hire a developer for this?",
      "How do I add a payments system without writing code?",
    ],
  },
  {
    agent: 'cmo',
    prompts: [
      "Write me a one-liner for my landing page.",
      "Where should I focus to find my first 100 customers?",
      "Help me write a launch post for Twitter.",
    ],
  },
  {
    agent: 'cfo',
    prompts: [
      "Should I charge per month or per use?",
      "How do I know if my CAC is too high?",
      "Walk me through a basic financial model for my business.",
    ],
  },
]

export function ChatComposer({ onSend, onStop, disabled, placeholder = 'Reply…', activeAgent = 'mentor' }: Props) {
  const [text, setText] = useState('')
  const [focused, setFocused] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const lastSubmitRef = useRef(0)

  // Auto-resize
  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 240) + 'px'
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
                <button
                  onClick={submit}
                  disabled={!text.trim()}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition focus-ring',
                    text.trim()
                      ? 'bg-accent text-accent-fg hover:shadow-glow'
                      : 'bg-bg-muted text-fg-subtle'
                  )}
                >
                  <Send className="h-3 w-3" />
                  <span>Send</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Suggestions — shown for the currently active agent */}
        {text.length === 0 && !disabled && (() => {
          const prompts = SUGGESTIONS.find((s) => s.agent === activeAgent)?.prompts.slice(0, 2) ?? []
          if (prompts.length === 0) return null
          return (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {prompts.map((p, i) => (
                <button
                  key={i}
                  onClick={() => setText(p)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-bg-subtle/40 px-3 py-1 text-xs text-fg-muted transition hover:border-border hover:bg-bg-muted hover:text-fg"
                >
                  {p}
                </button>
              ))}
            </div>
          )
        })()}
      </div>
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Search,
  Home,
  MessageSquare,
  MessageSquarePlus,
  Library as LibraryIcon,
  Brain,
  Settings as SettingsIcon,
  Lock,
  SunMoon,
  CalendarCheck,
  Download,
  Cpu,
  FileText,
  CornerDownLeft,
} from 'lucide-react'
import { db } from '@/lib/db'
import { lock } from '@/lib/crypto'
import { getProviderModels } from '@/lib/providers'
import type { ProviderId } from '@/lib/providers'
import { searchArtifacts } from '@/lib/artifactSearch'
import { cn } from '@/lib/utils'
import { prefersReducedMotion, spring } from '@/lib/juice'
import { useToast } from '../Toast'
import { useRitual } from '../ritual/RitualProvider'
import type { Command, CommandGroup } from './commandTypes'

const GROUP_ORDER: CommandGroup[] = ['Navigate', 'Actions', 'Switch model', 'Recent chats', 'Artifacts']

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate()
  const toast = useToast()
  const { openEndWeek } = useRitual()
  const settings = useLiveQuery(() => db.settings.get('singleton'), [])
  const conversations =
    useLiveQuery(() => db.conversations.orderBy('updatedAt').reverse().limit(20).toArray(), []) || []

  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const [artifactCmds, setArtifactCmds] = useState<Command[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const restoreRef = useRef<HTMLElement | null>(null)

  const go = (path: string) => {
    onClose()
    navigate(path)
  }

  // Reset transient state + manage focus / scroll-lock on open.
  useEffect(() => {
    if (!open) return
    setQuery('')
    setSelected(0)
    restoreRef.current = document.activeElement as HTMLElement | null
    const focusId = window.setTimeout(() => inputRef.current?.focus(), 0)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.clearTimeout(focusId)
      document.body.style.overflow = prevOverflow
      restoreRef.current?.focus?.()
    }
  }, [open])

  // Debounced artifact search (reuses the Library BM25 search).
  useEffect(() => {
    if (!open) {
      setArtifactCmds([])
      return
    }
    const q = query.trim()
    if (q.length < 2) {
      setArtifactCmds([])
      return
    }
    let cancelled = false
    const t = window.setTimeout(async () => {
      try {
        const res = await searchArtifacts({ query: q, maxResults: 6 })
        if (cancelled) return
        setArtifactCmds(
          res.hits.map((h) => ({
            id: `artifact-${h.id}`,
            title: h.title || 'Untitled artifact',
            subtitle: h.snippet,
            group: 'Artifacts' as const,
            icon: FileText,
            run: () => go(`/library?open=${h.id}`),
          })),
        )
      } catch {
        if (!cancelled) setArtifactCmds([])
      }
    }, 160)
    return () => {
      cancelled = true
      window.clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, open])

  const q = query.trim().toLowerCase()

  // ---- build commands ------------------------------------------------------
  const staticCommands: Command[] = [
    { id: 'nav-home', title: 'Home', group: 'Navigate', icon: Home, keywords: 'landing dashboard', run: () => go('/') },
    { id: 'nav-chat', title: 'Chat', group: 'Navigate', icon: MessageSquare, run: () => go('/chat') },
    { id: 'nav-library', title: 'Library', group: 'Navigate', icon: LibraryIcon, keywords: 'artifacts documents', run: () => go('/library') },
    { id: 'nav-memory', title: 'Memory', group: 'Navigate', icon: Brain, keywords: 'notes nodes digest', run: () => go('/memory') },
    { id: 'nav-settings', title: 'Settings', group: 'Navigate', icon: SettingsIcon, keywords: 'provider key theme preferences', run: () => go('/settings') },
    { id: 'act-new-chat', title: 'New chat', group: 'Actions', icon: MessageSquarePlus, keywords: 'start conversation', run: () => go('/chat') },
    { id: 'act-end-week', title: 'Start end-of-week check-in', group: 'Actions', icon: CalendarCheck, keywords: 'review friday ritual debrief', run: () => { onClose(); openEndWeek() } },
    { id: 'act-theme', title: 'Toggle light / dark', group: 'Actions', icon: SunMoon, keywords: 'theme appearance mode', run: toggleTheme },
    { id: 'act-export', title: 'Export your data', group: 'Actions', icon: Download, keywords: 'backup json download', run: () => go('/settings#data') },
  ]
  if (settings?.hasSetPassphrase) {
    staticCommands.push({
      id: 'act-lock',
      title: 'Lock vault',
      group: 'Actions',
      icon: Lock,
      keywords: 'logout secure sign out',
      run: () => {
        onClose()
        lock()
        toast.info('Vault locked')
        navigate('/vault')
      },
    })
  }
  if (settings?.defaultProvider) {
    for (const m of getProviderModels(settings.defaultProvider as ProviderId)) {
      const active = m.id === settings.defaultModel
      staticCommands.push({
        id: `model-${m.id}`,
        title: m.name,
        subtitle: active ? 'Current model' : undefined,
        group: 'Switch model',
        icon: Cpu,
        keywords: `${m.id} ${m.tags?.join(' ') ?? ''}`,
        run: async () => {
          onClose()
          await db.settings.update('singleton', { defaultModel: m.id })
          toast.success(`Model set to ${m.name}`)
        },
      })
    }
  }

  function toggleTheme() {
    onClose()
    const isDark = document.documentElement.classList.contains('dark')
    db.settings.update('singleton', { theme: isDark ? 'light' : 'dark' })
  }

  const chatCmds: Command[] = conversations.map((c) => ({
    id: `chat-${c.id}`,
    title: c.title || 'Untitled',
    group: 'Recent chats',
    icon: MessageSquare,
    run: () => go(`/chat/${c.id}`),
  }))

  const matches = (c: Command) => {
    if (!q) return true
    return `${c.title} ${c.subtitle ?? ''} ${c.keywords ?? ''} ${c.group}`.toLowerCase().includes(q)
  }

  const filteredStatic = staticCommands.filter((c) => {
    if (c.group === 'Switch model' && !q) return false // keep the empty state calm
    return matches(c)
  })
  const filteredChats = chatCmds.filter(matches)
  const all = [...filteredStatic, ...filteredChats, ...artifactCmds]

  const grouped = GROUP_ORDER.map((group) => ({ group, items: all.filter((c) => c.group === group) })).filter(
    (s) => s.items.length > 0,
  )
  const flat = grouped.flatMap((s) => s.items)

  // Keep the selection in range + scrolled into view.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-cmd-index="${selected}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelected((s) => Math.min(s + 1, flat.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelected((s) => Math.max(s - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      flat[selected]?.run()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  const reduce = prefersReducedMotion()
  let runningIndex = -1

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[60] flex items-start justify-center p-4 pt-[12vh]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.14 }}
        >
          <div className="absolute inset-0 bg-bg/70 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
            initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.97, y: -8 }}
            animate={reduce ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.98, y: -8 }}
            transition={spring.pop}
            onKeyDown={onKeyDown}
            className="relative z-10 flex max-h-[70vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-border bg-bg-subtle shadow-soft"
          >
            <div className="flex items-center gap-3 border-b border-border px-4">
              <Search className="h-4 w-4 shrink-0 text-fg-subtle" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search commands, chats, artifacts…"
                aria-label="Command palette search"
                role="combobox"
                aria-expanded="true"
                aria-controls="command-list"
                className="h-12 w-full bg-transparent text-sm text-fg placeholder:text-fg-subtle focus:outline-none"
              />
            </div>

            <div ref={listRef} id="command-list" role="listbox" className="flex-1 overflow-y-auto py-2">
              {flat.length === 0 ? (
                <div className="px-4 py-10 text-center text-sm text-fg-subtle">No matches for “{query}”</div>
              ) : (
                grouped.map((section) => (
                  <div key={section.group} className="mb-1 last:mb-0">
                    <div className="px-4 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-fg-subtle">
                      {section.group}
                    </div>
                    {section.items.map((cmd) => {
                      runningIndex += 1
                      const index = runningIndex
                      const isSel = index === selected
                      const Icon = cmd.icon
                      return (
                        <button
                          key={cmd.id}
                          type="button"
                          role="option"
                          aria-selected={isSel}
                          data-cmd-index={index}
                          onMouseMove={() => setSelected(index)}
                          onClick={() => cmd.run()}
                          className={cn(
                            'flex w-full items-center gap-3 px-4 py-2 text-left text-sm transition-colors',
                            isSel ? 'bg-bg-muted text-fg' : 'text-fg-muted hover:bg-bg-muted/50',
                          )}
                        >
                          {Icon && <Icon className={cn('h-4 w-4 shrink-0', isSel ? 'text-accent' : 'text-fg-subtle')} />}
                          <span className="flex-1 truncate">{cmd.title}</span>
                          {cmd.subtitle && <span className="truncate text-xs text-fg-subtle">{cmd.subtitle}</span>}
                          {cmd.shortcut && (
                            <kbd className="rounded border border-border bg-bg px-1.5 py-0.5 font-mono text-[10px] text-fg-subtle">
                              {cmd.shortcut}
                            </kbd>
                          )}
                        </button>
                      )
                    })}
                  </div>
                ))
              )}
            </div>

            <div className="flex items-center gap-3 border-t border-border px-4 py-2 text-[11px] text-fg-subtle">
              <span className="flex items-center gap-1">
                <CornerDownLeft className="h-3 w-3" /> open
              </span>
              <span>↑↓ navigate</span>
              <span>esc close</span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

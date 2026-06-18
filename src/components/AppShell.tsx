import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom'
import { MessageSquare, Library, Brain, Settings, Plus, Lock, Menu, X, Pencil, Check, X as XIcon } from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useRef, useEffect, useState } from 'react'
import { db, ensureSettings, type Conversation } from '@/lib/db'
import { isUnlocked, lock } from '@/lib/crypto'
import { cn } from '@/lib/utils'
import { useToast } from './Toast'
import { HatchWordmark } from './HatchWordmark'

export function AppShell() {
  const navigate = useNavigate()
  const location = useLocation()
  const settings = useLiveQuery(() => db.settings.get('singleton'), [])
  const conversations = useLiveQuery(
    () => db.conversations.orderBy('updatedAt').reverse().limit(20).toArray(),
    []
  ) || []
  const company = useLiveQuery(() => db.company.get('singleton'), [])
  const [unlocked, setUnlockedState] = useState(isUnlocked())
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const toast = useToast()

  // Re-check unlock status on route change
  useEffect(() => {
    setUnlockedState(isUnlocked())
  }, [location.pathname])

  // Close sidebar on route change on mobile
  useEffect(() => {
    setSidebarOpen(false)
  }, [location.pathname])

  // Cmd/Ctrl+K for new chat
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        navigate('/chat')
      }
      if (e.key === 'Escape' && sidebarOpen) setSidebarOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate, sidebarOpen])

  const handleLock = () => {
    lock()
    setUnlockedState(false)
    toast.info('Vault locked')
    navigate('/vault')
  }

  const handleNewChat = async () => {
    await ensureSettings()
    navigate('/chat')
  }

  const handleRename = async (id: string, title: string) => {
    const trimmed = title.trim()
    if (!trimmed) return
    await db.conversations.update(id, { title: trimmed, updatedAt: Date.now() })
  }

  return (
    <div className="grid h-screen bg-bg text-fg md:grid-cols-[260px_1fr]">
      {/* Mobile top bar */}
      <div className="absolute right-3 top-3 z-30 md:hidden">
        <button
          onClick={() => setSidebarOpen((o) => !o)}
          className="grid h-9 w-9 place-items-center rounded-xl border border-border bg-bg-muted/80 text-fg-muted backdrop-blur transition hover:bg-bg-muted focus-ring"
          aria-label="Toggle menu"
        >
          {sidebarOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
        </button>
      </div>

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-20 flex w-72 flex-col border-r border-border bg-bg-subtle transition-transform duration-200 md:static md:translate-x-0',
          sidebarOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full'
        )}
      >
        {/* Brand */}
        <div className="relative flex h-16 items-center gap-3 border-b border-border-subtle px-5">
          <div className="animate-breathe">
            <HatchWordmark size={28} />
          </div>
          <div className="flex-1" />
          <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-fg-subtle">
            AI cofounder
          </span>
          <div className="pointer-events-none absolute -bottom-px left-5 right-5 h-px bg-gradient-to-r from-transparent via-accent/30 to-transparent" />
        </div>

        {/* Primary nav */}
        <nav className="flex flex-col gap-0.5 px-3 pt-4">
          <SidebarLink to="/chat" icon={MessageSquare} label="Chat" active={location.pathname.startsWith('/chat')} />
          <SidebarLink to="/library" icon={Library} label="Library" active={location.pathname === '/library'} />
          <SidebarLink to="/memory" icon={Brain} label="Memory" active={location.pathname === '/memory'} />
        </nav>

        {/* New chat CTA */}
        <div className="px-3 pt-4">
          <button
            onClick={handleNewChat}
            className="group relative inline-flex w-full items-center gap-2 overflow-hidden rounded-xl bg-accent px-3.5 py-2.5 text-sm font-semibold text-accent-fg transition hover:shadow-soft focus-ring"
          >
            <span className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/15 to-transparent transition group-hover:translate-x-full" />
            <Plus className="h-4 w-4" />
            <span>New chat</span>
            <kbd className="ml-auto rounded-md border border-accent-fg/25 bg-accent-fg/10 px-1.5 py-0.5 font-mono text-[10px] tracking-tight">⌘K</kbd>
          </button>
        </div>

        {/* Conversations list */}
        <div className="mt-6 flex flex-1 flex-col overflow-hidden">
          <div className="flex items-center px-5 pb-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-fg-subtle">Recent</span>
          </div>
          <div className="flex-1 overflow-y-auto px-3 pb-3">
            {conversations.length === 0 ? (
              <div className="px-3 py-8 text-center text-xs text-fg-subtle">
                No conversations yet
              </div>
            ) : (
              <div className="flex flex-col gap-0.5">
                {conversations.map((c, i) => {
                  const isActive = location.pathname === `/chat/${c.id}`
                  return (
                    <ConversationRow
                      key={c.id}
                      conv={c}
                      index={i}
                      isActive={isActive}
                      onRename={(title) => handleRename(c.id, title)}
                    />
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* Business card */}
        {company?.name && (
          <div className="mx-3 mb-1 rounded-2xl border border-border-subtle bg-bg-muted p-3.5 text-[11px]">
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-fg-subtle">Venture</div>
            <div className="mt-1.5 truncate font-serif text-base font-medium tracking-tight text-fg">{company.name}</div>
            {company.oneLiner && (
              <div className="mt-1 line-clamp-2 leading-relaxed text-fg-muted">{company.oneLiner}</div>
            )}
          </div>
        )}

        {/* Bottom actions */}
        <div className="border-t border-border-subtle px-3 py-3">
          <SidebarLink to="/settings" icon={Settings} label="Settings" active={location.pathname === '/settings'} />
          {settings?.hasSetPassphrase && unlocked && (
            <button
              onClick={handleLock}
              className="mt-0.5 flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-xs text-fg-muted transition hover:bg-bg-muted hover:text-fg"
            >
              <Lock className="h-3.5 w-3.5" />
              <span>Lock vault</span>
            </button>
          )}
        </div>
      </aside>

      {/* Mobile backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-10 bg-black/40 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Main. Dual-surface: the Chat route is always the warm-dark
          "workspace" (scoped `.dark` + opaque bg), even when the rest of the
          app is in cream mode — the cream-shell ↔ dark-workspace pacing. Other
          routes stay transparent so the ambient aurora reads through. */}
      <main
        className={cn(
          'relative flex h-full min-w-0 flex-col overflow-hidden',
          location.pathname.startsWith('/chat') && 'dark bg-bg'
        )}
      >
        <Outlet />
      </main>
    </div>
  )
}

function SidebarLink({ to, icon: Icon, label, active }: { to: string; icon: any; label: string; active: boolean }) {
  return (
    <NavLink
      to={to}
      className={cn(
        'flex items-center gap-2.5 rounded-xl border border-transparent px-3 py-2 text-sm transition focus-ring',
        active
          ? 'border-accent/30 bg-accent/[0.06] text-fg'
          : 'text-fg-muted hover:bg-bg-muted/60 hover:text-fg'
      )}
    >
      <Icon className={cn('h-4 w-4', active ? 'text-accent' : 'text-fg-subtle')} />
      <span>{label}</span>
    </NavLink>
  )
}

function ConversationRow({
  conv,
  index,
  isActive,
  onRename,
}: {
  conv: Conversation
  index: number
  isActive: boolean
  onRename: (title: string) => void | Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(conv.title)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) {
      setDraft(conv.title)
      requestAnimationFrame(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      })
    }
  }, [editing, conv.title])

  const commit = async () => {
    const next = draft.trim()
    setEditing(false)
    if (next && next !== conv.title) {
      await onRename(next)
    }
  }

  const cancel = () => {
    setDraft(conv.title)
    setEditing(false)
  }

  if (editing) {
    return (
      <div
        className="flex items-center gap-1.5 rounded-xl bg-accent/[0.06] px-2.5 py-1.5 text-xs"
        style={{ animationDelay: `${Math.min(index * 30, 240)}ms` }}
      >
        <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-accent" />
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commit()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              cancel()
            }
          }}
          onBlur={commit}
          maxLength={120}
          className="min-w-0 flex-1 rounded-lg border border-accent/40 bg-bg px-2 py-0.5 text-xs text-fg focus:outline-none focus:ring-1 focus:ring-accent/40"
        />
        <button
          onMouseDown={(e) => {
            e.preventDefault()
            commit()
          }}
          className="grid h-5 w-5 flex-shrink-0 place-items-center rounded-md text-success hover:bg-success/10"
          title="Save (Enter)"
        >
          <Check className="h-3 w-3" />
        </button>
        <button
          onMouseDown={(e) => {
            e.preventDefault()
            cancel()
          }}
          className="grid h-5 w-5 flex-shrink-0 place-items-center rounded-md text-fg-subtle hover:bg-bg-muted hover:text-fg"
          title="Cancel (Esc)"
        >
          <XIcon className="h-3 w-3" />
        </button>
      </div>
    )
  }

  return (
    <NavLink
      to={`/chat/${conv.id}`}
      onDoubleClick={(e) => {
        e.preventDefault()
        setEditing(true)
      }}
      style={{ animationDelay: `${Math.min(index * 30, 240)}ms` }}
      className={cn(
        'group flex animate-fade-in items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] text-fg-muted transition hover:bg-bg-muted hover:text-fg',
        isActive && 'border border-accent/30 bg-accent/[0.06] text-fg'
      )}
      title={`${conv.title || 'Untitled'} — double-click to rename`}
    >
      <span
        className={cn(
          'h-1.5 w-1.5 flex-shrink-0 rounded-full bg-current transition',
          isActive ? 'opacity-100 animate-breathe bg-accent text-accent' : 'opacity-50'
        )}
      />
      <span className="flex-1 truncate">{conv.title || 'Untitled'}</span>
      <button
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setEditing(true)
        }}
        className="grid h-5 w-5 flex-shrink-0 place-items-center rounded-md text-fg-subtle opacity-0 transition hover:bg-bg-muted hover:text-fg group-hover:opacity-100 focus:opacity-100"
        title="Rename"
        aria-label="Rename conversation"
      >
        <Pencil className="h-3 w-3" />
      </button>
    </NavLink>
  )
}

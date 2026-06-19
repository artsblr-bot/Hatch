import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom'
import { MessageSquare, Library, Brain, Settings, Lock, Command as CommandIcon, Plus } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { db, ensureSettings } from '@/lib/db'
import { isUnlocked, lock } from '@/lib/crypto'
import { cn } from '@/lib/utils'
import { useToast } from './Toast'
import { HatchMark } from './HatchMark'
import { MomentumHorizon } from './MomentumHorizon'
import { useCommandPalette } from './command/CommandProvider'

interface NavItem {
  to: string
  icon: LucideIcon
  label: string
  match: (path: string) => boolean
}

const NAV: NavItem[] = [
  { to: '/chat', icon: MessageSquare, label: 'Chat', match: (p) => p.startsWith('/chat') },
  { to: '/library', icon: Library, label: 'Library', match: (p) => p === '/library' },
  { to: '/memory', icon: Brain, label: 'Memory', match: (p) => p === '/memory' },
]

export function AppShell() {
  const navigate = useNavigate()
  const location = useLocation()
  const settings = useLiveQuery(() => db.settings.get('singleton'), [])
  const [unlocked, setUnlockedState] = useState(isUnlocked())
  const toast = useToast()
  const { openPalette } = useCommandPalette()

  // Re-check unlock status on route change (mirrors the old shell behavior).
  useEffect(() => {
    setUnlockedState(isUnlocked())
  }, [location.pathname])

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

  const showLock = settings?.hasSetPassphrase && unlocked
  const path = location.pathname

  return (
    <div className="flex h-screen overflow-hidden bg-bg text-fg">
      {/* Desktop rail */}
      <aside className="hidden w-16 shrink-0 flex-col items-center border-r border-border bg-bg-subtle py-4 md:flex">
        <NavLink to="/" aria-label="Home" className="mb-2 grid h-10 w-10 place-items-center rounded-xl focus-ring">
          <HatchMark size={26} />
        </NavLink>

        <button
          onClick={handleNewChat}
          aria-label="New chat"
          title="New chat"
          className="mb-3 grid h-10 w-10 place-items-center rounded-xl bg-sunrise text-[#171420] shadow-glow transition active:scale-95 focus-ring"
        >
          <Plus className="h-5 w-5" />
        </button>

        <nav className="flex flex-col items-center gap-1">
          {NAV.map((item) => (
            <RailLink key={item.to} item={item} active={item.match(path)} />
          ))}
        </nav>

        <button
          onClick={openPalette}
          aria-label="Open command palette"
          title="Command palette (⌘K)"
          className="mt-1 grid h-10 w-10 place-items-center rounded-xl text-fg-subtle transition-colors hover:bg-bg-muted/60 hover:text-fg focus-ring"
        >
          <CommandIcon className="h-5 w-5" />
        </button>

        <div className="flex-1" />

        <nav className="flex flex-col items-center gap-1">
          <RailLink
            item={{ to: '/settings', icon: Settings, label: 'Settings', match: (p) => p === '/settings' }}
            active={path === '/settings'}
          />
          {showLock && (
            <button
              onClick={handleLock}
              aria-label="Lock vault"
              title="Lock vault"
              className="grid h-10 w-10 place-items-center rounded-xl text-fg-subtle transition-colors hover:bg-bg-muted/60 hover:text-fg focus-ring"
            >
              <Lock className="h-5 w-5" />
            </button>
          )}
        </nav>
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar (nav lives here + in the palette) */}
        <div className="flex h-12 shrink-0 items-center gap-1 border-b border-border bg-bg-subtle/95 px-2 backdrop-blur md:hidden">
          <NavLink to="/" aria-label="Home" className="grid h-9 w-9 place-items-center rounded-lg focus-ring">
            <HatchMark size={22} />
          </NavLink>
          <div className="flex-1" />
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              aria-label={item.label}
              className={cn(
                'grid h-9 w-9 place-items-center rounded-lg transition-colors focus-ring',
                item.match(path) ? 'bg-bg-muted text-fg' : 'text-fg-subtle hover:text-fg',
              )}
            >
              <item.icon className="h-[18px] w-[18px]" />
            </NavLink>
          ))}
          <button
            onClick={openPalette}
            aria-label="Open command palette"
            className="grid h-9 w-9 place-items-center rounded-lg text-fg-subtle transition-colors hover:text-fg focus-ring"
          >
            <CommandIcon className="h-[18px] w-[18px]" />
          </button>
        </div>

        <main className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
          {path.startsWith('/chat') && <MomentumHorizon />}
          <Outlet />
        </main>
      </div>
    </div>
  )
}

function RailLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon
  return (
    <NavLink
      to={item.to}
      aria-label={item.label}
      title={item.label}
      className={cn(
        'relative grid h-10 w-10 place-items-center rounded-xl transition-colors focus-ring',
        active ? 'bg-bg-muted text-fg' : 'text-fg-subtle hover:bg-bg-muted/60 hover:text-fg',
      )}
    >
      {active && <span className="absolute left-[-10px] top-1/2 h-5 w-1 -translate-y-1/2 rounded-full bg-accent" />}
      <Icon className="h-5 w-5" />
    </NavLink>
  )
}

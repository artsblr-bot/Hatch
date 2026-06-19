import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { CommandPalette } from './CommandPalette'
import type { CommandContextValue } from './commandTypes'

const CommandContext = createContext<CommandContextValue | null>(null)

export function useCommandPalette(): CommandContextValue {
  const ctx = useContext(CommandContext)
  if (!ctx) throw new Error('useCommandPalette must be used within CommandProvider')
  return ctx
}

/**
 * Owns the single global ⌘K / Ctrl+K listener and the palette open state, and
 * mounts the palette once at the app root. Must sit inside Router + Toast +
 * Celebration + Ritual providers so palette commands can use them.
 */
export function CommandProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const openPalette = useCallback(() => setOpen(true), [])
  const closePalette = useCallback(() => setOpen(false), [])
  const togglePalette = useCallback(() => setOpen((o) => !o), [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <CommandContext.Provider value={{ open, openPalette, closePalette, togglePalette }}>
      {children}
      <CommandPalette open={open} onClose={closePalette} />
    </CommandContext.Provider>
  )
}

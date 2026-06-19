import { createContext, useCallback, useContext, useState } from 'react'
import type { ReactNode } from 'react'
import { EndWeekDialog } from '../EndWeekDialog'

/**
 * RitualProvider lifts the end-of-week check-in dialog to the app root so it can
 * be opened from anywhere — the command palette *and* the CheckInsList button —
 * while keeping EndWeekDialog's `{ open, onClose }` contract and its
 * useCelebrate()/useToast() internals untouched.
 */
interface RitualContextValue {
  openEndWeek: () => void
  closeEndWeek: () => void
}

const RitualContext = createContext<RitualContextValue | null>(null)

export function useRitual(): RitualContextValue {
  const ctx = useContext(RitualContext)
  if (!ctx) throw new Error('useRitual must be used within RitualProvider')
  return ctx
}

export function RitualProvider({ children }: { children: ReactNode }) {
  const [endWeekOpen, setEndWeekOpen] = useState(false)
  const openEndWeek = useCallback(() => setEndWeekOpen(true), [])
  const closeEndWeek = useCallback(() => setEndWeekOpen(false), [])

  return (
    <RitualContext.Provider value={{ openEndWeek, closeEndWeek }}>
      {children}
      <EndWeekDialog open={endWeekOpen} onClose={closeEndWeek} />
    </RitualContext.Provider>
  )
}

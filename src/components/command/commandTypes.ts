import type { LucideIcon } from 'lucide-react'

export type CommandGroup = 'Navigate' | 'Actions' | 'Switch model' | 'Recent chats' | 'Artifacts'

export interface Command {
  id: string
  title: string
  subtitle?: string
  group: CommandGroup
  icon?: LucideIcon
  /** Extra terms folded into the match haystack (ids, tags, synonyms). */
  keywords?: string
  /** Optional right-aligned shortcut hint. */
  shortcut?: string
  run: () => void | Promise<void>
}

export interface CommandContextValue {
  open: boolean
  openPalette: () => void
  closePalette: () => void
  togglePalette: () => void
}

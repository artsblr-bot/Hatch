import { cn } from '@/lib/utils'
import { HatchMark, type HatchMarkVariant } from './HatchMark'

interface Props {
  variant?: HatchMarkVariant
  /** Height of the mark in px. The wordmark scales proportionally. */
  size?: number
  className?: string
  /** Hide the wordmark and only render the mark. */
  markOnly?: boolean
}

/**
 * Full Hatch lockup: orange-tile mark + lowercase "hatch" wordmark in Inter 700 with tight tracking.
 *
 * The wordmark is rendered as real HTML text so it picks up loaded web fonts
 * and Tailwind styling, not the unreliable <text> inside SVG.
 */
export function HatchWordmark({ variant = 'orange', size = 40, className, markOnly = false }: Props) {
  const wordColor = variant === 'orange' ? 'text-fg' : 'text-fg'
  const fontSize = Math.round(size * 0.85)

  return (
    <div
      className={cn('inline-flex items-center gap-[0.45em] leading-none', className)}
      style={{ fontSize: `${fontSize}px` }}
    >
      <HatchMark variant={variant} size={size} />
      {!markOnly && (
        <span
          className={cn(
            'font-sans font-bold tracking-[-0.04em] select-none',
            wordColor
          )}
          style={{ fontSize: `${fontSize}px` }}
        >
          hatch
        </span>
      )}
    </div>
  )
}

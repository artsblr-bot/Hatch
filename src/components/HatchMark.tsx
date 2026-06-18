import { cn } from '@/lib/utils'

export type HatchMarkVariant = 'orange' | 'black'

interface Props {
  variant?: HatchMarkVariant
  size?: number
  className?: string
  title?: string
}

/**
 * The Hatch logomark — a square crossbar H on a 100×100 tile.
 *
 * Editorial palette: Claude coral + warm ink (not cold black).
 * - variant="orange" (default): coral tile + ink H. For dark contexts.
 * - variant="black": ink tile + coral H. For light contexts.
 * (Variant names are kept for API stability; the colors are the brand.)
 *
 * Stems are 15px wide (~15% of tile), crossbar is 15×15px and centered.
 * This matches the brand spec (11/72 ≈ 15.3%).
 */
export function HatchMark({ variant = 'orange', size = 32, className, title }: Props) {
  const coral = '#cc785c'
  const ink = '#141413'
  const tileColor = variant === 'orange' ? coral : ink
  const markColor = variant === 'orange' ? ink : coral

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 100 100"
      width={size}
      height={size}
      role="img"
      aria-label={title || 'Hatch'}
      className={cn('flex-shrink-0', className)}
    >
      {title && <title>{title}</title>}
      <rect width="100" height="100" rx="24" fill={tileColor} />
      <rect x="22" y="22" width="15" height="56" fill={markColor} />
      <rect x="42.5" y="42.5" width="15" height="15" fill={markColor} />
      <rect x="63" y="22" width="15" height="56" fill={markColor} />
    </svg>
  )
}

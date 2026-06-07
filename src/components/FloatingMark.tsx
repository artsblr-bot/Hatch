import { cn } from '@/lib/utils'
import { HatchMark, type HatchMarkVariant } from './HatchMark'

interface Props {
  size?: number
  variant?: HatchMarkVariant
  /** Show the rotating halo ring behind the mark. */
  halo?: boolean
  /** Show the breathing pulse. */
  breathe?: boolean
  /** Show a subtle floating Y motion. */
  float?: boolean
  className?: string
}

/**
 * FloatingMark — the brand mark with grace notes:
 * - optional floating Y motion
 * - optional breathing scale
 * - optional rotating gradient halo behind it
 *
 * Used on boot, welcome, vault, and anywhere we want the brand to feel alive.
 */
export function FloatingMark({
  size = 64,
  variant = 'orange',
  halo = false,
  breathe = false,
  float = false,
  className,
}: Props) {
  return (
    <div
      className={cn('relative inline-flex items-center justify-center', className)}
      style={{ width: size * (halo ? 1.8 : 1), height: size * (halo ? 1.8 : 1) }}
    >
      {halo && (
        <>
          {/* Outer slow rotating conic gradient ring */}
          <span
            className="absolute inset-0 animate-halo"
            aria-hidden
            style={{
              borderRadius: '50%',
              background:
                'conic-gradient(from 0deg, transparent 0%, hsl(21, 100%, 60%) 18%, transparent 36%, transparent 64%, hsl(28, 95%, 60%) 82%, transparent 100%)',
              filter: 'blur(8px)',
              opacity: 0.45,
              mask: 'radial-gradient(closest-side, transparent calc(50% - 4px), black calc(50% - 3px), black calc(50% + 3px), transparent calc(50% + 4px))',
              WebkitMask:
                'radial-gradient(closest-side, transparent calc(50% - 4px), black calc(50% - 3px), black calc(50% + 3px), transparent calc(50% + 4px))',
            }}
          />
          {/* Inner counter-rotating softer ring */}
          <span
            className="absolute inset-[8%] animate-halo-rev"
            aria-hidden
            style={{
              borderRadius: '50%',
              background:
                'conic-gradient(from 90deg, transparent 0%, hsl(21, 100%, 70%) 25%, transparent 50%, transparent 75%, hsl(28, 95%, 70%) 100%)',
              filter: 'blur(4px)',
              opacity: 0.35,
              mask: 'radial-gradient(closest-side, transparent calc(50% - 2px), black calc(50% - 1px), black calc(50% + 1px), transparent calc(50% + 2px))',
              WebkitMask:
                'radial-gradient(closest-side, transparent calc(50% - 2px), black calc(50% - 1px), black calc(50% + 1px), transparent calc(50% + 2px))',
            }}
          />
        </>
      )}

      <div
        className={cn(
          'relative z-10',
          float && 'animate-float',
          breathe && 'animate-breathe'
        )}
        style={{ width: size, height: size }}
      >
        <HatchMark variant={variant} size={size} />
      </div>
    </div>
  )
}

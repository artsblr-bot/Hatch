import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'

/**
 * Slim progress bar with a soft fill that animates in. Used in the
 * TodayPanel week-completion meter and the Friday check-in review.
 */
export function ProgressBar({
  value,
  max = 1,
  label,
  size = 'sm',
  className,
  glow = false,
}: {
  value: number
  max?: number
  label?: string
  size?: 'xs' | 'sm' | 'md'
  className?: string
  /** Pulse + glow as the bar nears 100% — the goal-gradient effect made visible. */
  glow?: boolean
}) {
  const pct = Math.max(0, Math.min(1, max === 0 ? 0 : value / max))
  const heights = {
    xs: 'h-1',
    sm: 'h-1.5',
    md: 'h-2',
  } as const
  const near = glow && pct >= 0.66
  return (
    <div className={cn('w-full', className)}>
      {label && (
        <div className="mb-1 flex items-center justify-between text-[10px] text-fg-muted">
          <span>{label}</span>
          <span className="tabular-nums">{Math.round(pct * 100)}%</span>
        </div>
      )}
      <div
        className={cn(
          'w-full overflow-hidden rounded-full bg-bg-muted',
          heights[size]
        )}
      >
        <motion.div
          className={cn(
            'h-full rounded-full bg-gradient-to-r from-accent to-sun-1',
            near && 'shadow-[0_0_10px_hsl(var(--accent)/0.7)]'
          )}
          initial={{ width: 0 }}
          animate={{
            width: `${pct * 100}%`,
            opacity: near && pct < 1 ? [1, 0.78, 1] : 1,
          }}
          transition={{
            width: { type: 'spring', stiffness: 120, damping: 22 },
            opacity: near && pct < 1 ? { duration: 1.6, repeat: Infinity, ease: 'easeInOut' } : { duration: 0.2 },
          }}
        />
      </div>
    </div>
  )
}

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
}: {
  value: number
  max?: number
  label?: string
  size?: 'xs' | 'sm' | 'md'
  className?: string
}) {
  const pct = Math.max(0, Math.min(1, max === 0 ? 0 : value / max))
  const heights = {
    xs: 'h-1',
    sm: 'h-1.5',
    md: 'h-2',
  } as const
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
          className="h-full rounded-full bg-gradient-to-r from-accent to-orange-400"
          initial={{ width: 0 }}
          animate={{ width: `${pct * 100}%` }}
          transition={{ type: 'spring', stiffness: 120, damping: 22 }}
        />
      </div>
    </div>
  )
}

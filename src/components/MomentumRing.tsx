import { useId } from 'react'
import { motion } from 'framer-motion'
import { prefersReducedMotion, spring } from '@/lib/juice'
import { cn } from '@/lib/utils'

/**
 * MomentumRing — a small completion ring filled with the First Light sunrise
 * gradient. Progress that *feels* earned: the arc springs into place and the
 * ring glows softly as it nears a full week. Reduced-motion shows the final
 * arc without the sweep. Purely celebratory — it only ever shows how far you've
 * come, never scolds for how far is left.
 */
export function MomentumRing({
  value,
  max,
  size = 40,
  strokeWidth = 4,
  showCount = true,
  className,
}: {
  value: number
  max: number
  size?: number
  strokeWidth?: number
  showCount?: boolean
  className?: string
}) {
  const id = useId()
  const safeMax = Math.max(1, max)
  const pct = Math.max(0, Math.min(1, value / safeMax))
  const r = (size - strokeWidth) / 2
  const circ = 2 * Math.PI * r
  const reduce = prefersReducedMotion()
  const complete = max > 0 && pct >= 1

  return (
    <div
      className={cn('relative grid shrink-0 place-items-center', className)}
      style={{ width: size, height: size }}
      role="img"
      aria-label={max > 0 ? `${value} of ${max} done this week` : 'No tasks yet this week'}
    >
      <svg width={size} height={size} className="-rotate-90">
        <defs>
          <linearGradient id={id} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="hsl(var(--sun-1))" />
            <stop offset="55%" stopColor="hsl(var(--sun-2))" />
            <stop offset="100%" stopColor="hsl(var(--sun-3))" />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="hsl(var(--bg-muted))" strokeWidth={strokeWidth} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={`url(#${id})`}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circ}
          initial={reduce ? false : { strokeDashoffset: circ }}
          animate={{ strokeDashoffset: circ * (1 - pct) }}
          transition={reduce ? { duration: 0 } : spring.soft}
          style={complete ? { filter: 'drop-shadow(0 0 4px hsl(var(--sun-1) / 0.6))' } : undefined}
        />
      </svg>
      {complete ? (
        <span className="absolute text-[11px] font-semibold text-sun-1">✓</span>
      ) : showCount && max > 0 ? (
        <span className="absolute text-[10px] font-semibold tabular-nums text-fg">{value}</span>
      ) : null}
    </div>
  )
}

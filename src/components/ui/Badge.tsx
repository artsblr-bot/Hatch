import type { HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

export type BadgeTone = 'neutral' | 'accent' | 'sun' | 'success' | 'warning' | 'danger' | 'info'

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-bg-muted text-fg-muted border-border',
  accent: 'bg-accent/15 text-accent border-accent/25',
  sun: 'bg-sun-1/15 text-sun-1 border-sun-1/25',
  success: 'bg-success/15 text-success border-success/25',
  warning: 'bg-warning/15 text-warning border-warning/25',
  danger: 'bg-danger/15 text-danger border-danger/25',
  info: 'bg-sun-3/15 text-sun-3 border-sun-3/25',
}

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone
}

export function Badge({ tone = 'neutral', className, children, ...rest }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-none',
        TONES[tone],
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  )
}

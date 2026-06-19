import { forwardRef } from 'react'
import type { HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

export type CardPadding = 'none' | 'sm' | 'md' | 'lg'

const PAD: Record<CardPadding, string> = {
  none: '',
  sm: 'p-3',
  md: 'p-5',
  lg: 'p-7',
}

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  interactive?: boolean
  padding?: CardPadding
}

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { interactive = false, padding = 'md', className, children, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(
        'rounded-2xl border border-border bg-bg-subtle',
        interactive && 'cursor-pointer transition-colors hover:border-border-subtle hover:bg-bg-muted',
        PAD[padding],
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  )
})

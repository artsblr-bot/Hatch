import { forwardRef } from 'react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { haptic } from '@/lib/juice'

export type IconButtonSize = 'sm' | 'md' | 'lg'

const SIZES: Record<IconButtonSize, string> = {
  sm: 'h-8 w-8 rounded-lg',
  md: 'h-9 w-9 rounded-lg',
  lg: 'h-10 w-10 rounded-xl',
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  'aria-label': string
  size?: IconButtonSize
  active?: boolean
  children: ReactNode
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { size = 'md', active = false, className, children, onClick, disabled, type, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      disabled={disabled}
      onClick={(e) => {
        if (disabled) return
        haptic('light')
        onClick?.(e)
      }}
      className={cn(
        'inline-flex items-center justify-center transition-colors focus-ring active:scale-95 disabled:opacity-40 disabled:pointer-events-none',
        active ? 'text-fg bg-bg-muted' : 'text-fg-muted hover:text-fg hover:bg-bg-muted/60',
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  )
})

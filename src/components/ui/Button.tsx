import { forwardRef } from 'react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { haptic, playSound } from '@/lib/juice'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'sunrise'
export type ButtonSize = 'sm' | 'md' | 'lg'

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-fg hover:bg-accent/90 active:bg-accent/80',
  secondary: 'bg-bg-muted text-fg border border-border hover:border-border-subtle hover:bg-bg-muted/70',
  ghost: 'text-fg-muted hover:text-fg hover:bg-bg-muted/60',
  danger: 'bg-danger text-white hover:bg-danger/90 active:bg-danger/80',
  // Sunrise is reserved for the one hero CTA per screen — the gradient is
  // always bright, so it carries dark plum ink in both themes.
  sunrise: 'bg-sunrise text-[#171420] font-semibold shadow-glow hover:brightness-105 active:brightness-95',
}

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-sm gap-1.5 rounded-lg',
  md: 'h-10 px-4 text-sm gap-2 rounded-xl',
  lg: 'h-12 px-6 text-base gap-2.5 rounded-xl',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  iconLeft?: ReactNode
  iconRight?: ReactNode
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading = false, iconLeft, iconRight, className, children, disabled, onClick, type, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      disabled={disabled || loading}
      onClick={(e) => {
        if (disabled || loading) return
        haptic('light')
        playSound('tap')
        onClick?.(e)
      }}
      className={cn(
        'inline-flex items-center justify-center font-medium focus-ring transition-[background,color,transform,filter,border-color] duration-150 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : iconLeft}
      {children}
      {!loading ? iconRight : null}
    </button>
  )
})

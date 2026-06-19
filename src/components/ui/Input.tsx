import { forwardRef } from 'react'
import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

const BASE =
  'w-full bg-bg-muted/40 text-fg placeholder:text-fg-subtle border border-border rounded-xl focus-ring transition-colors disabled:opacity-50'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean
  iconLeft?: ReactNode
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { invalid = false, iconLeft, className, ...rest },
  ref,
) {
  if (iconLeft) {
    return (
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle">{iconLeft}</span>
        <input
          ref={ref}
          className={cn(BASE, 'h-10 pl-10 pr-3', invalid && 'border-danger focus-visible:ring-danger', className)}
          {...rest}
        />
      </div>
    )
  }
  return (
    <input
      ref={ref}
      className={cn(BASE, 'h-10 px-3', invalid && 'border-danger focus-visible:ring-danger', className)}
      {...rest}
    />
  )
})

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { invalid = false, className, ...rest },
  ref,
) {
  return (
    <textarea
      ref={ref}
      className={cn(BASE, 'resize-none px-3 py-2', invalid && 'border-danger focus-visible:ring-danger', className)}
      {...rest}
    />
  )
})

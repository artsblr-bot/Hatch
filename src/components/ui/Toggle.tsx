import { cn } from '@/lib/utils'
import { haptic } from '@/lib/juice'

export interface ToggleProps {
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
  className?: string
  'aria-label'?: string
}

export function Toggle({ checked, onChange, disabled = false, className, ...rest }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => {
        if (disabled) return
        haptic('light')
        onChange(!checked)
      }}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border border-border transition-colors focus-ring disabled:opacity-50',
        checked ? 'bg-accent' : 'bg-bg-muted',
        className,
      )}
      {...rest}
    >
      <span
        className={cn(
          'inline-block h-4 w-4 transform rounded-full bg-fg shadow-sm transition-transform',
          checked ? 'translate-x-6' : 'translate-x-1',
        )}
      />
    </button>
  )
}

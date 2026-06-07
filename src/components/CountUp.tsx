import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

interface Props {
  value: number
  duration?: number
  className?: string
  /** Optional formatter (e.g. to add suffixes). */
  format?: (n: number) => string
  /** Run the count-up every time the value changes by this much, or once on mount. */
  trigger?: 'mount' | 'change'
}

/**
 * CountUp — animates a numeric value from 0 to `value` over `duration` ms.
 * Easing: easeOutCubic.
 */
export function CountUp({ value, duration = 900, className, format, trigger = 'mount' }: Props) {
  const [n, setN] = useState(trigger === 'mount' ? 0 : value)
  const prev = useRef(trigger === 'mount' ? 0 : value)
  const raf = useRef<number | null>(null)

  useEffect(() => {
    if (trigger === 'change' && prev.current === value) return
    const start = performance.now()
    const from = trigger === 'change' ? prev.current : 0
    const to = value
    const dur = Math.max(200, duration)
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / dur)
      const eased = 1 - Math.pow(1 - t, 3)
      setN(Math.round(from + (to - from) * eased))
      if (t < 1) raf.current = requestAnimationFrame(step)
      else prev.current = to
    }
    raf.current = requestAnimationFrame(step)
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current)
    }
  }, [value, duration, trigger])

  return <span className={cn('tabular-nums', className)}>{format ? format(n) : n}</span>
}

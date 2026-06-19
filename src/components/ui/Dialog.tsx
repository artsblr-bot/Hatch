import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { prefersReducedMotion, spring } from '@/lib/juice'
import { IconButton } from './IconButton'

const SIZES = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl' } as const

export interface DialogProps {
  open: boolean
  onClose: () => void
  title?: ReactNode
  children: ReactNode
  className?: string
  size?: keyof typeof SIZES
  showClose?: boolean
}

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'

function trapFocus(e: KeyboardEvent, container: HTMLElement | null) {
  if (!container) return
  const els = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null)
  if (els.length === 0) return
  const first = els[0]
  const last = els[els.length - 1]
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault()
    first.focus()
  }
}

export function Dialog({ open, onClose, title, children, className, size = 'md', showClose = true }: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      } else if (e.key === 'Tab') {
        trapFocus(e, panelRef.current)
      }
    }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const focusId = window.setTimeout(() => {
      panelRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus()
    }, 0)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
      window.clearTimeout(focusId)
    }
  }, [open, onClose])

  const reduce = prefersReducedMotion()

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          <div className="absolute inset-0 bg-bg/70 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: 8 }}
            animate={reduce ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.97, y: 8 }}
            transition={spring.pop}
            className={cn(
              'relative z-10 max-h-[90vh] w-full overflow-y-auto rounded-2xl border border-border bg-bg-subtle shadow-soft',
              SIZES[size],
              className,
            )}
          >
            {(title || showClose) && (
              <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-3.5">
                <h2 className="font-serif text-lg text-fg">{title}</h2>
                {showClose && (
                  <IconButton aria-label="Close" size="sm" onClick={onClose}>
                    <X className="h-4 w-4" />
                  </IconButton>
                )}
              </div>
            )}
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

import { useState, useCallback, createContext, useContext } from 'react'
import { nanoid } from 'nanoid'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, X, AlertTriangle, Info } from 'lucide-react'
import { cn } from '@/lib/utils'

export type ToastType = 'success' | 'error' | 'info' | 'warning'

export interface Toast {
  id: string
  type: ToastType
  title: string
  description?: string
  duration?: number
}

interface ToastContext {
  toasts: Toast[]
  toast: (t: Omit<Toast, 'id'>) => void
  success: (title: string, description?: string) => void
  error: (title: string, description?: string) => void
  info: (title: string, description?: string) => void
  warning: (title: string, description?: string) => void
  dismiss: (id: string) => void
}

const Ctx = createContext<ToastContext | null>(null)

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const dismiss = useCallback((id: string) => {
    setToasts((t) => t.filter((x) => x.id !== id))
  }, [])

  const toast = useCallback((t: Omit<Toast, 'id'>) => {
    const id = nanoid(8)
    setToasts((prev) => [...prev, { ...t, id }])
    const dur = t.duration ?? 4000
    if (dur > 0) {
      setTimeout(() => dismiss(id), dur)
    }
  }, [dismiss])

  const ctx: ToastContext = {
    toasts,
    toast,
    dismiss,
    success: (title, description) => toast({ type: 'success', title, description }),
    error: (title, description) => toast({ type: 'error', title, description, duration: 6000 }),
    info: (title, description) => toast({ type: 'info', title, description }),
    warning: (title, description) => toast({ type: 'warning', title, description }),
  }

  return (
    <Ctx.Provider value={ctx}>
      {children}
      <ToastViewport />
    </Ctx.Provider>
  )
}

export function useToast() {
  const c = useContext(Ctx)
  if (!c) throw new Error('useToast outside ToastProvider')
  return c
}

function ToastViewport() {
  const c = useContext(Ctx)!
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-full max-w-sm flex-col gap-2">
      <AnimatePresence>
        {c.toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, x: 24, scale: 0.96 }}
            transition={{ type: 'spring', damping: 25, stiffness: 350 }}
            className={cn(
              'pointer-events-auto flex items-start gap-3 rounded-2xl border bg-bg-subtle/95 px-4 py-3 shadow-soft backdrop-blur',
              t.type === 'success' && 'border-success/30',
              t.type === 'error' && 'border-danger/40',
              t.type === 'info' && 'border-border',
              t.type === 'warning' && 'border-warning/40'
            )}
          >
            <Icon type={t.type} />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium leading-tight">{t.title}</div>
              {t.description && (
                <div className="mt-0.5 text-xs text-fg-muted leading-snug">{t.description}</div>
              )}
            </div>
            <button
              onClick={() => c.dismiss(t.id)}
              className="rounded-md p-1 text-fg-subtle transition hover:bg-bg-muted hover:text-fg"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}

function Icon({ type }: { type: ToastType }) {
  const cls = 'h-4 w-4 flex-shrink-0 mt-0.5'
  switch (type) {
    case 'success':
      return <Check className={cn(cls, 'text-success')} />
    case 'error':
      return <X className={cn(cls, 'text-danger')} />
    case 'warning':
      return <AlertTriangle className={cn(cls, 'text-warning')} />
    case 'info':
    default:
      return <Info className={cn(cls, 'text-fg-muted')} />
  }
}

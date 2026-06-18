/**
 * Celebration — the app-wide "reward moment" surface.
 *
 * Provides `useCelebrate()` so any component can fire a celebration from a
 * single place: a centered card + confetti + a synthesized cue. Celebrations
 * queue (several milestones can land at once) and play one at a time so the
 * peak lands cleanly. Under reduced-motion it degrades to a calm, quick card
 * with no confetti or overshoot.
 *
 * Psychology: this is the "peak" in peak-end — concentrating delight into a
 * few well-earned, slightly-variable moments rather than constant noise.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ConfettiBurst } from './ConfettiBurst'
import { haptic, playSound, prefersReducedMotion, spring } from '@/lib/juice'

export interface CelebrationPayload {
  emoji: string
  title: string
  subtitle?: string
  tier?: 'small' | 'big'
}

interface CelebrationContextValue {
  /** Show a full celebration (card + confetti + sound). */
  celebrate: (payload: CelebrationPayload) => void
  /** Just fire confetti + a cue, no card (e.g. clearing the week). */
  burst: (tier?: 'small' | 'big') => void
}

const CelebrationContext = createContext<CelebrationContextValue | null>(null)

export function useCelebrate(): CelebrationContextValue {
  const ctx = useContext(CelebrationContext)
  if (!ctx) {
    // Fail soft — a missing provider should never crash a feature.
    return { celebrate: () => {}, burst: () => {} }
  }
  return ctx
}

export function CelebrationProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<CelebrationPayload[]>([])
  const [current, setCurrent] = useState<CelebrationPayload | null>(null)
  const [confettiOn, setConfettiOn] = useState(false)
  // Density of the *currently playing* confetti, so a standalone big burst
  // (week cleared, end-of-week) gets a fuller burst than a small one.
  const [confettiBig, setConfettiBig] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const celebrate = useCallback((payload: CelebrationPayload) => {
    setQueue((q) => [...q, payload])
  }, [])

  const burst = useCallback((tier: 'small' | 'big' = 'small') => {
    playSound(tier === 'big' ? 'levelup' : 'celebrate')
    haptic('celebrate')
    if (prefersReducedMotion()) return
    setConfettiBig(tier === 'big')
    setConfettiOn(false)
    // Re-arm on the next frame so a back-to-back burst actually replays.
    requestAnimationFrame(() => setConfettiOn(true))
  }, [])

  // Advance the queue: when nothing is showing and something is waiting, pop
  // it, fire the feedback, and schedule its dismissal.
  useEffect(() => {
    if (current || queue.length === 0) return
    const [next, ...rest] = queue
    setQueue(rest)
    setCurrent(next)

    const big = next.tier === 'big'
    playSound(big ? 'levelup' : 'complete')
    haptic(big ? 'celebrate' : 'success')
    if (!prefersReducedMotion()) {
      setConfettiBig(big)
      setConfettiOn(false)
      requestAnimationFrame(() => setConfettiOn(true))
    }

    const hold = prefersReducedMotion() ? 1600 : big ? 2800 : 2200
    timerRef.current = setTimeout(() => setCurrent(null), hold)
  }, [current, queue])

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  const reduced = prefersReducedMotion()
  const big = current?.tier === 'big'
  const value = useMemo(() => ({ celebrate, burst }), [celebrate, burst])

  return (
    <CelebrationContext.Provider value={value}>
      {children}

      {/* Full-screen, non-interactive reward overlay. */}
      <div className="pointer-events-none fixed inset-0 z-[100] grid place-items-center overflow-hidden">
        {confettiOn && !reduced && (
          <ConfettiBurst active={confettiOn} count={confettiBig ? 64 : 40} onDone={() => setConfettiOn(false)} />
        )}

        <AnimatePresence>
          {current && (
            <motion.div
              key={current.title}
              initial={reduced ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.85 }}
              animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
              exit={reduced ? { opacity: 0 } : { opacity: 0, y: -16, scale: 0.95 }}
              transition={reduced ? { duration: 0.18 } : spring.bouncy}
              className="mx-4 flex max-w-xs flex-col items-center gap-2 rounded-3xl border border-accent/30 bg-bg/90 px-8 py-7 text-center shadow-glow backdrop-blur-xl"
            >
              <motion.div
                initial={reduced ? false : { scale: 0, rotate: -25 }}
                animate={reduced ? {} : { scale: 1, rotate: 0 }}
                transition={reduced ? undefined : { ...spring.bouncy, delay: 0.08 }}
                className={big ? 'text-6xl' : 'text-5xl'}
              >
                {current.emoji}
              </motion.div>
              <div className="mt-1 font-serif text-xl font-medium tracking-tight text-fg">
                {current.title}
              </div>
              {current.subtitle && (
                <p className="text-sm leading-snug text-fg-muted">{current.subtitle}</p>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </CelebrationContext.Provider>
  )
}

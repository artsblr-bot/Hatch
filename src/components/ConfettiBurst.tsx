import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

interface Props {
  /** When true, the burst is on screen. */
  active: boolean
  /** Number of particles. */
  count?: number
  /** Brand color in HSL space, e.g. "21 100% 55%". Defaults to accent orange. */
  color?: string
  /** Called once the burst has finished its animation. */
  onDone?: () => void
}

interface Particle {
  id: number
  x: number
  y: number
  rotation: number
  scale: number
  delay: number
  color: string
  duration: number
}

// Warm-biased, celebratory palette anchored on the yolk amber, with a couple
// of cool notes so the burst still pops.
const COLORS = [
  'hsl(35 92% 60%)',
  'hsl(45 90% 62%)',
  'hsl(15 82% 60%)',
  'hsl(340 70% 64%)',
  'hsl(174 60% 52%)',
  'hsl(146 60% 52%)',
]

/**
 * Self-contained one-shot confetti burst. Fires whenever `active` flips
 * from false to true. Used on the Today panel when the last task of the
 * week is completed. The brand colors are randomized per-particle for a
 * celebratory feel without leaning into a generic look.
 */
export function ConfettiBurst({ active, count = 26, onDone }: Props) {
  const [particles, setParticles] = useState<Particle[]>([])
  // Read onDone via a ref so an inline (non-memoized) callback from the parent
  // doesn't re-trigger the burst — otherwise every parent re-render while
  // `active` is true regenerates the particles and resets the done timer.
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone

  useEffect(() => {
    if (!active) {
      setParticles([])
      return
    }
    const ps: Particle[] = Array.from({ length: count }, (_, i) => {
      const angle = Math.random() * Math.PI * 2
      const dist = 60 + Math.random() * 100
      return {
        id: i,
        x: Math.cos(angle) * dist,
        y: Math.sin(angle) * dist - 20, // bias upward
        rotation: (Math.random() - 0.5) * 720,
        scale: 0.6 + Math.random() * 0.7,
        delay: Math.random() * 80,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        duration: 700 + Math.random() * 400,
      }
    })
    setParticles(ps)
    const t = setTimeout(() => {
      onDoneRef.current?.()
    }, 1300)
    return () => clearTimeout(t)
  }, [active, count])

  return (
    <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center overflow-visible">
      <AnimatePresence>
        {particles.map((p) => (
          <motion.span
            key={p.id}
            initial={{ x: 0, y: 0, rotate: 0, scale: 0, opacity: 1 }}
            animate={{
              x: p.x,
              y: p.y,
              rotate: p.rotation,
              scale: p.scale,
              opacity: 0,
            }}
            transition={{
              duration: p.duration / 1000,
              delay: p.delay / 1000,
              ease: [0.16, 1, 0.3, 1],
            }}
            className="absolute h-2 w-2 rounded-sm"
            style={{ backgroundColor: p.color }}
          />
        ))}
      </AnimatePresence>
    </div>
  )
}

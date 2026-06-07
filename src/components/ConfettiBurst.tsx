import { useEffect, useState } from 'react'
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

const COLORS = [
  'hsl(21 100% 55%)',
  'hsl(38 92% 55%)',
  'hsl(174 60% 50%)',
  'hsl(217 91% 65%)',
  'hsl(322 81% 65%)',
  'hsl(142 71% 50%)',
]

/**
 * Self-contained one-shot confetti burst. Fires whenever `active` flips
 * from false to true. Used on the Today panel when the last task of the
 * week is completed. The brand colors are randomized per-particle for a
 * celebratory feel without leaning into a generic look.
 */
export function ConfettiBurst({ active, count = 26, onDone }: Props) {
  const [particles, setParticles] = useState<Particle[]>([])

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
      onDone?.()
    }, 1300)
    return () => clearTimeout(t)
  }, [active, count, onDone])

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

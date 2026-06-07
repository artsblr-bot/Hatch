import { useMemo } from 'react'
import { cn } from '@/lib/utils'

interface Props {
  count?: number
  className?: string
  /** Tinting. */
  color?: 'orange' | 'teal' | 'violet' | 'mix'
  /** Density of motion. Higher = faster & further. */
  energy?: 1 | 2 | 3
}

interface Orb {
  x: number
  y: number
  size: number
  delay: number
  duration: number
  drift: number
  hue: number
  sat: number
  light: number
  alpha: number
}

const HUES = {
  orange: [21, 28, 14],
  teal: [174, 190, 200],
  violet: [265, 290, 320],
  mix: [21, 174, 265, 320],
} as const

/**
 * ParticleField — a deterministic pseudo-random scatter of soft orbs that drift
 * gently in the background. Renders as an absolutely positioned full-bleed
 * decorative layer. Pointer-events disabled.
 *
 * `seed` is stable per count/color so re-renders don't reshuffle particles.
 */
export function ParticleField({ count = 18, className, color = 'orange', energy = 1 }: Props) {
  const orbs = useMemo<Orb[]>(() => {
    const seed = (n: number) => {
      // Mulberry32
      let a = (n * 2654435761) >>> 0
      return () => {
        a |= 0
        a = (a + 0x6d2b79f5) | 0
        let t = Math.imul(a ^ (a >>> 15), 1 | a)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
      }
    }
    const rng = seed(count * 7 + color.charCodeAt(0) * 13)
    const hues = HUES[color]
    return Array.from({ length: count }, () => {
      const size = 4 + rng() * 18
      return {
        x: rng() * 100,
        y: rng() * 100,
        size,
        delay: -rng() * 12,
        duration: 14 + rng() * (10 / energy),
        drift: 8 + rng() * (16 * energy),
        hue: hues[Math.floor(rng() * hues.length)],
        sat: 80 + Math.floor(rng() * 20),
        light: 55 + Math.floor(rng() * 15),
        alpha: 0.18 + rng() * 0.22,
      }
    })
  }, [count, color, energy])

  return (
    <div
      aria-hidden
      className={cn('pointer-events-none absolute inset-0 overflow-hidden', className)}
    >
      {orbs.map((o, i) => (
        <span
          key={i}
          className="absolute rounded-full will-change-transform"
          style={{
            left: `${o.x}%`,
            top: `${o.y}%`,
            width: o.size,
            height: o.size,
            background: `hsl(${o.hue}, ${o.sat}%, ${o.light}%)`,
            opacity: o.alpha,
            filter: `blur(${Math.min(6, o.size / 3)}px)`,
            animation: `orb-drift ${o.duration}s ease-in-out ${o.delay}s infinite alternate`,
            // Custom property for drift distance
            ['--drift' as any]: `${o.drift}vmin`,
          }}
        />
      ))}
      <style>{`
        @keyframes orb-drift {
          0%   { transform: translate3d(0, 0, 0) scale(1); }
          50%  { transform: translate3d(calc(var(--drift) * 0.6), calc(var(--drift) * -0.4), 0) scale(1.2); }
          100% { transform: translate3d(calc(var(--drift) * -0.5), calc(var(--drift) * 0.5), 0) scale(0.85); }
        }
      `}</style>
    </div>
  )
}

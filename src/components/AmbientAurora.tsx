import { cn } from '@/lib/utils'

interface Props {
  className?: string
  /** Number of blobs (2-4). */
  intensity?: 1 | 2 | 3
  /** Tint color — defaults to the brand orange. */
  color?: 'orange' | 'violet' | 'teal' | 'mix'
  /** Render fixed to the viewport (default true) */
  fixed?: boolean
}

const PALETTES = {
  orange: ['hsl(21, 100%, 55%)', 'hsl(28, 95%, 60%)'],
  violet: ['hsl(265, 90%, 65%)', 'hsl(290, 80%, 60%)'],
  teal: ['hsl(174, 65%, 50%)', 'hsl(190, 80%, 55%)'],
  mix: ['hsl(21, 100%, 55%)', 'hsl(265, 80%, 60%)', 'hsl(174, 65%, 50%)'],
} as const

/**
 * AmbientAurora — slow-drifting colored blobs that breathe behind content.
 * Pure CSS, GPU-accelerated, never blocks interaction.
 */
export function AmbientAurora({ className, intensity = 2, color = 'orange', fixed = true }: Props) {
  const colors = PALETTES[color]
  const blobs =
    intensity === 1
      ? [{ x: '20%', y: '15%', size: '38vmin', delay: '0s', dur: '24s', c: colors[0] }]
      : intensity === 2
      ? [
          { x: '12%', y: '10%', size: '34vmin', delay: '0s', dur: '22s', c: colors[0] },
          { x: '78%', y: '70%', size: '40vmin', delay: '-7s', dur: '28s', c: colors[1 % colors.length] },
        ]
      : [
          { x: '10%', y: '8%', size: '32vmin', delay: '0s', dur: '22s', c: colors[0] },
          { x: '75%', y: '20%', size: '28vmin', delay: '-9s', dur: '26s', c: colors[1 % colors.length] },
          { x: '30%', y: '80%', size: '36vmin', delay: '-4s', dur: '30s', c: colors[2 % colors.length] },
        ]

  return (
    <div
      aria-hidden
      className={cn(
        'pointer-events-none overflow-hidden',
        fixed ? 'fixed inset-0 -z-10' : 'absolute inset-0 -z-10',
        className
      )}
    >
      {blobs.map((b, i) => (
        <span
          key={i}
          className="absolute rounded-full mix-blend-screen blur-3xl opacity-[0.18] will-change-transform"
          style={{
            left: b.x,
            top: b.y,
            width: b.size,
            height: b.size,
            background: b.c,
            animation: `aurora-drift ${b.dur} ease-in-out ${b.delay} infinite alternate`,
          }}
        />
      ))}
    </div>
  )
}

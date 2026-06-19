import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { motion } from 'framer-motion'
import { tasksThisWeek, weekStart } from '@/lib/tasks'
import { AmbientAurora } from './AmbientAurora'
import { ParticleField } from './ParticleField'
import { prefersReducedMotion, spring } from '@/lib/juice'
import { clamp } from '@/lib/utils'

/**
 * MomentumHorizon — the First Light signature. A sunrise glow pinned to the
 * bottom of the workspace that *rises and brightens with the founder's
 * momentum* (share of this week's tasks completed). Three pointer-safe,
 * aria-hidden layers: a radial sunrise glow, the ambient aurora drift, and
 * rising embers. Reduced-motion collapses to the static glow only — the
 * information (how bright = how much momentum) is preserved, the motion removed.
 */
export function MomentumHorizon() {
  const tasks = useLiveQuery(() => tasksThisWeek(weekStart()), []) || []

  const momentum = useMemo(() => {
    if (!tasks.length) return 0
    const done = tasks.filter((t) => t.status === 'done').length
    return clamp(done / Math.max(tasks.length, 1), 0, 1)
  }, [tasks])

  const reduce = prefersReducedMotion()
  const height = 26 + momentum * 48 // % of the workspace height
  const opacity = 0.32 + momentum * 0.5

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <motion.div
        className="absolute inset-x-0 bottom-0 bg-sunrise-radial"
        initial={false}
        animate={{ height: `${height}%`, opacity }}
        transition={reduce ? { duration: 0 } : spring.soft}
      />
      {!reduce && (
        <>
          <AmbientAurora intensity={2} color="orange" fixed={false} className="opacity-60" />
          <ParticleField count={Math.round(8 + momentum * 18)} color="orange" energy={2} className="mask-fade-b" />
        </>
      )}
    </div>
  )
}

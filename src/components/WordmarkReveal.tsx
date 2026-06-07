import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'

interface Props {
  text?: string
  size?: number
  /** Stagger delay between letters (seconds). */
  stagger?: number
  className?: string
  /** If true, runs the reveal every time the component mounts. */
  onMount?: boolean
  /** Letter color overrides */
  highlight?: string
}

/**
 * WordmarkReveal — splits the wordmark into letters and reveals them with a
 * stagger + slight Y offset, like Claude's logo appearing. Each letter gets a
 * subtle hover-tilt via CSS.
 */
export function WordmarkReveal({
  text = 'hatch',
  size = 64,
  stagger = 0.06,
  className,
  highlight,
}: Props) {
  return (
    <motion.span
      className={cn('inline-flex font-sans font-bold tracking-[-0.04em]', className)}
      style={{ fontSize: `${size}px`, lineHeight: 1 }}
      initial="hidden"
      animate="show"
      variants={{
        hidden: {},
        show: { transition: { staggerChildren: stagger, delayChildren: 0.1 } },
      }}
    >
      {Array.from(text).map((ch, i) => (
        <motion.span
          key={i}
          className={cn('inline-block', highlight)}
          variants={{
            hidden: { y: '40%', opacity: 0, filter: 'blur(6px)' },
            show: {
              y: '0%',
              opacity: 1,
              filter: 'blur(0px)',
              transition: { type: 'spring', stiffness: 240, damping: 22, mass: 0.6 },
            },
          }}
          whileHover={{ y: -2, transition: { duration: 0.2 } }}
        >
          {ch}
        </motion.span>
      ))}
    </motion.span>
  )
}

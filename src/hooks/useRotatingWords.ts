/**
 * useRotatingWords — cycles through a list of words with fade + translate animation.
 * Variable timing (2-3.5s) to feel alive rather than mechanical.
 */

import { useEffect, useState, useRef } from 'react'
import { pickRandom } from '@/lib/utils'

interface Options {
  words: readonly string[]
  intervalMs?: [number, number] // [min, max]
  enabled?: boolean
}

export function useRotatingWords({ words, intervalMs = [2200, 3400], enabled = true }: Options) {
  const [index, setIndex] = useState(() => Math.floor(Math.random() * Math.max(1, words.length)))
  const [visible, setVisible] = useState(true)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fadeRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const currentWord = words.length > 0 ? words[index % words.length] : 'Thinking'

  useEffect(() => {
    if (!enabled || words.length === 0) return
    const tick = () => {
      // Fade out
      setVisible(false)
      fadeRef.current = setTimeout(() => {
        setIndex((i) => (i + 1) % words.length)
        setVisible(true)
      }, 220)
      // Schedule next
      const [min, max] = intervalMs
      const next = min + Math.random() * (max - min)
      timeoutRef.current = setTimeout(tick, next)
    }
    timeoutRef.current = setTimeout(tick, intervalMs[0])
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      if (fadeRef.current) clearTimeout(fadeRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, words.join('|'), intervalMs[0], intervalMs[1]])

  return { word: currentWord, visible }
}

/**
 * One-shot rotating: picks a word immediately, rotates through, can be reset.
 */
export function useRotatingWord(opts: { words: readonly string[]; intervalMs?: number; enabled?: boolean }) {
  const { words, intervalMs = 2500, enabled = true } = opts
  const [word, setWord] = useState(() => (words.length > 0 ? pickRandom(words) : 'Thinking'))
  useEffect(() => {
    if (!enabled || words.length === 0) return
    const id = setInterval(() => {
      setWord((prev) => {
        const others = words.filter((w) => w !== prev)
        return pickRandom(others.length > 0 ? others : words)
      })
    }, intervalMs)
    return () => clearInterval(id)
    // Depend on a stable join, not the array identity — callers pass inline
    // literals, so `words` is a new reference every render and would otherwise
    // restart the interval before it ever fires.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, words.join('|'), intervalMs])
  return word
}

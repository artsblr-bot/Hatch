/**
 * useJitterBuffer — smooth streaming display.
 * Buffers incoming tokens and reveals them at a constant character rate,
 * decoupling display rate from arrival rate.
 */

import { useEffect, useRef, useState, useCallback } from 'react'

export interface JitterBufferState {
  /** The currently-revealed text. */
  text: string
  /** True if more text is buffered but not yet revealed. */
  isBuffering: boolean
}

export interface JitterBuffer {
  state: JitterBufferState
  push: (chunk: string) => void
  flush: () => void
  clear: () => void
  finish: () => void
}

interface Options {
  /** Characters per second to reveal. Default ~40 chars/sec (8 chars / 200ms). */
  charsPerSecond?: number
  /** Minimum chunk size in ms between reveals. */
  tickMs?: number
  /** Whether to start revealing immediately on first push. */
  immediate?: boolean
}

export function useJitterBuffer(options: Options = {}): JitterBuffer {
  const { charsPerSecond = 60, tickMs = 32, immediate = true } = options
  const [text, setText] = useState('')
  const [isBuffering, setIsBuffering] = useState(false)
  const bufferRef = useRef<string[]>([])
  const textRef = useRef('')
  const rafRef = useRef<number | null>(null)
  const lastTickRef = useRef(0)
  const totalPushedRef = useRef(0)
  const totalRevealedRef = useRef(0)
  const finishedRef = useRef(false)
  const chunkSizeRef = useRef(Math.max(1, Math.round((charsPerSecond * tickMs) / 1000)))

  const tick = useCallback(() => {
    const now = performance.now()
    const elapsed = now - lastTickRef.current
    if (elapsed < tickMs) {
      rafRef.current = requestAnimationFrame(tick)
      return
    }
    lastTickRef.current = now

    const target = chunkSizeRef.current
    if (bufferRef.current.length === 0) {
      if (finishedRef.current) {
        setIsBuffering(false)
        rafRef.current = null
        return
      }
      rafRef.current = requestAnimationFrame(tick)
      return
    }

    // Drain up to `target` chars
    let revealed = ''
    let remaining = target
    while (remaining > 0 && bufferRef.current.length > 0) {
      const first = bufferRef.current[0]
      if (first.length <= remaining) {
        revealed += first
        remaining -= first.length
        bufferRef.current.shift()
      } else {
        revealed += first.slice(0, remaining)
        bufferRef.current[0] = first.slice(remaining)
        remaining = 0
      }
    }
    if (revealed) {
      textRef.current += revealed
      totalRevealedRef.current += revealed.length
      setText(textRef.current)
    }
    setIsBuffering(bufferRef.current.length > 0)
    rafRef.current = requestAnimationFrame(tick)
  }, [tickMs])

  // Start ticker on first push
  const ensureRunning = useCallback(() => {
    if (rafRef.current == null) {
      lastTickRef.current = performance.now()
      rafRef.current = requestAnimationFrame(tick)
    }
  }, [tick])

  const push = useCallback(
    (chunk: string) => {
      if (!chunk) return
      if (immediate && bufferRef.current.length === 0 && textRef.current.length === 0) {
        // Reveal first chunk immediately for snappy feel
        textRef.current += chunk
        totalRevealedRef.current += chunk.length
        totalPushedRef.current += chunk.length
        setText(textRef.current)
        return
      }
      totalPushedRef.current += chunk.length
      bufferRef.current.push(chunk)
      setIsBuffering(true)
      ensureRunning()
    },
    [immediate, ensureRunning]
  )

  const flush = useCallback(() => {
    if (bufferRef.current.length > 0) {
      const remaining = bufferRef.current.join('')
      bufferRef.current = []
      textRef.current += remaining
      totalRevealedRef.current += remaining.length
      setText(textRef.current)
    }
    setIsBuffering(false)
  }, [])

  const clear = useCallback(() => {
    bufferRef.current = []
    textRef.current = ''
    totalPushedRef.current = 0
    totalRevealedRef.current = 0
    finishedRef.current = false
    setText('')
    setIsBuffering(false)
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [])

  const finish = useCallback(() => {
    finishedRef.current = true
    // Let the ticker drain naturally
    if (rafRef.current == null && bufferRef.current.length > 0) {
      ensureRunning()
    }
  }, [ensureRunning])

  useEffect(() => {
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  return {
    state: { text, isBuffering },
    push,
    flush,
    clear,
    finish,
  } as JitterBuffer
}

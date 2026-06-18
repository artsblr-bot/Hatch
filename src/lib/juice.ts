/**
 * juice.ts — the low-level "feel" layer.
 *
 * Imperative feedback primitives (haptics + a tiny zero-asset WebAudio sound
 * engine) plus shared motion constants. These are called from hot paths
 * (button clicks, task completion) so they must be synchronous and cheap —
 * preferences are mirrored into a module-level cache that React syncs from
 * Dexie at app start (see setJuicePrefs / App.tsx).
 *
 * Why a cache instead of reading Dexie each time: completing a task or tapping
 * a button should make a sound *now*, not after an async round-trip.
 */

export type ReducedMotionPref = 'auto' | 'on' | 'off'

export interface JuicePrefs {
  sound: boolean
  haptics: boolean
  reducedMotion: ReducedMotionPref
}

/** Sensible defaults: haptics on (free, mobile-only, unobtrusive), sound off
 *  (opt-in so we never surprise someone in a quiet room), motion auto. */
export const DEFAULT_JUICE: JuicePrefs = {
  sound: false,
  haptics: true,
  reducedMotion: 'auto',
}

let _prefs: JuicePrefs = { ...DEFAULT_JUICE }

export function setJuicePrefs(p: Partial<JuicePrefs>): void {
  _prefs = { ..._prefs, ...p }
}

export function getJuicePrefs(): JuicePrefs {
  return _prefs
}

// ---------------------------------------------------------------------------
// Reduced motion
// ---------------------------------------------------------------------------

/**
 * Whether to suppress non-essential motion. Honors the OS setting in 'auto'
 * mode and the explicit user override otherwise. Components gate their heavy
 * effects (confetti, big springs) on this — it's the responsible way to make
 * something lively without making it inaccessible or nauseating.
 */
export function prefersReducedMotion(): boolean {
  if (_prefs.reducedMotion === 'on') return true
  if (_prefs.reducedMotion === 'off') return false
  if (typeof window === 'undefined' || !window.matchMedia) return false
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Haptics
// ---------------------------------------------------------------------------

export type HapticKind = 'light' | 'medium' | 'success' | 'celebrate'

const HAPTIC_PATTERNS: Record<HapticKind, number | number[]> = {
  light: 8,
  medium: 16,
  success: [12, 40, 18],
  celebrate: [10, 30, 10, 30, 24],
}

/** Fire a vibration pattern on supporting devices (mostly Android). No-op when
 *  haptics are disabled, reduced motion is on, or the API is unavailable. */
export function haptic(kind: HapticKind = 'light'): void {
  if (!_prefs.haptics || prefersReducedMotion()) return
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return
  try {
    navigator.vibrate(HAPTIC_PATTERNS[kind])
  } catch {
    /* some browsers throw if called without a user gesture — ignore */
  }
}

// ---------------------------------------------------------------------------
// Sound — synthesized with WebAudio, no audio files to ship or load.
// ---------------------------------------------------------------------------

type WindowWithWebkitAudio = Window & { webkitAudioContext?: typeof AudioContext }

let _ctx: AudioContext | null = null

function audioCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (_ctx) return _ctx
  const w = window as WindowWithWebkitAudio
  const AC = window.AudioContext || w.webkitAudioContext
  if (!AC) return null
  try {
    _ctx = new AC()
  } catch {
    return null
  }
  return _ctx
}

/** Play a single enveloped note. */
function tone(
  ctx: AudioContext,
  opts: {
    freq: number
    start: number
    duration: number
    type?: OscillatorType
    gain?: number
  }
): void {
  const { freq, start, duration, type = 'sine', gain = 0.12 } = opts
  const osc = ctx.createOscillator()
  const env = ctx.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, start)
  // Quick attack, exponential decay — reads as a soft "pop"/"ding" rather
  // than a harsh beep.
  env.gain.setValueAtTime(0.0001, start)
  env.gain.exponentialRampToValueAtTime(gain, start + 0.012)
  env.gain.exponentialRampToValueAtTime(0.0001, start + duration)
  osc.connect(env)
  env.connect(ctx.destination)
  osc.start(start)
  osc.stop(start + duration + 0.02)
}

export type SoundName = 'tap' | 'complete' | 'celebrate' | 'levelup' | 'error'

/** Play a short synthesized cue. No-op when sound is disabled. */
export function playSound(name: SoundName): void {
  if (!_prefs.sound) return
  const ctx = audioCtx()
  if (!ctx) return
  // Browsers start the context suspended until a user gesture; resume lazily.
  if (ctx.state === 'suspended') ctx.resume().catch(() => {})
  const t = ctx.currentTime

  switch (name) {
    case 'tap':
      tone(ctx, { freq: 660, start: t, duration: 0.07, type: 'triangle', gain: 0.05 })
      break
    case 'complete':
      // Pleasant rising two-note "did-dah".
      tone(ctx, { freq: 587.33, start: t, duration: 0.12, type: 'sine', gain: 0.1 }) // D5
      tone(ctx, { freq: 880, start: t + 0.08, duration: 0.16, type: 'sine', gain: 0.1 }) // A5
      break
    case 'celebrate':
      // Major arpeggio C-E-G-C.
      ;[523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
        tone(ctx, { freq: f, start: t + i * 0.07, duration: 0.22, type: 'triangle', gain: 0.09 })
      )
      break
    case 'levelup':
      // Bigger fanfare for milestones: arpeggio + a sparkly top note.
      ;[523.25, 659.25, 783.99, 1046.5, 1318.51].forEach((f, i) =>
        tone(ctx, { freq: f, start: t + i * 0.06, duration: 0.26, type: 'triangle', gain: 0.1 })
      )
      break
    case 'error':
      tone(ctx, { freq: 196, start: t, duration: 0.18, type: 'sawtooth', gain: 0.06 })
      break
  }
}

// ---------------------------------------------------------------------------
// Shared motion constants — keep springs consistent across the app.
// ---------------------------------------------------------------------------

export const spring = {
  /** Calm UI settling (bars, layout). */
  soft: { type: 'spring', stiffness: 120, damping: 22 } as const,
  /** Snappy entrances (badges, chips). */
  pop: { type: 'spring', stiffness: 380, damping: 20 } as const,
  /** Playful overshoot for reward moments. */
  bouncy: { type: 'spring', stiffness: 500, damping: 16 } as const,
}

/** The signature ease used throughout (matches the Tailwind cubic-beziers).
 *  Typed as a mutable 4-tuple so it's assignable to framer's bezier `ease`. */
export const EASE_OUT: [number, number, number, number] = [0.16, 1, 0.3, 1]

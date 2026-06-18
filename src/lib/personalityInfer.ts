import type { Message, PersonalityStyle } from './db'

const SIX_HOURS = 6 * 60 * 60 * 1000
const MIN_MESSAGES = 5

/** Returns true when enough new data exists to re-run inference. */
export function shouldInfer(style: PersonalityStyle | undefined, userMessageCount: number): boolean {
  if (userMessageCount < MIN_MESSAGES) return false
  if (!style) return true
  return Date.now() - style.inferredAt > SIX_HOURS
}

/**
 * Analyzes the user's message history to infer three communication
 * preferences: pace (how detailed), tone (direct vs warm), and focus
 * (execution vs strategy). These are injected into the system prompt so
 * the cofounder adapts its style over time without the user having to
 * configure anything.
 */
export function inferPersonalityStyle(messages: Message[]): PersonalityStyle | null {
  const userMessages = messages.filter((m) => m.role === 'user' && m.content.trim().length > 10)
  if (userMessages.length < MIN_MESSAGES) return null

  // Pace: infer from average user message length
  const avgLen = userMessages.reduce((s, m) => s + m.content.length, 0) / userMessages.length
  const pace: PersonalityStyle['pace'] =
    avgLen < 80 ? 'fast' : avgLen > 300 ? 'thorough' : 'balanced'

  // Tone: look for directness vs vulnerability signals
  const text = userMessages.map((m) => m.content.toLowerCase()).join(' ')
  const directCount = (text.match(/\b(quick|brief|just|short|fast|blunt|simple|tldr|tl;dr|straight)\b/g) || []).length
  const warmCount = (text.match(/\b(help|struggling|worried|unsure|confused|difficult|afraid|nervous|lost)\b/g) || []).length
  const tone: PersonalityStyle['tone'] =
    directCount > warmCount + 1 ? 'direct' : warmCount > directCount + 1 ? 'warm' : 'balanced'

  // Focus: action vs analytical signals
  const actionCount = (text.match(/\b(do|next step|how to|implement|build|launch|ship|execute|action|task)\b/g) || []).length
  const thinkCount = (text.match(/\b(think|why|understand|analyze|strategy|approach|what if|should i|consider|weigh)\b/g) || []).length
  const focus: PersonalityStyle['focus'] =
    actionCount > thinkCount * 1.4 ? 'execution'
    : thinkCount > actionCount * 1.4 ? 'strategy'
    : 'balanced'

  return {
    pace,
    tone,
    focus,
    inferredAt: Date.now(),
    sampleSize: userMessages.length,
  }
}

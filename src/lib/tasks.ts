/**
 * Tasks system.
 *
 * The founder's todos, surfaced on the Landing "Today" panel and tracked
 * through the Friday check-in flow. Tasks come from three places:
 *
 *   1. Auto-generated from a `plan90` or `strategy` artifact via the
 *      "Convert to tasks" button. We try a fast regex parser first; if
 *      it returns too few candidates we fall back to a single LLM call.
 *   2. Manually from a chat message ("Add to tasks" button on every
 *      user and assistant bubble). The user types a one-line summary.
 *   3. Manually from the Today widget ("Add task" inline composer).
 *
 * Schema: `db.tasks` (Dexie). See `db.ts` for the `Task` interface and
 * version 2 migration that introduces it.
 */

import { nanoid } from 'nanoid'
import { z } from 'zod'
import { generateText } from 'ai'
import { db, type Task, type Artifact, type Settings } from './db'
import { getModel, type ProviderId } from './providers'

// ---------------------------------------------------------------------------
// Week math
// ---------------------------------------------------------------------------

/**
 * Return the Monday-anchored timestamp (00:00 local) for the week containing
 * `d`. Weeks start on Monday so Friday check-ins feel natural.
 */
export function weekStart(d: Date = new Date()): number {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  // getDay() returns 0 (Sun) - 6 (Sat); we want Monday = 0
  const dow = (out.getDay() + 6) % 7
  out.setDate(out.getDate() - dow)
  return out.getTime()
}

export function weekEnd(weekStartTs: number): number {
  return weekStartTs + 7 * 24 * 60 * 60 * 1000
}

/** Add `n` weeks to a Monday-anchored timestamp. */
export function addWeeks(weekStartTs: number, n: number): number {
  return weekStartTs + n * 7 * 24 * 60 * 60 * 1000
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export interface AddTaskInput {
  title: string
  description?: string
  source?: Task['source']
  sourceId?: string
  conversationId?: string
  artifactId?: string
  messageId?: string
  dueAt?: number
  weekOf?: number
  notes?: string
  proposedStrategy?: Task['proposedStrategy']
}

/** Create a new task. Returns the inserted record. */
export async function addTask(input: AddTaskInput): Promise<Task> {
  const task: Task = {
    id: nanoid(12),
    title: input.title.trim(),
    description: input.description?.trim() || undefined,
    source: input.source || 'manual',
    sourceId: input.sourceId,
    conversationId: input.conversationId,
    artifactId: input.artifactId,
    messageId: input.messageId,
    dueAt: input.dueAt,
    weekOf: input.weekOf ?? (input.dueAt ? weekStart(new Date(input.dueAt)) : weekStart()),
    status: 'open',
    createdAt: Date.now(),
    notes: input.notes,
    proposedStrategy: input.proposedStrategy,
  }
  await db.tasks.put(task)
  return task
}

/** Mark a task as done. */
export async function completeTask(id: string): Promise<void> {
  await db.tasks.update(id, { status: 'done', completedAt: Date.now() })
}

/** Drop a task (kept for the history, marked as not done). */
export async function dropTask(id: string, reason?: string): Promise<void> {
  await db.tasks.update(id, {
    status: 'dropped',
    notes: reason ? `${reason}${reason.endsWith('.') ? '' : '.'}` : undefined,
  })
}

/** Re-open a task that was previously done or dropped. */
export async function reopenTask(id: string): Promise<void> {
  await db.tasks.update(id, { status: 'open', completedAt: undefined })
}

/** Bulk delete (used by the "clear completed" button). */
export async function deleteTasks(ids: string[]): Promise<void> {
  await db.tasks.bulkDelete(ids)
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** All open tasks for a given week (Monday-anchored). */
export async function tasksForWeek(weekStartTs: number): Promise<Task[]> {
  const all = await db.tasks.toArray()
  return all
    .filter((t) => t.weekOf === weekStartTs && t.status === 'open')
    .sort((a, b) => {
      // Sort by dueAt first (earlier first), then by createdAt
      if (a.dueAt && b.dueAt) return a.dueAt - b.dueAt
      if (a.dueAt) return -1
      if (b.dueAt) return 1
      return a.createdAt - b.createdAt
    })
}

/** Open tasks that are past their dueAt. */
export async function overdueTasks(): Promise<Task[]> {
  const now = Date.now()
  const all = await db.tasks.toArray()
  return all
    .filter((t) => t.status === 'open' && t.dueAt && t.dueAt < now)
    .sort((a, b) => (a.dueAt || 0) - (b.dueAt || 0))
}

/** Open tasks due in the next 7 days (for the Today panel "this week" view). */
export async function tasksThisWeek(weekStartTs: number = weekStart()): Promise<Task[]> {
  const end = weekEnd(weekStartTs)
  const all = await db.tasks.toArray()
  return all
    .filter(
      (t) =>
        t.status === 'open' &&
        ((t.weekOf !== undefined && t.weekOf >= weekStartTs && t.weekOf < end) ||
          (t.dueAt !== undefined && t.dueAt < end))
    )
    .sort((a, b) => {
      if (a.dueAt && b.dueAt) return a.dueAt - b.dueAt
      if (a.dueAt) return -1
      if (b.dueAt) return 1
      return a.createdAt - b.createdAt
    })
}

/** Tasks completed within a week — used for the Friday check-in "shipped" step. */
export async function completedInWeek(weekStartTs: number): Promise<Task[]> {
  const end = weekEnd(weekStartTs)
  const all = await db.tasks.toArray()
  return all.filter(
    (t) =>
      (t.status === 'done' || t.status === 'dropped') &&
      t.completedAt !== undefined &&
      t.completedAt >= weekStartTs &&
      t.completedAt < end
  )
}

/** Did every open task for this week just get cleared? Used for the confetti. */
export function isWeekJustCleared(openTasks: Task[]): boolean {
  // Caller is expected to compare this snapshot with the previous one.
  // The Today panel uses a useEffect on openTasks.length; if it goes from
  // N>0 to 0, confetti fires.
  return openTasks.length === 0
}

// ---------------------------------------------------------------------------
// Artifact → tasks: regex pass + LLM fallback
// ---------------------------------------------------------------------------

export interface ProposedTask {
  /** Imperative form, e.g. "Ship the onboarding email" */
  title: string
  /** 1-12 for plan90 weeks, undefined for general */
  week?: number
  /** Optional context — usually a short note from the source section */
  context?: string
}

export type ProposeStrategy = 'regex' | 'llm-fallback' | 'empty'

export interface ProposeResult {
  strategy: ProposeStrategy
  tasks: ProposedTask[]
  /** Why we ended up with this strategy (regex hit / fell back / nothing matched). */
  reason?: string
}

/**
 * Top-level entry point. Tries the regex pass first; if it returns
 * <2 tasks or the source has no recognizable structure, fires one LLM
 * call to extract 5-15 concrete tasks. Caches the result on the
 * artifact so we don't re-prompt every click.
 */
export async function proposeTasksFromArtifact(
  artifact: Artifact,
  settings: Settings
): Promise<ProposeResult> {
  // Cache check
  const cached = (artifact as any).proposedTasks as
    | { strategy: ProposeStrategy; tasks: ProposedTask[]; ts: number }
    | undefined
  if (cached && cached.tasks && cached.tasks.length > 0) {
    return { strategy: cached.strategy, tasks: cached.tasks, reason: 'cached' }
  }

  const regexResult = regexProposeTasks(artifact)
  if (regexResult.tasks.length >= 2) {
    const out: ProposeResult = { strategy: 'regex', tasks: regexResult.tasks, reason: regexResult.reason }
    await cacheProposedTasks(artifact.id, out)
    return out
  }

  // Fallback: try the LLM. If the user is on browser-ai or has no key,
  // return the (possibly empty) regex result.
  if (settings.defaultProvider === 'browser-ai' || !settings.defaultProvider || !settings.defaultModel) {
    return { strategy: 'regex', tasks: regexResult.tasks, reason: 'no-llm-available' }
  }
  try {
    const llmTasks = await llmProposeTasks(artifact, settings)
    if (llmTasks.length === 0) {
      return { strategy: 'regex', tasks: regexResult.tasks, reason: 'llm-returned-empty' }
    }
    const out: ProposeResult = { strategy: 'llm-fallback', tasks: llmTasks, reason: 'regex-sparse' }
    await cacheProposedTasks(artifact.id, out)
    return out
  } catch (e: any) {
    return { strategy: 'regex', tasks: regexResult.tasks, reason: `llm-failed:${e?.message || e}` }
  }
}

async function cacheProposedTasks(artifactId: string, result: ProposeResult) {
  try {
    await db.artifacts.update(artifactId, {
      proposedTasks: { strategy: result.strategy, tasks: result.tasks, ts: Date.now() } as any,
    })
  } catch {
    // non-fatal — cache is best-effort
  }
}

// ---------------------------------------------------------------------------
// Regex pass
// ---------------------------------------------------------------------------

const BULLET_RE = /^\s*[-*+]\s+(.+?)\s*$/

interface Section { heading: string; bullets: string[]; week?: number }

/** Split a markdown document into sections keyed by heading. */
function splitSections(content: string): Section[] {
  if (!content) return []
  const sections: Section[] = []
  let current: Section = { heading: '', bullets: [] }
  const lines = content.split('\n')
  for (const line of lines) {
    const headingMatch = /^\s*#{1,4}\s+(.+?)\s*$/.exec(line)
    if (headingMatch) {
      sections.push(current)
      current = { heading: headingMatch[1], bullets: [] }
      continue
    }
    const bulletMatch = BULLET_RE.exec(line)
    if (bulletMatch) {
      current.bullets.push(bulletMatch[1].trim())
    }
  }
  sections.push(current)
  // Drop the leading pre-heading preamble
  return sections.filter((s) => s.heading)
}

/** Pull a "Week N" number from a heading. Returns undefined if not a week. */
function weekOfHeading(heading: string): number | undefined {
  const m = /week\s+(\d{1,2})\b/i.exec(heading)
  if (!m) return undefined
  const n = parseInt(m[1], 10)
  return n >= 1 && n <= 52 ? n : undefined
}

/**
 * Heuristic: which section headings look like they hold actionable tasks?
 * - "Week N" — always actionable
 * - "12-month bets" / "Bets" / "Top 3 bets" — yes
 * - "Top 3 risks" — usually NOT actionable (they're risk-callouts)
 * - "Definition of done" — sometimes actionable if the founder
 *   hasn't completed them yet
 */
const TASKY_HEADING_HINTS = [
  /\bbets?\b/i,
  /\bnext\s+steps?\b/i,
  /\baction\s*items?\b/i,
  /\bto[\s-]?dos?\b/i,
  /\btasks?\b/i,
  /\bdo\s+this/i,
  /\bthis\s+week\b/i,
  /\bimmediately\b/i,
]

function isTaskyHeading(heading: string): boolean {
  return TASKY_HEADING_HINTS.some((re) => re.test(heading))
}

/**
 * Tidy a bullet into a clean task title. Strips trailing punctuation,
 * leading "X:" labels, and markdown emphasis.
 */
function cleanBullet(bullet: string): string {
  return bullet
    .replace(/\*\*([^*]+)\*\*:?\s*/g, '$1 ') // **Bold**: text
    .replace(/^[-*+\d.\s)]+/, '')               // list markers
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.;:]$/, '')
}

function regexProposeTasks(artifact: Artifact): { tasks: ProposedTask[]; reason: string } {
  const sections = splitSections(artifact.content)
  if (sections.length === 0) return { tasks: [], reason: 'no-sections' }

  const tasks: ProposedTask[] = []

  // First pass: every "Week N" section. These are the clearest signal.
  let weekHit = 0
  for (const sec of sections) {
    const w = weekOfHeading(sec.heading)
    if (w !== undefined && sec.bullets.length > 0) {
      weekHit++
      for (const b of sec.bullets) {
        const title = cleanBullet(b)
        if (title.length >= 3) {
          tasks.push({ title, week: w, context: `Week ${w}` })
        }
      }
    }
  }
  if (weekHit >= 2) {
    return { tasks, reason: `week-sections:${weekHit}` }
  }

  // Second pass: artifact type-specific sections.
  const type = artifact.type
  if (type === 'strategy' || type === 'plan90') {
    for (const sec of sections) {
      if (isTaskyHeading(sec.heading) && sec.bullets.length > 0) {
        for (const b of sec.bullets) {
          const title = cleanBullet(b)
          if (title.length >= 3) {
            tasks.push({ title, context: sec.heading })
          }
        }
      }
    }
    if (tasks.length > 0) {
      return { tasks, reason: `tasky-sections:${type}` }
    }
  }

  // Third pass: any section with >=2 bullets.
  for (const sec of sections) {
    if (sec.bullets.length >= 2) {
      for (const b of sec.bullets) {
        const title = cleanBullet(b)
        if (title.length >= 3) {
          tasks.push({ title, context: sec.heading })
        }
      }
    }
  }
  return { tasks, reason: tasks.length > 0 ? 'any-bullets' : 'empty' }
}

// ---------------------------------------------------------------------------
// LLM fallback
// ---------------------------------------------------------------------------

const ProposedTaskSchema = z.object({
  title: z.string().min(3).max(140),
  week: z.number().int().min(1).max(52).optional(),
  context: z.string().max(120).optional(),
})

const ProposeResponseSchema = z.object({
  tasks: z.array(ProposedTaskSchema).min(1).max(20),
})

async function llmProposeTasks(artifact: Artifact, settings: Settings): Promise<ProposedTask[]> {
  const provider = settings.defaultProvider as ProviderId
  const modelId = settings.defaultModel
  let model: any
  try {
    model = await getModel(provider, modelId)
  } catch {
    return []
  }

  const stripped = (artifact.content || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 6000)

  const systemPrompt = [
    'You extract concrete, actionable tasks from a founder\'s business document.',
    'Given the document below, return JSON only, no commentary.',
    'Each task MUST be a short imperative (start with a verb), 4-12 words,',
    'and represent something the founder can do THIS WEEK (not a vague aspiration).',
    'Skip generic advice. Skip items already in the past. Skip duplicates.',
    'For 90-day plans, include the week number (1-12) each task belongs to.',
    'For strategy docs, omit the week field.',
    '',
    'Return schema:',
    '{ "tasks": [{ "title": "Ship the onboarding email", "week": 1, "context": "definition of done" }] }',
  ].join('\n')

  const userPrompt = [
    `TYPE: ${artifact.type}`,
    `TITLE: ${artifact.title}`,
    '',
    'CONTENT:',
    stripped,
  ].join('\n')

  try {
    const { text } = await generateText({
      model,
      system: systemPrompt,
      prompt: userPrompt,
      temperature: 0.3,
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(20_000),
    })
    // Find the JSON in the response (model sometimes wraps in fences)
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) return []
    const parsed = ProposeResponseSchema.safeParse(JSON.parse(match[0]))
    if (!parsed.success) return []
    return parsed.data.tasks
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// Commit proposed tasks
// ---------------------------------------------------------------------------

/** Convert proposed tasks into Task rows. Returns the created tasks. */
export async function commitProposedTasks(
  artifact: Artifact,
  proposed: ProposedTask[]
): Promise<number> {
  let count = 0
  const source: Task['source'] = artifact.type === 'plan90' ? 'plan90' : 'strategy'
  for (const p of proposed) {
    const dueAt = p.week ? weekEnd(addWeeks(weekStart(), p.week - 1)) : undefined
    const weekOf = p.week ? addWeeks(weekStart(), p.week - 1) : weekStart()
    await addTask({
      title: p.title,
      description: p.context,
      source,
      sourceId: artifact.id,
      artifactId: artifact.id,
      dueAt,
      weekOf,
      proposedStrategy: 'regex',
    })
    count++
  }
  return count
}

// ---------------------------------------------------------------------------
// Auto-detect chip on chat messages (manual fallback)
// ---------------------------------------------------------------------------

/** Does this user message look like it has a task buried in it? Used for
 *  the future "want to add this to your tasks?" chip — not used right now
 *  (the "Add to tasks" button is always shown per the user's decision). */
export function looksLikeATask(text: string): boolean {
  if (!text) return false
  const t = text.trim().toLowerCase()
  return (
    /\b(i['']ll|i will|i need to|i must|i should|this week i|by friday|by monday|by next)\b/.test(t) ||
    /\b(remember to|don['']t forget|todo:|to-do:|action item)\b/.test(t)
  )
}

// ---------------------------------------------------------------------------
// Reschedule helpers (used by the Friday check-in flow)
// ---------------------------------------------------------------------------

/** Move all incomplete tasks for `fromWeek` to `toWeek` (preserving order). */
export async function carryOverIncomplete(fromWeek: number, toWeek: number): Promise<number> {
  const all = await db.tasks.toArray()
  const carry = all.filter((t) => t.weekOf === fromWeek && t.status === 'open')
  for (const t of carry) {
    const newDue = t.dueAt ? t.dueAt + (toWeek - fromWeek) : undefined
    await db.tasks.update(t.id, { weekOf: toWeek, dueAt: newDue })
  }
  return carry.length
}

// ---------------------------------------------------------------------------
// Display helpers (used in TodayPanel + TaskCard)
// ---------------------------------------------------------------------------

export function dueLabel(t: Task, now: number = Date.now()): string {
  if (t.status === 'done') {
    return t.completedAt ? `Done ${relativeShort(t.completedAt, now)}` : 'Done'
  }
  if (t.status === 'dropped') return 'Dropped'
  if (!t.dueAt) return 'This week'
  const diff = t.dueAt - now
  const days = Math.round(diff / (24 * 60 * 60 * 1000))
  if (diff < 0) {
    const overdueBy = Math.abs(days)
    if (overdueBy === 0) return 'Overdue today'
    return `Overdue ${overdueBy}d`
  }
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  if (days < 7) return `In ${days} days`
  return new Date(t.dueAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function relativeShort(ts: number, now: number = Date.now()): string {
  const diff = now - ts
  const min = Math.floor(diff / 60_000)
  if (min < 1) return 'now'
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  if (day < 7) return `${day}d ago`
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function sourceLabel(t: Task): { label: string; color: string } {
  switch (t.source) {
    case 'plan90':
      return { label: 'Plan', color: 'text-sky-700 dark:text-sky-300 bg-sky-500/15' }
    case 'strategy':
      return { label: 'Strategy', color: 'text-violet-700 dark:text-violet-300 bg-violet-500/15' }
    case 'chat':
      return { label: 'Chat', color: 'text-emerald-700 dark:text-emerald-300 bg-emerald-500/15' }
    case 'review':
      return { label: 'Review', color: 'text-amber-700 dark:text-amber-300 bg-amber-500/15' }
    case 'manual':
    default:
      return { label: 'Manual', color: 'text-fg-muted bg-bg-muted' }
  }
}

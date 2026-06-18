import { Link, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Conversation } from '@/lib/db'
import { ARTIFACT_LIST } from '@/lib/artifacts'
import { MessageSquare, ArrowRight, Library, Plus } from 'lucide-react'
import { useMemo, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { HatchWordmark } from '@/components/HatchWordmark'
import { AmbientAurora } from '@/components/AmbientAurora'
import { ParticleField } from '@/components/ParticleField'
import { TodayPanel } from '@/components/TodayPanel'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Stage-aware quick prompts
// ---------------------------------------------------------------------------

const STAGE_PROMPTS: Record<string, [string, string, string]> = {
  idea:       ["What should I build first?", "Help me validate this idea fast", "Write a landing page headline"],
  validating: ["How do I find my first 10 users?", "Write a cold outreach script", "What's the fastest validation experiment?"],
  building:   ["Help me prioritize this week", "Review my MVP scope", "What am I missing before launch?"],
  launched:   ["How do I grow to 100 users?", "Help me improve retention", "Review my pricing model"],
  growing:    ["What's my next growth lever?", "Help me think about scaling", "Where am I leaving money on the table?"],
}
const DEFAULT_PROMPTS: [string, string, string] = [
  "What should I focus on this week?",
  "Help me think through my biggest blocker",
  "Draft a quick strategy for the next 30 days",
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function calcStreak(conversations: Conversation[]): number {
  if (!conversations.length) return 0
  const activeDays = new Set(conversations.map((c) => new Date(c.updatedAt).toDateString()))
  const today = new Date()
  const startOffset = activeDays.has(today.toDateString()) ? 0 : 1
  let streak = 0
  for (let i = startOffset; i < 365; i++) {
    const d = new Date()
    d.setDate(today.getDate() - i)
    if (activeDays.has(d.toDateString())) streak++
    else break
  }
  return streak
}

function calcWeekOfJourney(conversations: Conversation[]): number {
  if (!conversations.length) return 0
  const first = Math.min(...conversations.map((c) => c.createdAt))
  return Math.floor((Date.now() - first) / (7 * 24 * 60 * 60 * 1000)) + 1
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function greeting(): string {
  const h = new Date().getHours()
  if (h < 5)  return 'Still up'
  if (h < 12) return 'Morning'
  if (h < 17) return 'Afternoon'
  if (h < 22) return 'Evening'
  return 'Still up'
}

function stageLabel(s: string): string {
  return { idea: '💡 Idea', validating: '🔍 Validating', building: '🔨 Building', launched: '🚀 Launched', growing: '📈 Growing' }[s] ?? s
}

const fadeUp = (i: number) => ({
  initial: { opacity: 0, y: 18 },
  animate: { opacity: 1, y: 0 },
  transition: { delay: i * 0.09, duration: 0.38, ease: [0.16, 1, 0.3, 1] },
})

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function Landing() {
  const company          = useLiveQuery(() => db.company.get('singleton'), [])
  const artifactCount    = useLiveQuery(() => db.artifacts.count(), []) || 0
  const conversations    = useLiveQuery(() => db.conversations.orderBy('updatedAt').reverse().toArray(), []) || []
  const recentArtifacts  = useLiveQuery(() => db.artifacts.orderBy('updatedAt').reverse().limit(3).toArray(), []) || []

  const conversationCount = conversations.length
  const lastConvo         = conversations[0] ?? null
  const streak            = useMemo(() => calcStreak(conversations), [conversations])
  const weekOfJourney     = useMemo(() => calcWeekOfJourney(conversations), [conversations])
  const isNew             = conversationCount === 0
  const stage             = company?.stage
  const prompts: [string, string, string] = (stage && STAGE_PROMPTS[stage]) ?? DEFAULT_PROMPTS

  return (
    <div className="relative flex-1 overflow-y-auto">
      <AmbientAurora intensity={2} color="orange" />
      <div className="pointer-events-none absolute inset-0 opacity-[0.04] bg-dot-grid bg-dot-grid" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-96">
        <ParticleField count={20} color="orange" energy={1} />
      </div>

      <div className="relative mx-auto flex min-h-full max-w-3xl flex-col gap-10 px-6 pb-24 pt-12">

        {/* Wordmark */}
        <motion.div {...fadeUp(0)}>
          <HatchWordmark size={28} />
        </motion.div>

        {/* Hero */}
        <motion.section {...fadeUp(1)} className="flex flex-col gap-4">
          <div>
            <p className="text-sm font-medium text-fg-muted">{greeting()}</p>
            <h1 className="mt-1 font-serif text-4xl font-medium leading-tight tracking-tight md:text-5xl">
              {company?.name
                ? <>{isNew ? 'Welcome to ' : 'Building '}<em className="text-accent not-italic">{company.name}</em>.</>
                : isNew ? "Let's start building." : "Back at it."
              }
            </h1>
          </div>

          {/* Momentum badges */}
          <div className="flex flex-wrap gap-2">
            {streak > 0 && (
              <motion.span
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ type: 'spring', stiffness: 400, damping: 18, delay: 0.25 }}
                className="inline-flex items-center gap-1.5 rounded-full border border-accent/25 bg-accent/[0.08] px-3 py-1 text-xs font-semibold text-accent"
              >
                🔥 {streak}-day streak
              </motion.span>
            )}
            {weekOfJourney > 0 && (
              <span className="inline-flex items-center rounded-full border border-border bg-bg-subtle/60 px-3 py-1 text-xs text-fg-muted">
                Week {weekOfJourney}
              </span>
            )}
            {stage && stage !== 'idea' && (
              <span className="inline-flex items-center rounded-full border border-border bg-bg-subtle/60 px-3 py-1 text-xs text-fg-muted">
                {stageLabel(stage)}
              </span>
            )}
            {!streak && isNew && (
              <span className="inline-flex items-center rounded-full border border-border bg-bg-subtle/60 px-3 py-1 text-xs text-fg-subtle">
                Day 1 — start your streak
              </span>
            )}
          </div>
        </motion.section>

        {/* Primary action */}
        <motion.section {...fadeUp(2)} className="flex flex-col gap-3">
          {isNew ? (
            <FirstTimeCard stage={stage} />
          ) : (
            lastConvo && <ContinueCard convo={lastConvo} />
          )}

          {/* Secondary nav row */}
          <div className="flex flex-wrap gap-2">
            {!isNew && (
              <Link
                to="/chat"
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-bg-subtle/60 px-4 py-2 text-sm font-medium text-fg-muted transition hover:bg-bg-muted hover:text-fg"
              >
                <Plus className="h-3.5 w-3.5" />
                New conversation
              </Link>
            )}
            {artifactCount > 0 && (
              <Link
                to="/library"
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-bg-subtle/60 px-4 py-2 text-sm font-medium text-fg-muted transition hover:bg-bg-muted hover:text-fg"
              >
                <Library className="h-3.5 w-3.5" />
                Library · {artifactCount} {artifactCount === 1 ? 'artifact' : 'artifacts'}
              </Link>
            )}
          </div>
        </motion.section>

        {/* Quick prompts */}
        <motion.section {...fadeUp(3)}>
          <QuickPrompts prompts={prompts} />
        </motion.section>

        {/* Today panel */}
        <motion.section {...fadeUp(4)}>
          <SectionLabel>This week</SectionLabel>
          <div className="mt-3">
            <TodayPanel />
          </div>
        </motion.section>

        {/* Recent work */}
        {recentArtifacts.length > 0 && (
          <motion.section {...fadeUp(5)}>
            <div className="flex items-center justify-between">
              <SectionLabel>Recent work</SectionLabel>
              <Link to="/library" className="text-xs text-fg-muted transition hover:text-fg">
                See all →
              </Link>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {recentArtifacts.map((a) => {
                const meta = ARTIFACT_LIST.find((al) => al.type === a.type)
                return (
                  <Link
                    key={a.id}
                    to="/library"
                    className="group flex flex-col gap-2 rounded-2xl border border-border bg-bg-subtle/40 p-4 transition hover:border-accent/25 hover:bg-bg-subtle"
                  >
                    <div className="text-xl">{meta?.emoji ?? '📄'}</div>
                    <div>
                      <div className="truncate text-sm font-medium text-fg">{a.title}</div>
                      <div className="mt-0.5 text-[11px] text-fg-subtle">{timeAgo(a.updatedAt)}</div>
                    </div>
                  </Link>
                )
              })}
            </div>
          </motion.section>
        )}

        {/* Momentum stats — bottom, minimal */}
        {!isNew && (
          <motion.section {...fadeUp(6)} className="flex flex-wrap gap-3 border-t border-border-subtle pt-8">
            <StatPill label="Conversations" value={conversationCount} />
            <StatPill label="Artifacts" value={artifactCount} />
            {streak > 1 && <StatPill label="Day streak" value={streak} highlight />}
          </motion.section>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ContinueCard({ convo }: { convo: Conversation }) {
  return (
    <Link
      to="/chat"
      className="group block overflow-hidden rounded-2xl border border-border bg-bg-subtle/60 p-5 transition hover:border-accent/30 hover:bg-bg-subtle hover:shadow-glow"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[11px] text-fg-subtle">
            <MessageSquare className="h-3 w-3" />
            <span>Continue</span>
            <span className="opacity-40">·</span>
            <span>{timeAgo(convo.updatedAt)}</span>
            <span className="opacity-40">·</span>
            <span>{convo.messageCount} {convo.messageCount === 1 ? 'message' : 'messages'}</span>
          </div>
          <h3 className="mt-1.5 truncate text-base font-semibold text-fg">
            {convo.title || 'Untitled conversation'}
          </h3>
        </div>
        <div className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-xl bg-accent/10 text-accent transition group-hover:bg-accent group-hover:text-accent-fg">
          <ArrowRight className="h-5 w-5 transition group-hover:translate-x-0.5" />
        </div>
      </div>
    </Link>
  )
}

function FirstTimeCard({ stage }: { stage?: string }) {
  return (
    <Link
      to="/chat"
      className="group block overflow-hidden rounded-2xl border border-accent/25 bg-accent/[0.06] p-6 transition hover:bg-accent/[0.1] hover:shadow-glow"
    >
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-widest text-accent/70">Your AI Cofounder is ready</p>
          <h3 className="mt-1.5 text-lg font-semibold text-fg">
            {stage === 'idea' && "Start with your idea — what are you building?"}
            {stage === 'validating' && "Let's figure out how to validate this fast."}
            {stage === 'building' && "What's blocking you right now?"}
            {stage === 'launched' && "Great — how do we grow from here?"}
            {(!stage || stage === 'idea') && "Ask me anything — I'll remember everything."}
          </h3>
          <p className="mt-1 text-sm text-fg-muted">
            Start your first conversation →
          </p>
        </div>
        <div className="grid h-12 w-12 flex-shrink-0 place-items-center rounded-2xl bg-accent text-accent-fg text-2xl transition group-hover:scale-105">
          🚀
        </div>
      </div>
    </Link>
  )
}

function QuickPrompts({ prompts }: { prompts: [string, string, string] }) {
  const navigate = useNavigate()

  const go = (prompt: string) => {
    navigate('/chat', { state: { prefill: prompt } })
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-subtle">Quick start</p>
      <div className="flex flex-wrap gap-2">
        {prompts.map((p) => (
          <button
            key={p}
            onClick={() => go(p)}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-bg-subtle/60 px-4 py-2 text-sm text-fg-muted transition hover:border-fg/15 hover:bg-bg-muted hover:text-fg"
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  )
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-subtle">{children}</p>
  )
}

function StatPill({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className={cn(
      'inline-flex items-baseline gap-1.5 rounded-full px-4 py-1.5 text-sm',
      highlight
        ? 'border border-accent/25 bg-accent/[0.08] text-accent'
        : 'border border-border bg-bg-subtle/60 text-fg-muted'
    )}>
      <span className="text-base font-semibold tabular-nums">{value}</span>
      <span className="text-xs opacity-70">{label}</span>
    </div>
  )
}

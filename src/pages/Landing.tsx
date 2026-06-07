import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/lib/db'
import { AGENT_LIST } from '@/lib/agents'
import { ARTIFACT_LIST } from '@/lib/artifacts'
import { MessageSquare, Sparkles, ArrowRight, Brain, Library, Zap, Shield, Globe, Check } from 'lucide-react'
import { useEffect, useState } from 'react'
import { HatchWordmark } from '@/components/HatchWordmark'
import { AmbientAurora } from '@/components/AmbientAurora'
import { ParticleField } from '@/components/ParticleField'
import { CountUp } from '@/components/CountUp'

export function Landing() {
  const company = useLiveQuery(() => db.company.get('singleton'), [])
  const artifactCount = useLiveQuery(() => db.artifacts.count(), []) || 0
  const conversationCount = useLiveQuery(() => db.conversations.count(), []) || 0
  const [now, setNow] = useState(new Date())

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])

  const greeting = greetingForTime(now)

  return (
    <div className="relative flex-1 overflow-y-auto">
      {/* Ambient backdrop */}
      <AmbientAurora intensity={2} color="orange" />
      <div className="pointer-events-none absolute inset-0 opacity-[0.04] bg-dot-grid bg-dot-grid" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[420px]">
        <ParticleField count={26} color="orange" energy={1} />
      </div>

      <div className="relative mx-auto flex min-h-full max-w-5xl flex-col px-6 pb-20 pt-16">
        {/* Hero */}
        <section className="flex flex-col items-start">
          <HatchWordmark size={64} className="mb-8" />

          <div className="flex items-center gap-2 text-[11px] font-medium text-fg-muted">
            <span className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-success" />
            <span>Your data stays in this browser. Always.</span>
          </div>

          <h1 className="mt-6 max-w-3xl font-serif text-5xl font-medium leading-[1.05] tracking-tight text-balance md:text-6xl">
            {greeting}
            {company?.name ? <> — let's hatch <em className="text-accent not-italic">{company.name}</em></> : <> — let's hatch your idea</>}.
          </h1>

          <p className="mt-5 max-w-2xl text-lg text-fg-muted text-pretty">
            Hatch is a team of four AI cofounders that actually know your business. They remember what you said last week, draft real artifacts, and never let a week slip by without a plan.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              to="/chat"
              className="group inline-flex items-center gap-2 rounded-2xl bg-accent px-5 py-3 text-sm font-medium text-accent-fg shadow-soft transition hover:shadow-glow focus-ring"
            >
              <MessageSquare className="h-4 w-4" />
              <span>Start a conversation</span>
              <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
            </Link>
            <Link
              to="/library"
              className="inline-flex items-center gap-2 rounded-2xl border border-border bg-bg-subtle px-5 py-3 text-sm font-medium text-fg transition hover:bg-bg-muted focus-ring"
            >
              <Library className="h-4 w-4" />
              <span>Browse artifacts</span>
            </Link>
          </div>

          {/* Stats strip */}
          <div className="mt-12 grid w-full max-w-3xl grid-cols-3 gap-3">
            <StatCard label="Conversations" value={conversationCount} numeric />
            <StatCard label="Artifacts saved" value={artifactCount} numeric />
            <StatCard label="This week" value={weekTag(now)} />
          </div>
        </section>

        {/* Your team */}
        <section className="mt-24">
          <SectionHeader eyebrow="Your team" title="Four cofounders, one shared memory" />
          <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {AGENT_LIST.map((a) => (
              <div
                key={a.id}
                className="group relative flex flex-col rounded-2xl border border-border bg-bg-subtle/40 p-5 transition hover:border-border hover:bg-bg-subtle"
              >
                <div
                  className="grid h-10 w-10 place-items-center rounded-xl text-lg"
                  style={{
                    backgroundColor: `hsl(var(--agent-${a.color}) / 0.15)`,
                    color: `hsl(var(--agent-${a.color}))`,
                  }}
                >
                  {a.emoji}
                </div>
                <h3 className="mt-4 text-base font-semibold">{a.name}</h3>
                <p className="mt-1 text-xs uppercase tracking-wider text-fg-subtle">{a.role}</p>
                <p className="mt-3 text-sm text-fg-muted text-pretty">{a.description}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Features */}
        <section className="mt-24">
          <SectionHeader eyebrow="What makes Hatch different" title="Built for founders, not for demos" />
          <div className="mt-6 grid gap-3 md:grid-cols-2">
            <Feature
              icon={Brain}
              title="Persistent memory"
              description="Hatch remembers your business, your goals, your last decision. Every conversation starts where the last one left off."
            />
            <Feature
              icon={Library}
              title="Real artifacts"
              description="Strategy docs, 90-day plans, landing copy, pricing models, pitch outlines — saved to your library, not lost in chat."
            />
            <Feature
              icon={Globe}
              title="Web search baked in"
              description="The team can look up current pricing, competitors, and news — and cite what they found."
            />
            <Feature
              icon={Zap}
              title="Latency-masked UX"
              description="Rotating verbs, status pipelines, smooth streaming. The AI feels alive even when it's thinking."
            />
            <Feature
              icon={Shield}
              title="100% client-side"
              description="No server. No account. Your data lives in your browser, encrypted with your passphrase."
            />
            <Feature
              icon={Sparkles}
              title="BYOK, multi-provider"
              description="Bring your own key from OpenAI, Anthropic, NVIDIA NIM, or any OpenAI-compatible service. Or use your browser's free built-in AI."
            />
          </div>
        </section>

        {/* Artifact types */}
        <section className="mt-24">
          <SectionHeader eyebrow="Artifact library" title="Things you can hatch today" />
          <div className="mt-6 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {ARTIFACT_LIST.map((a) => (
              <div
                key={a.type}
                className="group flex flex-col rounded-xl border border-border bg-bg-subtle/40 p-4 transition hover:border-border hover:bg-bg-subtle"
              >
                <div className="text-2xl">{a.emoji}</div>
                <h4 className="mt-2 text-sm font-semibold">{a.name}</h4>
                <p className="mt-1 text-xs text-fg-muted text-pretty">{a.description}</p>
              </div>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section className="mt-24">
          <div className="overflow-hidden rounded-3xl border border-border bg-gradient-to-br from-bg-subtle via-bg to-bg-subtle p-8 md:p-12">
            <div className="max-w-2xl">
              <h2 className="font-serif text-3xl font-medium tracking-tight md:text-4xl">
                Ready to hatch something?
              </h2>
              <p className="mt-3 text-fg-muted">
                Start with a single question. Hatch will figure out the rest.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Link
                  to="/chat"
                  className="inline-flex items-center gap-2 rounded-2xl bg-accent px-5 py-3 text-sm font-medium text-accent-fg transition hover:shadow-glow focus-ring"
                >
                  Open the chat
                  <ArrowRight className="h-4 w-4" />
                </Link>
                <Link
                  to="/settings"
                  className="inline-flex items-center gap-2 rounded-2xl border border-border bg-bg px-5 py-3 text-sm font-medium transition hover:bg-bg-muted focus-ring"
                >
                  Set up your providers
                </Link>
              </div>
              <ul className="mt-6 grid gap-1.5 text-sm text-fg-muted sm:grid-cols-2">
                {[
                  'No signup',
                  'No credit card',
                  'Free in-browser model',
                  'Open source',
                ].map((b) => (
                  <li key={b} className="flex items-center gap-2">
                    <Check className="h-3.5 w-3.5 text-success" />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}

function SectionHeader({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">{eyebrow}</div>
      <h2 className="mt-2 font-serif text-3xl font-medium tracking-tight md:text-4xl text-balance">{title}</h2>
    </div>
  )
}

function StatCard({ label, value, numeric = false }: { label: string; value: any; numeric?: boolean }) {
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-border bg-bg-subtle/40 p-4 transition hover:border-accent/30 hover:bg-bg-subtle">
      <div className="text-2xl font-semibold tabular-nums">
        {numeric ? <CountUp value={typeof value === 'number' ? value : 0} /> : value}
      </div>
      <div className="mt-1 text-[11px] uppercase tracking-wider text-fg-subtle">{label}</div>
      <div className="pointer-events-none absolute -right-6 -top-6 h-16 w-16 rounded-full bg-accent/10 opacity-0 blur-2xl transition group-hover:opacity-100" />
    </div>
  )
}

function Feature({ icon: Icon, title, description }: { icon: any; title: string; description: string }) {
  return (
    <div className="flex gap-3 rounded-2xl border border-border bg-bg-subtle/40 p-5">
      <div className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-xl bg-accent/10 text-accent">
        <Icon className="h-4 w-4" />
      </div>
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="mt-1 text-sm text-fg-muted text-pretty">{description}</p>
      </div>
    </div>
  )
}

function greetingForTime(d: Date): string {
  const h = d.getHours()
  if (h < 5) return 'Up late'
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  if (h < 22) return 'Good evening'
  return 'Up late'
}

function weekTag(d: Date): string {
  const onejan = new Date(d.getFullYear(), 0, 1)
  const week = Math.ceil((((d.getTime() - onejan.getTime()) / 86400000) + onejan.getDay() + 1) / 7)
  return `W${week}`
}

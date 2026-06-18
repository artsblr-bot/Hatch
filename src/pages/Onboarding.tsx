import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { motion, AnimatePresence } from 'framer-motion'
import { db, updateSettings, updateCompany } from '@/lib/db'
import { generateDataKey, wrapKeyWithPassphrase, setUnlockedKey, hashPassphrase, encrypt } from '@/lib/crypto'
import { useToast } from '@/components/Toast'
import { FloatingMark } from '@/components/FloatingMark'
import { AmbientAurora } from '@/components/AmbientAurora'
import { ParticleField } from '@/components/ParticleField'
import { WordmarkReveal } from '@/components/WordmarkReveal'
import { ConfettiBurst } from '@/components/ConfettiBurst'
import { useCelebrate } from '@/components/Celebration'
import { cn } from '@/lib/utils'

// Idea-first ordering: we let the founder talk about what they're building
// (the thing they actually want to do) *before* asking for a password. Value
// before commitment — reciprocity beats friction-first every time.
const STEPS = [
  { id: 'welcome', label: 'Welcome' },
  { id: 'business', label: 'Your idea' },
  { id: 'vault',   label: 'Password' },
  { id: 'engine',  label: 'AI engine' },
  { id: 'ready',   label: 'Ready' },
]

// Direction-aware slide variants — forward = slide right-to-left, back = left-to-right
const slideVariants = {
  enter: (dir: number) => ({ opacity: 0, x: dir * 42 }),
  center: { opacity: 1, x: 0, transition: { duration: 0.26, ease: [0.16, 1, 0.3, 1] } },
  exit: (dir: number) => ({ opacity: 0, x: dir * -28, transition: { duration: 0.18, ease: 'easeIn' } }),
}

export function Onboarding() {
  const settings = useLiveQuery(() => db.settings.get('singleton'), [])
  const [step, setStep] = useState(0)
  const [direction, setDirection] = useState(1)
  const [dek, setDek] = useState<CryptoKey | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    if (settings?.hasOnboarded) navigate('/')
  }, [settings?.hasOnboarded, navigate])

  if (!settings) return null

  const next = () => { setDirection(1);  setStep((s) => Math.min(STEPS.length - 1, s + 1)) }
  const prev = () => { setDirection(-1); setStep((s) => Math.max(0, s - 1)) }

  // Endowed-progress effect: the bar is never empty — you're "already on your
  // way" from step one, which measurably lifts completion.
  const progress = (step + 1) / STEPS.length

  return (
    <div className="relative grid min-h-screen place-items-center overflow-hidden bg-bg px-4 py-8 text-fg">
      <AmbientAurora intensity={2} color="orange" />
      <div className="pointer-events-none absolute inset-0 opacity-[0.04] bg-dot-grid" />

      <div className="relative w-full max-w-2xl">
        {/* Progress bar + step counter — hairline rule */}
        <div className="mb-7 flex items-center gap-4">
          <div className="flex-1 overflow-hidden rounded-full bg-border-subtle h-px">
            <motion.div
              className="h-full rounded-full bg-accent"
              animate={{ width: `${progress * 100}%` }}
              transition={{ type: 'spring', stiffness: 120, damping: 20 }}
            />
          </div>
          <span className="flex-shrink-0 text-[11px] uppercase tracking-[0.18em] tabular-nums text-fg-subtle">
            {step + 1} / {STEPS.length}
          </span>
        </div>

        {/* Step card — calm cream editorial surface */}
        <div className="relative overflow-hidden rounded-3xl border border-border bg-bg shadow-soft">
          <AnimatePresence mode="wait" custom={direction}>
            <motion.div
              key={step}
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              className="p-8 sm:p-10"
            >
              {step === 0 && <WelcomeStep onNext={next} />}
              {step === 1 && <BusinessStep onNext={next} onBack={prev} />}
              {step === 2 && (
                <VaultStep onNext={(key) => { setDek(key); next() }} onBack={prev} />
              )}
              {step === 3 && <EngineStep dek={dek!} onNext={next} onBack={prev} />}
              {step === 4 && (
                <ReadyStep
                  onDone={async () => {
                    await updateSettings({ hasOnboarded: true })
                    navigate('/')
                  }}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Shared icons
// ---------------------------------------------------------------------------

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" className="mt-0.5 h-4 w-4 flex-shrink-0 text-success" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}
function ArrowRightIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  )
}
function ArrowLeftIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="12 19 5 12 12 5" />
    </svg>
  )
}

function PrimaryBtn({
  onClick, disabled, children,
}: { onClick?: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <motion.button
      onClick={onClick}
      disabled={disabled}
      whileTap={disabled ? {} : { scale: 0.94 }}
      transition={{ type: 'spring', stiffness: 500, damping: 22 }}
      className="inline-flex items-center gap-1.5 rounded-2xl bg-accent px-5 py-2.5 text-sm font-medium text-accent-fg transition hover:shadow-glow focus-ring disabled:opacity-50"
    >
      {children}
    </motion.button>
  )
}

function SecondaryBtn({ onClick, children }: { onClick?: () => void; children: ReactNode }) {
  return (
    <motion.button
      onClick={onClick}
      whileTap={{ scale: 0.96 }}
      className="inline-flex items-center gap-1.5 rounded-2xl px-4 py-2 text-sm text-fg-muted transition hover:bg-bg-muted focus-ring"
    >
      {children}
    </motion.button>
  )
}

// ---------------------------------------------------------------------------
// Step 0 — Welcome
// ---------------------------------------------------------------------------

const BULLET_ITEMS = [
  { strong: 'No account needed.', rest: ' Everything runs in your browser — nothing goes to our servers.' },
  { strong: '100% private.', rest: ' Your data is encrypted and stored only on this device.' },
  { strong: 'Free to start.', rest: ' Connect a free API key from NVIDIA or Groq and you\'re off.' },
]

function WelcomeStep({ onNext }: { onNext: () => void }) {
  return (
    <div>
      {/* Logo with spring entrance */}
      <div className="relative">
        <div className="absolute -inset-10 -z-10">
          <ParticleField count={16} color="orange" energy={1} />
        </div>
        <motion.div
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 260, damping: 18, delay: 0.05 }}
        >
          <FloatingMark size={64} halo breathe float />
        </motion.div>
      </div>

      {/* Headline */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.12, duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      >
        <p className="mt-6 text-[11px] uppercase tracking-[0.18em] text-accent">Welcome</p>
        <h1 className="mt-2 font-serif text-4xl font-medium tracking-tight">
          Hi. I'm <WordmarkReveal text="hatch" size={36} highlight="text-accent" />.
        </h1>
        <p className="mt-3 text-fg-muted text-pretty">
          Your AI cofounder — strategy, product, marketing, and finance. I remember everything, draft real documents, and keep you moving week by week.
        </p>
      </motion.div>

      {/* Setup time badge */}
      <motion.div
        initial={{ opacity: 0, scale: 0.85 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.22, type: 'spring', stiffness: 300, damping: 20 }}
        className="mt-5 inline-flex items-center gap-1.5 rounded-full border border-border bg-bg-subtle/60 px-3 py-1 text-[11px] text-fg-muted"
      >
        ⏱ Takes about 2 minutes
      </motion.div>

      {/* Staggered bullet points */}
      <ul className="mt-5 space-y-2.5 text-sm text-fg-muted">
        {BULLET_ITEMS.map((item, i) => (
          <motion.li
            key={i}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.28 + i * 0.1, duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
            className="flex items-start gap-2.5"
          >
            <CheckIcon />
            <span><strong className="text-fg">{item.strong}</strong>{item.rest}</span>
          </motion.li>
        ))}
      </ul>

      <div className="mt-8 flex justify-end">
        <motion.button
          onClick={onNext}
          whileTap={{ scale: 0.94 }}
          whileHover={{ scale: 1.02 }}
          transition={{ type: 'spring', stiffness: 400, damping: 20 }}
          // Idle pulse to draw the eye
          animate={{ boxShadow: [
            '0 0 0 0 hsl(var(--accent)/0)',
            '0 0 0 8px hsl(var(--accent)/0.15)',
            '0 0 0 0 hsl(var(--accent)/0)',
          ]}}
          style={{ animationIterationCount: 'infinite' }}
          className="inline-flex items-center gap-1.5 rounded-2xl bg-accent px-5 py-2.5 text-sm font-medium text-accent-fg focus-ring"
        >
          Let's go
          <ArrowRightIcon />
        </motion.button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step 1 — Vault
// ---------------------------------------------------------------------------

const STRENGTH_CONFIG = {
  none:   { bars: [false, false, false], label: '',        color: 'bg-border' },
  weak:   { bars: [true,  false, false], label: 'Too short', color: 'bg-danger' },
  ok:     { bars: [true,  true,  false], label: 'Good',    color: 'bg-warning' },
  strong: { bars: [true,  true,  true],  label: 'Strong',  color: 'bg-success' },
}

function VaultStep({ onNext, onBack }: { onNext: (dek: CryptoKey) => void; onBack: () => void }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)
  const [working, setWorking] = useState(false)
  const toast = useToast()

  const mismatch = confirm.length > 0 && password !== confirm
  const canProceed = password.length >= 6 && password === confirm

  const strengthKey: keyof typeof STRENGTH_CONFIG =
    password.length === 0 ? 'none'
    : password.length < 6 ? 'weak'
    : password.length < 10 ? 'ok'
    : 'strong'

  const sc = STRENGTH_CONFIG[strengthKey]

  const setup = async () => {
    if (!canProceed) return
    setWorking(true)
    try {
      const dek = await generateDataKey()
      setUnlockedKey(dek)
      const wrap = await wrapKeyWithPassphrase(dek, password)
      await db.passphraseWrap.put({ id: 'singleton', wrap, createdAt: Date.now() })
      const ph = await hashPassphrase(password)
      await updateSettings({ hasSetPassphrase: true, passphraseHash: ph })
      onNext(dek)
    } catch (e: any) {
      toast.error('Setup failed', e?.message)
    } finally {
      setWorking(false)
    }
  }

  return (
    <div>
      <p className="text-[11px] uppercase tracking-[0.18em] text-accent">Password</p>
      <div className="mt-3 flex items-center gap-3">
        <motion.div
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 300, damping: 18 }}
          className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl"
          style={{ background: 'hsl(var(--accent) / 0.12)', border: '1px solid hsl(var(--accent) / 0.28)' }}
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5 text-accent" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </motion.div>
        <div>
          <h2 className="font-serif text-3xl font-medium tracking-tight">Create a password</h2>
          <p className="text-sm text-fg-muted">Keeps your data private on this device.</p>
        </div>
      </div>

      <p className="mt-4 text-sm text-fg-muted">
        Everything in Hatch is locked with this password. If you forget it, you'll need to reset the app — so keep it somewhere safe.
      </p>

      <div className="mt-6 space-y-3">
        <div>
          <label className="text-sm font-medium">Password</label>
          <div className="relative mt-1.5">
            <input
              type={show ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 6 characters"
              autoComplete="new-password"
              autoFocus
              className="w-full rounded-xl border border-border bg-bg px-3 py-2.5 pr-10 text-sm focus:border-fg/20 focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
            <button type="button" tabIndex={-1} onClick={() => setShow((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-fg-subtle transition hover:text-fg">
              {show
                ? <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                : <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              }
            </button>
          </div>

          {/* Animated strength meter */}
          <AnimatePresence>
            {strengthKey !== 'none' && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="mt-2 flex items-center gap-2 overflow-hidden"
              >
                <div className="flex gap-0.5">
                  {sc.bars.map((filled, i) => (
                    <motion.div
                      key={i}
                      className={cn('h-1 w-7 rounded-full', filled ? sc.color : 'bg-border')}
                      initial={{ scaleX: 0 }}
                      animate={{ scaleX: filled ? 1 : 1 }}
                      transition={{ delay: i * 0.06, type: 'spring', stiffness: 300, damping: 22 }}
                    />
                  ))}
                </div>
                <span className="text-[11px] text-fg-subtle">{sc.label}</span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div>
          <label className="text-sm font-medium">Confirm password</label>
          <input
            type={show ? 'text' : 'password'}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && canProceed) setup() }}
            placeholder="Type it again"
            autoComplete="new-password"
            className={cn(
              'mt-1.5 w-full rounded-xl border bg-bg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 transition',
              mismatch ? 'border-danger/40 focus:ring-danger/20' : 'border-border focus:border-fg/20 focus:ring-accent/20'
            )}
          />
          <AnimatePresence>
            {mismatch && (
              <motion.p
                initial={{ opacity: 0, y: -3 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="mt-1 text-[11px] text-danger"
              >
                Passwords don't match
              </motion.p>
            )}
          </AnimatePresence>
        </div>
      </div>

      <div className="mt-8 flex justify-between">
        <SecondaryBtn onClick={onBack}><ArrowLeftIcon />Back</SecondaryBtn>
        <PrimaryBtn onClick={setup} disabled={!canProceed || working}>
          {working ? 'Setting up…' : 'Set my password'}
          <ArrowRightIcon />
        </PrimaryBtn>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step 2 — Business (Typeform-style)
// ---------------------------------------------------------------------------

const STAGE_OPTIONS = [
  { value: 'idea' as const,       emoji: '💡', label: 'Just an idea',  sub: 'Still figuring it out' },
  { value: 'validating' as const, emoji: '🔍', label: 'Validating',    sub: 'Testing if people want it' },
  { value: 'building' as const,   emoji: '🔨', label: 'Building',      sub: 'Actively making it' },
  { value: 'launched' as const,   emoji: '🚀', label: 'Already live',  sub: "It's out in the world" },
]

type Stage = typeof STAGE_OPTIONS[number]['value']

function BusinessStep({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const [q, setQ] = useState(0)
  const [qDir, setQDir] = useState(1)
  const [idea, setIdea] = useState('')
  const [icp, setIcp] = useState('')
  const [saving, setSaving] = useState(false)
  const toast = useToast()

  const advanceQ = (delta: number) => {
    setQDir(delta > 0 ? 1 : -1)
    setQ((v) => Math.max(0, Math.min(2, v + delta)))
  }

  const finish = async (stage: Stage) => {
    setSaving(true)
    try {
      await updateCompany({ idea: idea.trim(), icp: icp.trim(), stage })
      onNext()
    } catch (e: any) {
      toast.error('Save failed', e?.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-[0.18em] text-accent">Your idea</span>
        <span className="text-[11px] uppercase tracking-[0.18em] tabular-nums text-fg-subtle">{q + 1} of 3</span>
      </div>

      <AnimatePresence mode="wait" custom={qDir}>
        {q === 0 && (
          <motion.div key="q0" custom={qDir} variants={slideVariants} initial="enter" animate="center" exit="exit">
            <h2 className="mt-4 font-serif text-3xl font-medium tracking-tight">What are you building?</h2>
            <p className="mt-1 text-sm text-fg-muted">Raw is fine — no need for a perfect pitch.</p>
            <div className="relative mt-4">
              <textarea
                value={idea}
                onChange={(e) => setIdea(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); advanceQ(1) } }}
                rows={3}
                autoFocus
                placeholder="e.g. An app that helps freelancers send invoices without building a spreadsheet from scratch"
                className="w-full resize-none rounded-xl border border-border bg-bg px-3 py-2.5 pb-6 text-sm focus:border-fg/20 focus:outline-none focus:ring-2 focus:ring-accent/20"
              />
              {idea.length > 0 && (
                <div className="absolute bottom-2 right-3 text-[10px] text-fg-subtle">{idea.length}</div>
              )}
            </div>
            {/* Instant reflection — the cofounder reacting the moment there's
                something real to react to. A small, immediate reward that
                proves it's listening (and primes the "it remembers" promise). */}
            <AnimatePresence>
              {idea.trim().length >= 15 && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="mt-2.5 flex items-center gap-1.5 text-[11px] font-medium text-accent"
                >
                  <span className="grid h-3.5 w-3.5 place-items-center rounded-full bg-accent/15">
                    <svg viewBox="0 0 24 24" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </span>
                  Got it — I'll remember this.
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}

        {q === 1 && (
          <motion.div key="q1" custom={qDir} variants={slideVariants} initial="enter" animate="center" exit="exit">
            <h2 className="mt-4 font-serif text-3xl font-medium tracking-tight">Who is it for?</h2>
            <p className="mt-1 text-sm text-fg-muted">A job title, a type of person, or a specific situation.</p>
            <input
              value={icp}
              onChange={(e) => setIcp(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') advanceQ(1) }}
              autoFocus
              placeholder="e.g. Solo consultants who hate admin work"
              className="mt-4 w-full rounded-xl border border-border bg-bg px-3 py-2.5 text-sm focus:border-fg/20 focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
          </motion.div>
        )}

        {q === 2 && (
          <motion.div key="q2" custom={qDir} variants={slideVariants} initial="enter" animate="center" exit="exit">
            <h2 className="mt-4 font-serif text-3xl font-medium tracking-tight">What stage are you at?</h2>
            <p className="mt-1 text-sm text-fg-muted">Pick one to continue.</p>
            <div className="mt-4 grid grid-cols-2 gap-2.5">
              {STAGE_OPTIONS.map((opt, i) => (
                <motion.button
                  key={opt.value}
                  onClick={() => finish(opt.value)}
                  disabled={saving}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.07, type: 'spring', stiffness: 300, damping: 22 }}
                  whileHover={{ scale: 1.04, y: -2 }}
                  whileTap={{ scale: 0.96 }}
                  className="flex flex-col items-start gap-1 rounded-2xl border border-border bg-bg-subtle p-4 text-left transition hover:border-accent/40 hover:bg-accent/[0.08] disabled:opacity-60"
                >
                  <span className="text-2xl">{opt.emoji}</span>
                  <span className="text-sm font-semibold">{opt.label}</span>
                  <span className="text-xs text-fg-muted">{opt.sub}</span>
                </motion.button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="mt-8 flex items-center justify-between">
        <SecondaryBtn onClick={q === 0 ? onBack : () => advanceQ(-1)}>
          <ArrowLeftIcon />Back
        </SecondaryBtn>
        <div className="flex items-center gap-2">
          {q < 2 ? (
            <PrimaryBtn onClick={() => advanceQ(1)}>
              Continue <ArrowRightIcon />
            </PrimaryBtn>
          ) : (
            <button
              onClick={() => finish('idea')}
              disabled={saving}
              className="text-sm text-fg-muted transition hover:text-fg"
            >
              Skip →
            </button>
          )}
        </div>
      </div>
      {q < 2 && (
        <p className="mt-3 text-center text-[11px] text-fg-subtle">Press Enter to continue</p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step 3 — Engine
// ---------------------------------------------------------------------------

const PRIMARY_PROVIDERS = [
  { id: 'nvidia-nim' as const, name: 'NVIDIA NIM', desc: 'Llama 3.1 70B · 1,000 free requests/month', badge: 'Recommended', placeholder: 'nvapi-...', helpUrl: 'https://build.nvidia.com/explore/discover' },
  { id: 'groq' as const,       name: 'Groq',        desc: 'Llama 3.3 70B, very fast · Free to start',  badge: 'Free',        placeholder: 'gsk_...',    helpUrl: 'https://console.groq.com/keys' },
]
const MORE_PROVIDERS = [
  { id: 'anthropic' as const, name: 'Anthropic Claude', desc: 'Best for complex reasoning. Paid.', placeholder: 'sk-ant-...', helpUrl: 'https://console.anthropic.com/settings/keys' },
  { id: 'openai' as const,    name: 'OpenAI',            desc: 'GPT-4o, GPT-4.1. Paid.',            placeholder: 'sk-...',     helpUrl: 'https://platform.openai.com/api-keys' },
]

type ProviderId = 'nvidia-nim' | 'groq' | 'anthropic' | 'openai'

function EngineStep({ dek, onNext, onBack }: { dek: CryptoKey; onNext: () => void; onBack: () => void }) {
  const [provider, setProvider] = useState<ProviderId>('nvidia-nim')
  const [apiKey, setApiKey] = useState('')
  const [showMore, setShowMore] = useState(false)
  const [working, setWorking] = useState(false)
  const toast = useToast()

  useEffect(() => { setApiKey('') }, [provider])

  const allProviders = [...PRIMARY_PROVIDERS, ...MORE_PROVIDERS]
  const selected = allProviders.find((p) => p.id === provider)!

  const save = async () => {
    if (!apiKey.trim()) return
    setWorking(true)
    try {
      const providerId = provider === 'groq' ? 'openai-compatible' : provider
      const baseURL = provider === 'groq' ? 'https://api.groq.com/openai/v1' : undefined
      const model =
        provider === 'groq' ? 'llama-3.3-70b-versatile' :
        provider === 'anthropic' ? 'claude-3-5-haiku-latest' :
        provider === 'nvidia-nim' ? 'meta/llama-3.1-70b-instruct' :
        'gpt-4o-mini'
      const encrypted = await encrypt(dek, JSON.stringify({ apiKey: apiKey.trim(), baseURL, model }))
      await updateSettings({ defaultProvider: providerId, defaultModel: model, encryptedKeys: { [providerId]: encrypted } })
      onNext()
    } catch (e: any) {
      toast.error('Save failed', e?.message)
    } finally {
      setWorking(false)
    }
  }

  return (
    <div>
      <p className="text-[11px] uppercase tracking-[0.18em] text-accent">AI engine</p>
      <h2 className="mt-2 font-serif text-3xl font-medium tracking-tight">Choose your AI</h2>
      <p className="mt-1 text-sm text-fg-muted">You can switch any time in Settings.</p>

      <div className="mt-5 space-y-2">
        {PRIMARY_PROVIDERS.map((p, i) => (
          <motion.div
            key={p.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08, type: 'spring', stiffness: 300, damping: 22 }}
          >
            <ProviderRow {...p} selected={provider === p.id} onClick={() => setProvider(p.id)} />
          </motion.div>
        ))}
      </div>

      <button
        onClick={() => setShowMore((v) => !v)}
        className="mt-2 flex items-center gap-1.5 px-0.5 py-1.5 text-xs text-fg-muted transition hover:text-fg"
      >
        <svg viewBox="0 0 24 24" className={cn('h-3.5 w-3.5 transition-transform', showMore && 'rotate-90')} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 18 15 12 9 6" />
        </svg>
        {showMore ? 'Hide other options' : 'Use Anthropic or OpenAI instead'}
      </button>

      <AnimatePresence>
        {showMore && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="space-y-2 pb-1">
              {MORE_PROVIDERS.map((p) => (
                <ProviderRow key={p.id} {...p} selected={provider === p.id} onClick={() => setProvider(p.id)} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="mt-4">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium">API key for {selected.name}</label>
          <a href={selected.helpUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-fg-muted transition hover:text-fg">
            Get a free key →
          </a>
        </div>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && apiKey.trim()) save() }}
          placeholder={selected.placeholder}
          autoComplete="off"
          spellCheck={false}
          className="mt-1.5 w-full rounded-xl border border-border bg-bg px-3 py-2.5 text-sm focus:border-fg/20 focus:outline-none focus:ring-2 focus:ring-accent/20"
        />
      </div>

      <div className="mt-8 flex items-center justify-between">
        <SecondaryBtn onClick={onBack}><ArrowLeftIcon />Back</SecondaryBtn>
        <div className="flex items-center gap-3">
          <button onClick={onNext} className="text-sm text-fg-muted transition hover:text-fg">Set up later</button>
          <PrimaryBtn onClick={save} disabled={!apiKey.trim() || working}>
            {working ? 'Connecting…' : 'Connect'} <ArrowRightIcon />
          </PrimaryBtn>
        </div>
      </div>
    </div>
  )
}

function ProviderRow({ name, desc, badge, selected, onClick }: { name: string; desc: string; badge?: string; selected: boolean; onClick: () => void }) {
  return (
    <motion.div
      onClick={onClick}
      whileTap={{ scale: 0.98 }}
      className={cn(
        'cursor-pointer rounded-2xl border p-3.5 transition',
        selected ? 'border-accent/40 bg-accent/[0.08]' : 'border-border bg-bg-subtle hover:bg-bg-muted'
      )}
    >
      <div className="flex items-center gap-3">
        <div className={cn('grid h-4 w-4 flex-shrink-0 place-items-center rounded-full border-2 transition', selected ? 'border-accent bg-accent' : 'border-border')}>
          <AnimatePresence>
            {selected && (
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0 }}
                transition={{ type: 'spring', stiffness: 500, damping: 22 }}
                className="h-1.5 w-1.5 rounded-full bg-accent-fg"
              />
            )}
          </AnimatePresence>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{name}</span>
            {badge && <span className="rounded-full bg-success/15 px-1.5 py-0.5 text-[10px] font-medium text-success">{badge}</span>}
          </div>
          <p className="text-xs text-fg-muted">{desc}</p>
        </div>
      </div>
    </motion.div>
  )
}

// ---------------------------------------------------------------------------
// Step 4 — Ready (celebration)
// ---------------------------------------------------------------------------

function ReadyStep({ onDone }: { onDone: () => void }) {
  const company = useLiveQuery(() => db.company.get('singleton'), [])
  const { burst: fireBurst } = useCelebrate()
  const [burst, setBurst] = useState(false)

  useEffect(() => {
    // Peak-end: land the celebration the instant this step appears.
    const t = setTimeout(() => { setBurst(true); fireBurst('big') }, 380)
    return () => clearTimeout(t)
  }, [fireBurst])

  const idea = company?.idea?.trim()
  const icp = company?.icp?.trim()
  const stageOpt = STAGE_OPTIONS.find((s) => s.value === company?.stage)

  // Mirror the founder's own words back — making their investment visible is
  // what turns "I filled a form" into "it knows my business" (commitment +
  // the IKEA effect), and it proves the core promise: it remembers.
  const recap = [
    idea && { label: 'Building', value: idea },
    icp && { label: 'For', value: icp },
    stageOpt && { label: 'Stage', value: `${stageOpt.emoji} ${stageOpt.label}` },
  ].filter(Boolean) as { label: string; value: string }[]

  return (
    <div className="relative text-center">
      <ConfettiBurst active={burst} onDone={() => setBurst(false)} />

      {/* Logo spring entrance */}
      <motion.div
        initial={{ scale: 0.4, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 220, damping: 16 }}
        className="relative mx-auto inline-block"
      >
        <div className="absolute -inset-12 -z-10">
          <ParticleField count={22} color="orange" energy={2} />
        </div>
        <FloatingMark size={72} halo breathe />
      </motion.div>

      {/* Headline stagger */}
      <motion.p
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.14, duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
        className="mt-6 text-[11px] uppercase tracking-[0.18em] text-accent"
      >
        Day 1
      </motion.p>
      <motion.h1
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.18, duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
        className="mt-2 font-serif text-4xl font-medium tracking-tight"
      >
        {idea ? 'Your cofounder is awake.' : "You're ready."}
      </motion.h1>

      <motion.p
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.28, duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
        className="mx-auto mt-2 max-w-md text-fg-muted"
      >
        {idea
          ? 'It already knows what you’re building. Everything you tell it from here, it remembers — for good.'
          : 'Your AI cofounder is waiting. Let’s build something.'}
      </motion.p>

      {/* What it now remembers — the founder's own words, echoed back. */}
      {recap.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.36, duration: 0.34, ease: [0.16, 1, 0.3, 1] }}
          className="mx-auto mt-6 max-w-sm rounded-2xl border border-border bg-bg-subtle/50 p-4 text-left"
        >
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">In my memory</div>
          <dl className="mt-2.5 space-y-2">
            {recap.map((r) => (
              <div key={r.label} className="flex gap-3 text-sm">
                <dt className="w-14 flex-shrink-0 pt-px text-[11px] uppercase tracking-wider text-fg-subtle">{r.label}</dt>
                <dd className="line-clamp-2 flex-1 text-fg">{r.value}</dd>
              </div>
            ))}
          </dl>
        </motion.div>
      )}

      <motion.div
        initial={{ opacity: 0, scale: 0.85 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.48, type: 'spring', stiffness: 260, damping: 18 }}
        className="mt-8 flex justify-center"
      >
        <motion.button
          onClick={onDone}
          whileTap={{ scale: 0.94 }}
          whileHover={{ scale: 1.04 }}
          // Persistent pulse draws the eye to the CTA
          animate={{
            boxShadow: [
              '0 0 0 0 hsl(var(--accent)/0)',
              '0 0 0 10px hsl(var(--accent)/0.18)',
              '0 0 0 0 hsl(var(--accent)/0)',
            ],
          }}
          transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
          className="inline-flex items-center gap-2 rounded-2xl bg-accent px-7 py-3.5 text-sm font-semibold text-accent-fg focus-ring"
        >
          {idea ? 'Meet your cofounder' : 'Open the chat'} 🚀
        </motion.button>
      </motion.div>
    </div>
  )
}

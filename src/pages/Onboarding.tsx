import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { motion, AnimatePresence } from 'framer-motion'
import { db, updateSettings, updateCompany } from '@/lib/db'
import { detectBrowserAI } from '@/lib/providers'
import { generateDataKey, wrapKeyWithPassphrase, setUnlockedKey, hashPassphrase, encrypt } from '@/lib/crypto'
import { useToast } from '@/components/Toast'
import { FloatingMark } from '@/components/FloatingMark'
import { AmbientAurora } from '@/components/AmbientAurora'
import { ParticleField } from '@/components/ParticleField'
import { WordmarkReveal } from '@/components/WordmarkReveal'
import { cn } from '@/lib/utils'

const STEPS = [
  { id: 'welcome', label: 'Welcome' },
  { id: 'setup', label: 'Setup' },
  { id: 'business', label: 'Your business' },
  { id: 'ready', label: 'Ready' },
]

export function Onboarding() {
  const settings = useLiveQuery(() => db.settings.get('singleton'), [])
  const [step, setStep] = useState(0)
  const [browserAI, setBrowserAI] = useState<{ available: boolean; reason?: string } | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    detectBrowserAI().then(setBrowserAI)
  }, [])

  useEffect(() => {
    if (settings?.hasOnboarded) navigate('/')
  }, [settings?.hasOnboarded, navigate])

  if (!settings) return null

  const next = () => setStep((s) => Math.min(STEPS.length - 1, s + 1))
  const prev = () => setStep((s) => Math.max(0, s - 1))

  return (
    <div className="relative grid min-h-screen place-items-center overflow-hidden bg-bg px-4 py-8 text-fg">
      <AmbientAurora intensity={2} color="orange" />
      <div className="pointer-events-none absolute inset-0 opacity-[0.04] bg-dot-grid bg-dot-grid" />
      <div className="relative w-full max-w-2xl">
        <div className="mb-8 flex items-center justify-center gap-1.5">
          {STEPS.map((s, i) => (
            <div
              key={s.id}
              className={cn(
                'h-1 rounded-full transition-all duration-300',
                i === step ? 'w-8 bg-accent' : i < step ? 'w-4 bg-accent/40' : 'w-2 bg-border'
              )}
            />
          ))}
        </div>
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.2 }}
            className="rounded-3xl border border-border bg-bg-subtle/40 p-8 shadow-soft"
          >
            {step === 0 && <WelcomeStep onNext={next} browserAIAvailable={!!browserAI?.available} />}
            {step === 1 && <SetupStep onNext={next} onBack={prev} browserAIAvailable={!!browserAI?.available} />}
            {step === 2 && <BusinessStep onNext={next} onBack={prev} />}
            {step === 3 && (
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
  )
}

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

function WelcomeStep({ onNext, browserAIAvailable }: { onNext: () => void; browserAIAvailable: boolean }) {
  return (
    <div>
      <div className="relative">
        <div className="absolute -inset-10 -z-10">
          <ParticleField count={14} color="orange" energy={1} />
        </div>
        <FloatingMark size={64} halo breathe float />
      </div>
      <h1 className="mt-6 font-serif text-3xl font-medium tracking-tight">
        Hi. I'm <WordmarkReveal text="hatch" size={32} highlight="text-accent" />.
      </h1>
      <p className="mt-2 text-fg-muted text-pretty">
        I'm a team of four AI cofounders that actually know your business. I'll remember what you said last week, draft real artifacts, and never let a week slip by without a plan.
      </p>
      <ul className="mt-6 space-y-2.5 text-sm text-fg-muted">
        <li className="flex items-start gap-2.5">
          <CheckIcon />
          <span><strong className="text-fg">No signup, no credit card.</strong> {browserAIAvailable ? "You can chat with me right now, for free, using your browser's built-in AI." : 'Add a free key from Groq in 30 seconds and we are off.'}</span>
        </li>
        <li className="flex items-start gap-2.5">
          <CheckIcon />
          <span><strong className="text-fg">100% private.</strong> Your data stays in this browser. Encrypted with a passphrase only you know.</span>
        </li>
        <li className="flex items-start gap-2.5">
          <CheckIcon />
          <span><strong className="text-fg">BYOK.</strong> Bring your own key from OpenAI, Anthropic, NVIDIA NIM, or use the free in-browser model.</span>
        </li>
      </ul>
      <div className="mt-8 flex justify-end">
        <button
          onClick={onNext}
          className="inline-flex items-center gap-1.5 rounded-2xl bg-accent px-5 py-2.5 text-sm font-medium text-accent-fg transition hover:shadow-glow focus-ring"
        >
          Let's go
          <ArrowRightIcon />
        </button>
      </div>
    </div>
  )
}

function ProviderPick({
  selected,
  onClick,
  title,
  description,
  badge,
  needsKey,
  apiKey,
  onApiKey,
  helpUrl,
  keyPlaceholder,
}: {
  selected: boolean
  onClick: () => void
  title: string
  description: string
  badge?: string
  needsKey?: boolean
  apiKey?: string
  onApiKey?: (v: string) => void
  helpUrl?: string
  keyPlaceholder?: string
}) {
  return (
    <div
      onClick={onClick}
      className={cn(
        'cursor-pointer rounded-xl border p-3 transition',
        selected ? 'border-accent/40 bg-accent/10' : 'border-border bg-bg-subtle/30 hover:bg-bg-muted'
      )}
    >
      <div className="flex items-start gap-2.5">
        <div className={cn('mt-0.5 grid h-4 w-4 flex-shrink-0 place-items-center rounded-full border-2', selected ? 'border-accent bg-accent' : 'border-border')}>
          {selected && <div className="h-1.5 w-1.5 rounded-full bg-accent-fg" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <div className="text-sm font-medium">{title}</div>
            {badge && <span className="rounded-full bg-success/15 px-1.5 py-0.5 text-[10px] font-medium text-success">{badge}</span>}
          </div>
          <div className="text-xs text-fg-muted">{description}</div>
          {needsKey && selected && (
            <div className="mt-2 space-y-1" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center gap-2">
                <input
                  type="password"
                  value={apiKey || ''}
                  onChange={(e) => onApiKey?.(e.target.value)}
                  placeholder={keyPlaceholder || 'API key'}
                  autoComplete="off"
                  spellCheck={false}
                  className="flex-1 rounded-lg border border-border bg-bg px-2.5 py-1.5 text-xs placeholder:text-fg-subtle focus:border-fg/20 focus:outline-none focus:ring-2 focus:ring-accent/20"
                />
                {helpUrl && (
                  <a
                    href={helpUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[10px] text-fg-muted hover:text-fg"
                  >
                    Get key →
                  </a>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function SetupStep({ onNext, onBack, browserAIAvailable }: { onNext: () => void; onBack: () => void; browserAIAvailable: boolean }) {
  const [passphrase, setPassphrase] = useState('')
  const [confirm, setConfirm] = useState('')
  const [provider, setProvider] = useState<'browser-ai' | 'groq' | 'anthropic' | 'openai'>(
    browserAIAvailable ? 'browser-ai' : 'groq'
  )
  const [apiKey, setApiKey] = useState('')
  const [working, setWorking] = useState(false)
  const toast = useToast()

  const canProceed = passphrase.length >= 6 && passphrase === confirm

  const setup = async () => {
    setWorking(true)
    try {
      const dek = await generateDataKey()
      setUnlockedKey(dek)
      const wrap = await wrapKeyWithPassphrase(dek, passphrase)
      await db.passphraseWrap.put({ id: 'singleton', wrap, createdAt: Date.now() })
      const ph = await hashPassphrase(passphrase)

      let defaultProvider = 'browser-ai'
      let defaultModel = ''
      const encryptedKeys: Record<string, any> = {}
      if (provider !== 'browser-ai') {
        const providerId = provider === 'groq' ? 'openai-compatible' : provider
        const baseURL = provider === 'groq' ? 'https://api.groq.com/openai/v1' : undefined
        const model =
          provider === 'groq'
            ? 'llama-3.3-70b-versatile'
            : provider === 'anthropic'
            ? 'claude-3-5-haiku-latest'
            : 'gpt-4o-mini'
        defaultProvider = providerId
        defaultModel = model
        encryptedKeys[providerId] = await encrypt(
          dek,
          JSON.stringify({ apiKey: apiKey.trim(), baseURL, model })
        )
      }

      await updateSettings({
        hasSetPassphrase: true,
        passphraseHash: ph,
        defaultProvider,
        defaultModel,
        encryptedKeys,
      })
      onNext()
    } catch (e: any) {
      toast.error('Setup failed', e?.message)
    } finally {
      setWorking(false)
    }
  }

  return (
    <div>
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">
        <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2L4 6v6c0 5 3.5 9.5 8 10 4.5-.5 8-5 8-10V6l-8-4z" />
        </svg>
        <span>Vault & provider</span>
      </div>
      <h2 className="mt-2 font-serif text-2xl font-medium tracking-tight">Set up your vault and choose an AI</h2>
      <p className="mt-1 text-sm text-fg-muted">A passphrase encrypts everything. We can't recover it for you — write it down somewhere safe.</p>

      <div className="mt-6 space-y-3">
        <div>
          <label className="text-sm font-medium">Passphrase</label>
          <input
            type="password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            placeholder="At least 6 characters"
            autoComplete="new-password"
            className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm focus:border-fg/20 focus:outline-none focus:ring-2 focus:ring-accent/20"
          />
        </div>
        <div>
          <label className="text-sm font-medium">Confirm passphrase</label>
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Type it again"
            autoComplete="new-password"
            className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm focus:border-fg/20 focus:outline-none focus:ring-2 focus:ring-accent/20"
          />
          {confirm && passphrase !== confirm && (
            <div className="mt-1 text-[11px] text-danger">Passphrases don't match.</div>
          )}
        </div>
      </div>

      <div className="mt-6">
        <label className="text-sm font-medium">AI provider</label>
        <p className="mt-0.5 text-xs text-fg-muted">You can change this later in Settings.</p>
        <div className="mt-2 space-y-1.5">
          {browserAIAvailable && (
            <ProviderPick
              selected={provider === 'browser-ai'}
              onClick={() => setProvider('browser-ai')}
              title="Use my browser's built-in AI"
              description="Free, no key needed. Best for getting started."
              badge="Free"
            />
          )}
          <ProviderPick
            selected={provider === 'groq'}
            onClick={() => setProvider('groq')}
            title="Groq (free tier)"
            description="Llama 3.3 70B, very fast. Free to start."
            badge="Free"
            needsKey
            apiKey={apiKey}
            onApiKey={setApiKey}
            helpUrl="https://console.groq.com/keys"
            keyPlaceholder="gsk_..."
          />
          <ProviderPick
            selected={provider === 'anthropic'}
            onClick={() => setProvider('anthropic')}
            title="Anthropic Claude"
            description="Best long-form reasoning. Paid."
            needsKey
            apiKey={apiKey}
            onApiKey={setApiKey}
            helpUrl="https://console.anthropic.com/settings/keys"
            keyPlaceholder="sk-ant-..."
          />
          <ProviderPick
            selected={provider === 'openai'}
            onClick={() => setProvider('openai')}
            title="OpenAI"
            description="GPT-4o, GPT-4.1. Paid."
            needsKey
            apiKey={apiKey}
            onApiKey={setApiKey}
            helpUrl="https://platform.openai.com/api-keys"
            keyPlaceholder="sk-..."
          />
        </div>
      </div>

      <div className="mt-8 flex justify-between">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1.5 rounded-2xl px-4 py-2 text-sm text-fg-muted transition hover:bg-bg-muted focus-ring"
        >
          <ArrowLeftIcon />
          Back
        </button>
        <button
          onClick={setup}
          disabled={!canProceed || (provider !== 'browser-ai' && !apiKey.trim()) || working}
          className="inline-flex items-center gap-1.5 rounded-2xl bg-accent px-5 py-2.5 text-sm font-medium text-accent-fg transition hover:shadow-glow focus-ring disabled:opacity-50"
        >
          {working ? 'Setting up…' : 'Continue'}
          <ArrowRightIcon />
        </button>
      </div>
    </div>
  )
}

function BusinessStep({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const [name, setName] = useState('')
  const [oneLiner, setOneLiner] = useState('')
  const [icp, setIcp] = useState('')
  const [idea, setIdea] = useState('')
  const [saving, setSaving] = useState(false)
  const toast = useToast()

  const save = async () => {
    setSaving(true)
    try {
      await updateCompany({
        name: name.trim(),
        oneLiner: oneLiner.trim(),
        icp: icp.trim(),
        idea: idea.trim(),
      })
      onNext()
    } catch (e: any) {
      toast.error('Save failed', e?.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">
        <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1 .34-4.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2z" />
          <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0-.34-4.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2z" />
        </svg>
        <span>Your business</span>
      </div>
      <h2 className="mt-2 font-serif text-2xl font-medium tracking-tight">Tell me what you're building</h2>
      <p className="mt-1 text-sm text-fg-muted">This becomes part of Hatch's memory. You can edit it any time.</p>

      <div className="mt-6 space-y-3">
        <div>
          <label className="text-sm font-medium">Business name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Hatch"
            className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm focus:border-fg/20 focus:outline-none focus:ring-2 focus:ring-accent/20"
          />
        </div>
        <div>
          <label className="text-sm font-medium">One-liner</label>
          <input
            value={oneLiner}
            onChange={(e) => setOneLiner(e.target.value)}
            placeholder="A one-sentence pitch."
            className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm focus:border-fg/20 focus:outline-none focus:ring-2 focus:ring-accent/20"
          />
        </div>
        <div>
          <label className="text-sm font-medium">Ideal customer</label>
          <input
            value={icp}
            onChange={(e) => setIcp(e.target.value)}
            placeholder="Who is this for? Be specific."
            className="mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm focus:border-fg/20 focus:outline-none focus:ring-2 focus:ring-accent/20"
          />
        </div>
        <div>
          <label className="text-sm font-medium">The idea (longer)</label>
          <textarea
            value={idea}
            onChange={(e) => setIdea(e.target.value)}
            rows={4}
            placeholder="What is it, what problem does it solve, what's the insight?"
            className="mt-1 w-full resize-none rounded-xl border border-border bg-bg px-3 py-2 text-sm focus:border-fg/20 focus:outline-none focus:ring-2 focus:ring-accent/20"
          />
        </div>
      </div>

      <div className="mt-8 flex justify-between">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1.5 rounded-2xl px-4 py-2 text-sm text-fg-muted transition hover:bg-bg-muted focus-ring"
        >
          <ArrowLeftIcon />
          Back
        </button>
        <button
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-1.5 rounded-2xl bg-accent px-5 py-2.5 text-sm font-medium text-accent-fg transition hover:shadow-glow focus-ring disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Continue'}
          <ArrowRightIcon />
        </button>
      </div>
      <div className="mt-3 text-center text-[11px] text-fg-subtle">You can fill this out later — Hatch works either way.</div>
    </div>
  )
}

function ReadyStep({ onDone }: { onDone: () => void }) {
  return (
    <div className="text-center">
      <motion.div
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', damping: 18 }}
        className="relative mx-auto inline-block"
      >
        <div className="absolute -inset-12 -z-10">
          <ParticleField count={18} color="orange" energy={2} />
        </div>
        <FloatingMark size={64} halo breathe />
      </motion.div>
      <h1 className="mt-6 font-serif text-3xl font-medium tracking-tight">You're ready.</h1>
      <p className="mt-2 text-fg-muted">Time to start hatching.</p>
      <div className="mt-8 flex justify-center">
        <button
          onClick={onDone}
          className="inline-flex items-center gap-1.5 rounded-2xl bg-accent px-6 py-3 text-sm font-medium text-accent-fg transition hover:shadow-glow focus-ring"
        >
          Open the chat
          <ArrowRightIcon />
        </button>
      </div>
    </div>
  )
}

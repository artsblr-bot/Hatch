import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, ensureSettings, ensureCompany, resetAllData } from '@/lib/db'
import { unwrapKeyWithPassphrase, setUnlockedKey, isUnlocked, lock } from '@/lib/crypto'
import { useToast } from '@/components/Toast'
import { Eye, EyeOff, Sparkles, AlertTriangle, KeyRound, Trash2, Loader2 } from 'lucide-react'
import { motion } from 'framer-motion'
import { FloatingMark } from '@/components/FloatingMark'
import { AmbientAurora } from '@/components/AmbientAurora'
import { ParticleField } from '@/components/ParticleField'
import { cn } from '@/lib/utils'

const RESET_CONFIRM_PHRASE = 'RESET MY VAULT'

function vaultGreeting(): string {
  const h = new Date().getHours()
  if (h < 5) return 'Still building?'
  if (h < 12) return 'Good morning.'
  if (h < 17) return 'Good afternoon.'
  if (h < 20) return 'Good evening.'
  return 'Late night mode.'
}

export function Vault() {
  const settings = useLiveQuery(() => db.settings.get('singleton'), [])
  const wrap = useLiveQuery(() => db.passphraseWrap.get('singleton'), [])
  const [passphrase, setPassphrase] = useState('')
  const [show, setShow] = useState(false)
  const [unlocking, setUnlocking] = useState(false)
  const [showReset, setShowReset] = useState(false)
  const navigate = useNavigate()
  const toast = useToast()

  useEffect(() => {
    ;(async () => {
      await ensureSettings()
      await ensureCompany()
    })()
  }, [settings, wrap])

  useEffect(() => {
    if (isUnlocked()) {
      const target = settings?.hasOnboarded ? '/' : '/welcome'
      navigate(target, { replace: true })
    }
  }, [isUnlocked(), settings, navigate])

  const unlock = async () => {
    if (!passphrase) return
    setUnlocking(true)
    try {
      const w = await db.passphraseWrap.get('singleton')
      if (!w) {
        toast.error('No vault configured', 'Complete onboarding first.')
        setUnlocking(false)
        return
      }
      const key = await unwrapKeyWithPassphrase(w.wrap, passphrase)
      setUnlockedKey(key)
      toast.success('Vault unlocked')
      const target = settings?.hasOnboarded ? '/' : '/welcome'
      navigate(target, { replace: true })
    } catch (e) {
      toast.error('Wrong passphrase', 'Try again, or reset the vault below.')
    } finally {
      setUnlocking(false)
      setPassphrase('')
    }
  }

  return (
    <div className="relative grid min-h-screen place-items-center overflow-hidden bg-bg px-4 text-fg">
      <AmbientAurora intensity={2} color="orange" />
      <div className="pointer-events-none absolute inset-0 opacity-[0.04] bg-dot-grid bg-dot-grid" />
      <div className="pointer-events-none absolute inset-0">
        <ParticleField count={22} color="orange" energy={1} />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="relative w-full max-w-md rounded-3xl border border-border bg-bg-subtle/60 p-8 shadow-soft backdrop-blur"
      >
        <FloatingMark size={56} halo breathe float />
        <p className="mt-5 text-sm font-medium text-fg-muted">{vaultGreeting()}</p>
        <h1 className="mt-1 font-serif text-2xl font-medium tracking-tight">Welcome back.</h1>
        <p className="mt-1.5 text-sm text-fg-muted">
          Enter your password to pick up where you left off.
        </p>

        <div className="mt-6 space-y-3">
          <div className="relative">
            <input
              type={show ? 'text' : 'password'}
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && unlock()}
              placeholder="Your password"
              autoComplete="current-password"
              autoFocus
              className="w-full rounded-xl border border-border bg-bg px-3 py-2.5 pr-10 text-sm focus:border-fg/20 focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
            <button
              onClick={() => setShow((s) => !s)}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-fg-subtle hover:text-fg"
            >
              {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <button
            onClick={unlock}
            disabled={!passphrase || unlocking}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-accent-fg transition hover:shadow-glow focus-ring disabled:opacity-50"
          >
            {unlocking ? 'Opening your workspace…' : 'Enter →'}
          </button>
        </div>

        <div className="mt-6 border-t border-border pt-4">
          {!showReset ? (
            <button
              onClick={() => setShowReset(true)}
              className="inline-flex items-center gap-1.5 text-[12px] text-fg-muted transition hover:text-fg focus-ring rounded-md"
            >
              <KeyRound className="h-3.5 w-3.5" />
              Forgot your password?
            </button>
          ) : (
            <VaultResetPanel
              onCancel={() => setShowReset(false)}
              onResetDone={() => {
                // Belt-and-suspenders: keep the in-memory key clear after a wipe.
                lock()
                setPassphrase('')
                setShowReset(false)
                // Full reload lands on /welcome. App's ensureSettings() recreates
                // a fresh row with hasOnboarded: false, so Onboarding's full
                // 4-step wizard (passphrase + provider + business + ready) runs
                // as if this were the first launch.
                location.assign('/welcome')
              }}
            />
          )}
        </div>

        {!showReset && (
          <div className="mt-3 flex items-center gap-2 text-[11px] text-fg-subtle">
            <Sparkles className="h-3 w-3" />
            <span>Everything stays on your device. Private by design.</span>
          </div>
        )}
      </motion.div>
    </div>
  )
}

function VaultResetPanel({ onCancel, onResetDone }: { onCancel: () => void; onResetDone: () => void }) {
  const [confirm, setConfirm] = useState('')
  const [resetting, setResetting] = useState(false)
  const toast = useToast()
  const canSubmit = confirm.trim() === RESET_CONFIRM_PHRASE && !resetting

  const doReset = async () => {
    if (!canSubmit) return
    setResetting(true)
    try {
      // 1) Drop the in-memory DEK so any stale references from a prior unlock
      //    can't accidentally decrypt the freshly-empty DB.
      lock()
      // 2) Wipe IndexedDB (settings, passphraseWrap, company, conversations,
      //    messages, artifacts, memoryEvents, checkIns, tasks).
      await resetAllData()
      // 3) Reload to /welcome so React state, Dexie handles, and live queries
      //    re-initialize against a clean DB. App.tsx's ensureSettings() will
      //    see hasOnboarded: false and route into the 4-step Onboarding.
      toast.info('Vault reset', 'Setting things up fresh…')
      onResetDone()
    } catch (e: any) {
      setResetting(false)
      toast.error('Reset failed', e?.message || 'Try again.')
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      className="rounded-2xl border border-danger/40 bg-danger/5 p-4"
    >
      <div className="flex items-start gap-2.5">
        <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-danger" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-danger">Reset your vault</div>
          <p className="mt-1 text-[12px] leading-relaxed text-fg-muted">
            This <strong>permanently deletes</strong> every conversation, artifact, memory, and API key
            stored in this browser. There is no undo. After reset, Hatch will run the first-time
            setup so you can pick a new passphrase and start fresh.
          </p>

          <div className="mt-3 space-y-2">
            <label className="block text-[11px] font-medium text-fg-muted">
              Type <code className="rounded bg-danger/10 px-1 py-0.5 font-mono text-[10px] text-danger">{RESET_CONFIRM_PHRASE}</code> to confirm
            </label>
            <input
              type="text"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && canSubmit && doReset()}
              placeholder={RESET_CONFIRM_PHRASE}
              autoComplete="off"
              spellCheck={false}
              disabled={resetting}
              className={cn(
                'w-full rounded-lg border bg-bg px-2.5 py-1.5 text-sm placeholder:text-fg-subtle',
                'focus:border-fg/20 focus:outline-none focus:ring-2 focus:ring-danger/20',
                confirm && confirm.trim() !== RESET_CONFIRM_PHRASE
                  ? 'border-danger/40'
                  : 'border-border'
              )}
            />
          </div>

          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={doReset}
              disabled={!canSubmit}
              className="inline-flex items-center gap-1.5 rounded-lg bg-danger px-3 py-1.5 text-xs font-medium text-bg transition hover:bg-danger/90 focus-ring disabled:opacity-50"
            >
              {resetting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
              {resetting ? 'Erasing…' : 'Erase everything & start over'}
            </button>
            <button
              onClick={onCancel}
              disabled={resetting}
              className="rounded-lg px-3 py-1.5 text-xs text-fg-muted transition hover:bg-bg-muted focus-ring disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  )
}

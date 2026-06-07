import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, ensureSettings, ensureCompany } from '@/lib/db'
import { unwrapKeyWithPassphrase, setUnlockedKey, isUnlocked } from '@/lib/crypto'
import { useToast } from '@/components/Toast'
import { Eye, EyeOff, ArrowRight, Sparkles } from 'lucide-react'
import { motion } from 'framer-motion'
import { FloatingMark } from '@/components/FloatingMark'
import { AmbientAurora } from '@/components/AmbientAurora'
import { ParticleField } from '@/components/ParticleField'

export function Vault() {
  const settings = useLiveQuery(() => db.settings.get('singleton'), [])
  const wrap = useLiveQuery(() => db.passphraseWrap.get('singleton'), [])
  const [passphrase, setPassphrase] = useState('')
  const [show, setShow] = useState(false)
  const [unlocking, setUnlocking] = useState(false)
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
      toast.error('Wrong passphrase', 'Try again.')
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
        <h1 className="mt-5 font-serif text-2xl font-medium tracking-tight">Unlock your vault</h1>
        <p className="mt-1.5 text-sm text-fg-muted">
          Enter your passphrase to decrypt your business data, conversations, and artifacts.
        </p>

        <div className="mt-6 space-y-3">
          <div className="relative">
            <input
              type={show ? 'text' : 'password'}
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && unlock()}
              placeholder="Your passphrase"
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
            {unlocking ? 'Unlocking…' : 'Unlock'}
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-6 flex items-center gap-2 text-[11px] text-fg-subtle">
          <Sparkles className="h-3 w-3" />
          <span>Forgot it? Your data is unrecoverable. There is no reset.</span>
        </div>
      </motion.div>
    </div>
  )
}

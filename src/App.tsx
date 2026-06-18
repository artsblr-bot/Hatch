import { useEffect, useState } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, ensureSettings, ensureCompany } from './lib/db'
import { isUnlocked } from './lib/crypto'
import { ToastProvider } from './components/Toast'
import { FloatingMark } from './components/FloatingMark'
import { AmbientAurora } from './components/AmbientAurora'
import { Landing } from './pages/Landing'
import { ChatPage } from './pages/Chat'
import { Library } from './pages/Library'
import { Memory } from './pages/Memory'
import { SettingsPage } from './pages/Settings'
import { Onboarding } from './pages/Onboarding'
import { Vault } from './pages/Vault'
import { AppShell } from './components/AppShell'
import { CelebrationProvider } from './components/Celebration'
import { MilestoneWatcher } from './components/MilestoneWatcher'
import { setJuicePrefs } from './lib/juice'

function App() {
  const settings = useLiveQuery(() => db.settings.get('singleton'), [])
  // `?? null` distinguishes "still loading" (undefined) from "no passphrase
  // set" (null) — both are otherwise undefined, which would either flash
  // protected routes before the lock check or trap a no-passphrase user on the
  // boot screen forever.
  const hasPassphrase = useLiveQuery(() => db.passphraseWrap.get('singleton').then((r) => r ?? null), [])
  const [ready, setReady] = useState(false)
  const [unlocked, setUnlocked] = useState(isUnlocked())
  const location = useLocation()

  useEffect(() => {
    ;(async () => {
      await ensureSettings()
      await ensureCompany()
      setReady(true)
    })()
  }, [])

  // Track unlock state
  useEffect(() => {
    const id = setInterval(() => setUnlocked(isUnlocked()), 500)
    return () => clearInterval(id)
  }, [])

  // Mirror the user's "feel" preferences into the imperative juice layer so
  // haptics/sound/reduced-motion are available synchronously in hot paths.
  useEffect(() => {
    if (settings?.juice) setJuicePrefs(settings.juice)
  }, [settings?.juice?.sound, settings?.juice?.haptics, settings?.juice?.reducedMotion])

  // Apply theme
  useEffect(() => {
    if (!settings) return
    const root = document.documentElement
    if (settings.theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)')
      const apply = () => root.classList.toggle('dark', mq.matches)
      apply()
      mq.addEventListener('change', apply)
      return () => mq.removeEventListener('change', apply)
    } else {
      root.classList.toggle('dark', settings.theme === 'dark')
    }
  }, [settings?.theme])

  if (!ready || !settings || hasPassphrase === undefined) {
    return <BootScreen />
  }

  // First-run: show onboarding
  if (!settings.hasOnboarded) {
    if (location.pathname !== '/welcome') {
      return <Navigate to="/welcome" replace />
    }
  }

  // Vault: if user has set a passphrase but it's locked, require unlock
  if (hasPassphrase && !unlocked && location.pathname !== '/vault' && location.pathname !== '/welcome') {
    return <Navigate to="/vault" replace />
  }

  return (
    <ToastProvider>
      <CelebrationProvider>
        <MilestoneWatcher />
        <Routes>
          <Route path="/welcome" element={<Onboarding />} />
          <Route path="/vault" element={<Vault />} />
          <Route element={<AppShell />}>
            <Route path="/" element={<Landing />} />
            <Route path="/chat" element={<ChatPage />} />
            <Route path="/chat/:conversationId" element={<ChatPage />} />
            <Route path="/library" element={<Library />} />
            <Route path="/memory" element={<Memory />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </CelebrationProvider>
    </ToastProvider>
  )
}

function BootScreen() {
  return (
    <div className="relative grid min-h-screen place-items-center overflow-hidden bg-bg text-fg">
      <AmbientAurora intensity={2} />
      <div className="relative flex flex-col items-center gap-5">
        <FloatingMark size={72} halo breathe float />
        <div className="flex items-center gap-1.5">
          <div className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-accent" />
          <div className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-accent [animation-delay:200ms]" />
          <div className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-accent [animation-delay:400ms]" />
        </div>
      </div>
    </div>
  )
}

export default App

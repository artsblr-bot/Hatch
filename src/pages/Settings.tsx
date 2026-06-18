import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, updateSettings } from '@/lib/db'
import { PROVIDER_LIST, type ProviderId, testProviderConnection, detectBrowserAI, testWebSearch, type ProviderInfo } from '@/lib/providers'
import { encrypt, getUnlockedKey, isUnlocked, lock } from '@/lib/crypto'
import type { EncryptedEnvelope } from '@/lib/db'
import { useToast } from '@/components/Toast'
import { useNavigate } from 'react-router-dom'
import { Check, X, Eye, EyeOff, ExternalLink, Cpu, Lock, Unlock, Trash2, AlertTriangle, Download, Sun, Moon, Monitor, Globe, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { AGENTS } from '@/lib/agents'

export function SettingsPage() {
  const settings = useLiveQuery(() => db.settings.get('singleton'), [])
  const [vaultUnlocked, setVaultUnlocked] = useState(isUnlocked())
  const [browserAI, setBrowserAI] = useState<{ available: boolean; reason?: string; defaultModel?: string } | null>(null)
  const toast = useToast()
  const navigate = useNavigate()

  useEffect(() => {
    setVaultUnlocked(isUnlocked())
  }, [])

  useEffect(() => {
    if (settings) detectBrowserAI().then(setBrowserAI)
  }, [settings?.defaultProvider])

  if (!settings) return null

  const setProvider = async (id: ProviderId) => {
    const info = PROVIDER_LIST.find((p) => p.id === id)
    await updateSettings({
      defaultProvider: id,
      defaultModel: info?.defaultModel || settings.defaultModel,
    })
    if (id === 'browser-ai' && browserAI && !browserAI.available) {
      toast.warning('Browser AI not available', browserAI.reason)
    }
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="font-serif text-3xl font-medium tracking-tight">Settings</h1>
        <p className="mt-2 text-fg-muted">Configure your AI providers, search, vault, and personalization.</p>

        {/* Vault status */}
        <Section title="Vault" description="Your data is encrypted with your passphrase. We never see it.">
          {vaultUnlocked ? (
            <div className="flex items-center justify-between rounded-2xl border border-success/30 bg-success/5 p-4">
              <div className="flex items-center gap-3">
                <Unlock className="h-5 w-5 text-success" />
                <div>
                  <div className="text-sm font-medium">Vault is unlocked</div>
                  <div className="text-xs text-fg-muted">Your data is readable to this browser session.</div>
                </div>
              </div>
              <button
                onClick={() => {
                  lock()
                  setVaultUnlocked(false)
                  toast.info('Vault locked')
                  navigate('/vault')
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-bg-subtle px-3 py-1.5 text-xs font-medium transition hover:bg-bg-muted focus-ring"
              >
                <Lock className="h-3.5 w-3.5" />
                Lock now
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between rounded-2xl border border-warning/40 bg-warning/5 p-4">
              <div className="flex items-center gap-3">
                <Lock className="h-5 w-5 text-warning" />
                <div>
                  <div className="text-sm font-medium">Vault is locked</div>
                  <div className="text-xs text-fg-muted">Unlock to chat and use encrypted features.</div>
                </div>
              </div>
              <button
                onClick={() => navigate('/vault')}
                className="inline-flex items-center gap-1.5 rounded-lg bg-warning px-3 py-1.5 text-xs font-medium text-bg transition hover:bg-warning/90 focus-ring"
              >
                <Unlock className="h-3.5 w-3.5" />
                Unlock
              </button>
            </div>
          )}
        </Section>

        {/* Default provider */}
        <Section title="Default AI provider" description="Used when you start a new conversation. You can change per-message.">
          <div className="space-y-2">
            {PROVIDER_LIST.map((p) => {
              const hasKey = !!settings.encryptedKeys[p.id]
              const isActive = settings.defaultProvider === p.id
              const isBrowserAI = p.id === 'browser-ai'
              const isAvailable = isBrowserAI ? browserAI?.available : hasKey
              return (
                <ProviderRow
                  key={p.id}
                  info={p}
                  isActive={isActive}
                  isAvailable={!!isAvailable}
                  browserAIReason={isBrowserAI ? browserAI?.reason : undefined}
                  onSelect={() => setProvider(p.id)}
                />
              )
            })}
          </div>
        </Section>

        {/* Provider config */}
        <Section title="Provider keys" description="BYOK. Your key stays encrypted in this browser. We never see it.">
          <div className="space-y-3">
            {PROVIDER_LIST.filter((p) => p.needsApiKey).map((p) => (
              <ProviderKeyForm key={p.id} info={p} encryptedKey={settings.encryptedKeys[p.id]} hasPassphrase={settings.hasSetPassphrase} />
            ))}
          </div>
        </Section>

        {/* Search provider */}
        <Section title="Web search" description="Lets agents look up current information. BYOK for the high-limit tier.">
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              {[
                { id: 'duckduckgo', name: 'DuckDuckGo', hint: 'Free, no key' },
                { id: 'tavily', name: 'Tavily', hint: 'Agent-optimized' },
                { id: 'wikipedia', name: 'Wikipedia', hint: 'Knowledge' },
                { id: 'none', name: 'Off', hint: 'Disable search' },
              ].map((s) => (
                <button
                  key={s.id}
                  onClick={() => updateSettings({ searchProvider: s.id as any })}
                  className={cn(
                    'rounded-xl border p-3 text-left transition focus-ring',
                    settings.searchProvider === s.id
                      ? 'border-accent/40 bg-accent/10'
                      : 'border-border bg-bg-subtle/30 hover:bg-bg-muted'
                  )}
                >
                  <div className="text-sm font-medium">{s.name}</div>
                  <div className="text-[10px] text-fg-subtle">{s.hint}</div>
                </button>
              ))}
            </div>
            {settings.searchProvider === 'tavily' && (
              <TavilyKeyForm hasPassphrase={settings.hasSetPassphrase} encryptedKey={settings.encryptedKeys.tavily} />
            )}
            <SearchTester provider={settings.searchProvider} hasKey={!!settings.encryptedKeys.tavily} />
          </div>
        </Section>

        {/* Personalization: verb lists */}
        <Section title="Thinking verbs" description="Per-agent rotating words shown while the AI is working.">
          <div className="space-y-4">
            {Object.values(AGENTS).map((a) => (
              <VerbListEditor
                key={a.id}
                agent={a}
                verbs={settings.verbLists[a.id] ?? AGENTS.cofounder.verbs}
                onChange={(verbs) => updateSettings({ verbLists: { ...settings.verbLists, [a.id]: verbs } })}
              />
            ))}
          </div>
        </Section>

        {/* Appearance */}
        <Section title="Appearance">
          <div className="grid grid-cols-3 gap-2">
            {[
              { id: 'light', icon: Sun, label: 'Light' },
              { id: 'dark', icon: Moon, label: 'Dark' },
              { id: 'system', icon: Monitor, label: 'System' },
            ].map((t) => (
              <button
                key={t.id}
                onClick={() => updateSettings({ theme: t.id as any })}
                className={cn(
                  'flex items-center justify-center gap-2 rounded-xl border p-3 text-sm transition focus-ring',
                  settings.theme === t.id
                    ? 'border-accent/40 bg-accent/10'
                    : 'border-border bg-bg-subtle/30 hover:bg-bg-muted'
                )}
              >
                <t.icon className="h-4 w-4" />
                <span>{t.label}</span>
              </button>
            ))}
          </div>
        </Section>

        {/* Danger zone */}
        <Section title="Data" description="Export or delete everything you've stored in Hatch.">
          <div className="flex flex-wrap gap-2">
            <button
              onClick={async () => {
                const dump = {
                  version: 1,
                  exportedAt: Date.now(),
                  company: await db.company.get('singleton'),
                  conversations: await db.conversations.toArray(),
                  messages: await db.messages.toArray(),
                  artifacts: await db.artifacts.toArray(),
                  memoryEvents: await db.memoryEvents.toArray(),
                  checkIns: await db.checkIns.toArray(),
                  settings: await db.settings.get('singleton'),
                }
                const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' })
                const url = URL.createObjectURL(blob)
                const a = document.createElement('a')
                a.href = url
                a.download = `hatch-export-${new Date().toISOString().slice(0, 10)}.json`
                document.body.appendChild(a)
                a.click()
                document.body.removeChild(a)
                URL.revokeObjectURL(url)
                toast.success('Exported', 'Your data is in the downloads folder.')
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-bg-subtle px-3 py-2 text-sm transition hover:bg-bg-muted focus-ring"
            >
              <Download className="h-3.5 w-3.5" />
              Export all data
            </button>
            <button
              onClick={async () => {
                if (!confirm('Delete EVERYTHING? This cannot be undone.')) return
                await db.delete()
                location.reload()
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-danger/40 bg-danger/5 px-3 py-2 text-sm text-danger transition hover:bg-danger/10 focus-ring"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete everything
            </button>
          </div>
        </Section>

        <div className="mt-12 text-center text-xs text-fg-subtle">
          Hatch · Open source · Your data, your browser
        </div>
      </div>
    </div>
  )
}

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="text-base font-semibold">{title}</h2>
      {description && <p className="mt-0.5 text-sm text-fg-muted">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  )
}

function ProviderRow({ info, isActive, isAvailable, browserAIReason, onSelect }: { info: ProviderInfo; isActive: boolean; isAvailable: boolean; browserAIReason?: string; onSelect: () => void }) {
  return (
    <button
      onClick={onSelect}
      className={cn(
        'flex w-full items-start gap-3 rounded-2xl border p-4 text-left transition focus-ring',
        isActive ? 'border-accent/40 bg-accent/5' : 'border-border bg-bg-subtle/30 hover:bg-bg-muted'
      )}
    >
      <div className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-lg bg-bg-muted">
        <Cpu className="h-4 w-4 text-fg-muted" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <div className="text-sm font-medium">{info.name}</div>
          {isActive && <span className="rounded-full bg-accent/15 px-1.5 py-0.5 text-[10px] font-medium text-accent">default</span>}
          {info.isBrowserBuiltIn && (
            <span className="rounded-full bg-success/15 px-1.5 py-0.5 text-[10px] font-medium text-success">free</span>
          )}
        </div>
        <div className="mt-0.5 text-xs text-fg-muted">{info.description}</div>
        {info.freeTierNote && <div className="mt-1 text-[10px] text-fg-subtle">{info.freeTierNote}</div>}
        {browserAIReason && !isAvailable && (
          <div className="mt-1 flex items-center gap-1 text-[10px] text-warning">
            <AlertTriangle className="h-2.5 w-2.5" />
            {browserAIReason}
          </div>
        )}
      </div>
    </button>
  )
}

function ProviderKeyForm({ info, encryptedKey, hasPassphrase }: { info: ProviderInfo; encryptedKey?: EncryptedEnvelope; hasPassphrase: boolean }) {
  const [apiKey, setApiKey] = useState('')
  const [baseURL, setBaseURL] = useState('')
  const [model, setModel] = useState(info.defaultModel || '')
  const [show, setShow] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null)
  const toast = useToast()

  const save = async () => {
    if (!apiKey.trim()) {
      toast.error('API key required')
      return
    }
    const dek = getUnlockedKey()
    if (!dek) {
      toast.error('Vault is locked', 'Unlock in /vault first.')
      return
    }
    const envelope = await encrypt(dek, JSON.stringify({ apiKey: apiKey.trim(), baseURL: baseURL.trim() || undefined, model: model.trim() || undefined }))
    const settings = await db.settings.get('singleton')
    if (!settings) return
    await updateSettings({ encryptedKeys: { ...settings.encryptedKeys, [info.id]: envelope } })
    setApiKey('')
    setTestResult(null)
    toast.success('Key saved', `${info.name} is configured.`)
  }

  const remove = async () => {
    if (!confirm(`Remove ${info.name} key?`)) return
    const settings = await db.settings.get('singleton')
    if (!settings) return
    const next = { ...settings.encryptedKeys }
    delete next[info.id]
    await updateSettings({ encryptedKeys: next })
    toast.info('Key removed')
  }

  const test = async () => {
    setTesting(true)
    setTestResult(null)
    const r = await testProviderConnection(info.id, apiKey.trim(), baseURL.trim() || undefined, model.trim() || undefined)
    setTestResult(r)
    setTesting(false)
  }

  return (
    <div className="rounded-2xl border border-border bg-bg-subtle/30 p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-medium">{info.name}</div>
          {info.keyHelpUrl && (
            <a href={info.keyHelpUrl} target="_blank" rel="noopener noreferrer" className="mt-0.5 inline-flex items-center gap-1 text-[10px] text-fg-muted hover:text-fg">
              Where do I get this key?
              <ExternalLink className="h-2.5 w-2.5" />
            </a>
          )}
        </div>
        {encryptedKey && (
          <button onClick={remove} className="rounded-md p-1.5 text-fg-subtle hover:bg-danger/10 hover:text-danger" title="Remove key">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {encryptedKey ? (
        <div className="mt-3 flex items-center gap-2 text-xs text-success">
          <Check className="h-3.5 w-3.5" />
          Key configured and encrypted.
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          <div className="relative">
            <input
              type={show ? 'text' : 'password'}
              value={apiKey}
              onChange={(e) => { setApiKey(e.target.value); setTestResult(null) }}
              placeholder={info.keyPlaceholder || 'API key'}
              className="w-full rounded-lg border border-border bg-bg px-3 py-1.5 pr-8 text-sm placeholder:text-fg-subtle focus:border-fg/20 focus:outline-none focus:ring-2 focus:ring-accent/20"
              autoComplete="off"
              spellCheck={false}
            />
            <button onClick={() => setShow((s) => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 text-fg-subtle hover:text-fg">
              {show ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          </div>
          {info.needsBaseURL && (
            <input
              value={baseURL}
              onChange={(e) => setBaseURL(e.target.value)}
              placeholder="https://api.example.com/v1"
              className="w-full rounded-lg border border-border bg-bg px-3 py-1.5 text-sm placeholder:text-fg-subtle focus:border-fg/20 focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
          )}
          {(info.needsModel || info.models) && (
            <div>
              {info.models ? (
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="w-full rounded-lg border border-border bg-bg px-3 py-1.5 text-sm focus:border-fg/20 focus:outline-none focus:ring-2 focus:ring-accent/20"
                >
                  {info.models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}{m.recommended ? ' (recommended)' : ''}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder={info.defaultModel || 'Model name'}
                  className="w-full rounded-lg border border-border bg-bg px-3 py-1.5 text-sm placeholder:text-fg-subtle focus:border-fg/20 focus:outline-none focus:ring-2 focus:ring-accent/20"
                />
              )}
            </div>
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={save}
              disabled={!apiKey.trim() || !hasPassphrase}
              className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg transition hover:shadow-glow focus-ring disabled:opacity-50"
            >
              Save key
            </button>
            <button
              onClick={test}
              disabled={!apiKey.trim() || testing}
              className="rounded-lg border border-border bg-bg-subtle px-3 py-1.5 text-xs font-medium transition hover:bg-bg-muted focus-ring disabled:opacity-50"
            >
              {testing ? 'Testing…' : 'Test connection'}
            </button>
            {!hasPassphrase && (
              <span className="text-[10px] text-warning">Set a passphrase in /vault first</span>
            )}
          </div>
          {testResult && (
            <div className={cn('flex items-center gap-1.5 text-xs', testResult.ok ? 'text-success' : 'text-danger')}>
              {testResult.ok ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
              {testResult.ok ? 'Connection works.' : testResult.error}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function TavilyKeyForm({ hasPassphrase, encryptedKey }: { hasPassphrase: boolean; encryptedKey?: EncryptedEnvelope }) {
  const [key, setKey] = useState('')
  const [show, setShow] = useState(false)
  const toast = useToast()

  const save = async () => {
    if (!key.trim()) return
    const dek = getUnlockedKey()
    if (!dek) {
      toast.error('Vault is locked')
      return
    }
    const envelope = await encrypt(dek, JSON.stringify({ apiKey: key.trim() }))
    const settings = await db.settings.get('singleton')
    if (!settings) return
    await updateSettings({ encryptedKeys: { ...settings.encryptedKeys, tavily: envelope } })
    setKey('')
    toast.success('Tavily key saved')
  }

  const remove = async () => {
    const settings = await db.settings.get('singleton')
    if (!settings) return
    const next = { ...settings.encryptedKeys }
    delete next.tavily
    await updateSettings({ encryptedKeys: next })
  }

  return (
    <div className="rounded-xl border border-border bg-bg-subtle/30 p-3">
      <div className="text-sm font-medium">Tavily API key (optional)</div>
      <p className="text-[11px] text-fg-muted">Without a key, Hatch uses Tavily's free keyless tier (rate-limited).</p>
      {encryptedKey ? (
        <div className="mt-2 flex items-center gap-2">
          <span className="flex items-center gap-1.5 text-xs text-success"><Check className="h-3 w-3" /> Key configured</span>
          <button onClick={remove} className="rounded-md p-1 text-fg-subtle hover:bg-danger/10 hover:text-danger"><Trash2 className="h-3 w-3" /></button>
        </div>
      ) : (
        <div className="mt-2 flex items-center gap-2">
          <div className="relative flex-1">
            <input
              type={show ? 'text' : 'password'}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="tvly-..."
              className="w-full rounded-lg border border-border bg-bg px-3 py-1.5 pr-8 text-sm placeholder:text-fg-subtle focus:border-fg/20 focus:outline-none focus:ring-2 focus:ring-accent/20"
              autoComplete="off"
            />
            <button onClick={() => setShow((s) => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 text-fg-subtle hover:text-fg">
              {show ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          </div>
          <button
            onClick={save}
            disabled={!key.trim() || !hasPassphrase}
            className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg hover:shadow-glow disabled:opacity-50"
          >
            Save
          </button>
        </div>
      )}
    </div>
  )
}

function VerbListEditor({ agent, verbs, onChange }: { agent: any; verbs: string[]; onChange: (v: string[]) => void }) {
  const [newVerb, setNewVerb] = useState('')

  const update = (i: number, val: string) => {
    onChange(verbs.map((v, idx) => (idx === i ? val : v)))
  }
  const remove = (i: number) => onChange(verbs.filter((_, idx) => idx !== i))
  const add = () => {
    if (!newVerb.trim()) return
    onChange([...verbs, newVerb.trim()])
    setNewVerb('')
  }

  return (
    <div className="rounded-2xl border border-border bg-bg-subtle/30 p-4">
      <div className="flex items-center gap-2">
        <div
          className="grid h-7 w-7 place-items-center rounded-lg text-base"
          style={{ backgroundColor: `hsl(var(--agent-${agent.color}) / 0.15)`, color: `hsl(var(--agent-${agent.color}))` }}
        >
          {agent.emoji}
        </div>
        <div className="text-sm font-medium">{agent.name}'s verbs</div>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {verbs.map((v, i) => (
          <div key={i} className="group flex items-center gap-1 rounded-full border border-border bg-bg px-2.5 py-0.5 text-xs">
            <input
              value={v}
              onChange={(e) => update(i, e.target.value)}
              className="w-24 bg-transparent text-center text-xs focus:outline-none"
            />
            <button onClick={() => remove(i)} className="text-fg-subtle opacity-0 transition group-hover:opacity-100 hover:text-danger">
              <X className="h-2.5 w-2.5" />
            </button>
          </div>
        ))}
        <div className="flex items-center gap-1">
          <input
            value={newVerb}
            onChange={(e) => setNewVerb(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
            placeholder="Add verb…"
            className="w-24 rounded-full border border-dashed border-border bg-bg px-2.5 py-0.5 text-xs placeholder:text-fg-subtle focus:border-fg/20 focus:outline-none"
          />
        </div>
      </div>
    </div>
  )
}

function SearchTester({ provider, hasKey }: { provider: string; hasKey: boolean }) {
  const [query, setQuery] = useState('Hatch AI cofounder 2026')
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<Awaited<ReturnType<typeof testWebSearch>> | null>(null)

  const run = async () => {
    if (!query.trim() || running) return
    setRunning(true)
    setResult(null)
    const r = await testWebSearch(query.trim())
    setResult(r)
    setRunning(false)
  }

  const disabled = provider === 'none'

  return (
    <div className="rounded-2xl border border-border bg-bg-subtle/30 p-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Globe className="h-3.5 w-3.5 text-fg-muted" />
        Test the search pipeline
      </div>
      <p className="mt-1 text-[11px] text-fg-muted">
        Runs a live query through the configured provider ({provider === 'tavily' && hasKey ? 'Tavily with your key' : provider}).
        Confirms the full path works so the agents can rely on it.
      </p>
      <div className="mt-2 flex items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && run()}
          disabled={disabled || running}
          placeholder="e.g. Stripe pricing 2026"
          className="flex-1 rounded-lg border border-border bg-bg px-2.5 py-1.5 text-xs placeholder:text-fg-subtle focus:border-fg/20 focus:outline-none disabled:opacity-50"
        />
        <button
          onClick={run}
          disabled={disabled || running || !query.trim()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg transition hover:shadow-glow focus-ring disabled:opacity-50"
        >
          {running ? <Loader2 className="h-3 w-3 animate-spin" /> : <Globe className="h-3 w-3" />}
          {running ? 'Searching…' : 'Test search'}
        </button>
      </div>
      {disabled && (
        <div className="mt-2 text-[11px] text-warning">Web search is turned off. Pick a provider above to enable.</div>
      )}
      {result && (
        <div className="mt-3 space-y-2">
          <div
            className={cn(
              'flex items-center gap-2 rounded-md px-2 py-1 text-[11px]',
              result.ok ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'
            )}
          >
            {result.ok ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
            {result.ok ? (
              <span>
                <strong>{result.count}</strong> result{result.count === 1 ? '' : 's'} from{' '}
                <strong>{result.source}</strong> in {result.tookMs}ms
              </span>
            ) : (
              <span>Search failed: {result.error || 'no results'}</span>
            )}
          </div>
          {result.sample && result.sample.length > 0 && (
            <ul className="space-y-1.5">
              {result.sample.map((r, i) => (
                <li key={r.url || i} className="rounded-md border border-border-subtle bg-bg/60 p-2 text-[11px]">
                  <a
                    href={r.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-fg hover:underline"
                  >
                    {r.title}
                  </a>
                  <div className="truncate text-[10px] text-fg-subtle">{r.url}</div>
                  {r.snippet && <div className="mt-1 line-clamp-2 text-fg-muted">{r.snippet}</div>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

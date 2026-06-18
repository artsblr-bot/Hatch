import Dexie, { type Table } from 'dexie'

export interface EncryptedEnvelope {
  v: number
  iv: string
  salt?: string
  ct: string
}

export interface ProviderKeyPlain {
  apiKey: string
  baseURL?: string
  model?: string
}

export type AgentRole = 'cofounder'

export interface Settings {
  id: 'singleton'
  // Default provider/model
  defaultProvider: string
  defaultModel: string
  defaultAgent: AgentRole
  // Per-provider keys (encrypted envelope)
  encryptedKeys: Record<string, EncryptedEnvelope>
  // Search provider config
  searchProvider: 'tavily' | 'duckduckgo' | 'wikipedia' | 'none'
  tavilyKey?: string // encrypted envelope
  // Display
  theme: 'light' | 'dark' | 'system'
  // Verb lists per agent (overridable)
  verbLists: Record<AgentRole, string[]>
  // Passphrase verification hash (for detecting wrong passphrase)
  passphraseHash: string
  // First-run flag
  hasOnboarded: boolean
  hasSetPassphrase: boolean
  // Created/updated
  createdAt: number
  updatedAt: number
}

export interface EncryptedEnvelope {
  v: number
  iv: string // base64
  salt?: string // base64
  ct: string // base64
}

export interface ProviderKeyPlain {
  apiKey: string
  baseURL?: string
  model?: string
}

export interface PassphraseWrapRecord {
  id: 'singleton'
  wrap: {
    v: number
    salt: string
    iv: string
    wrappedKey: string
  }
  createdAt: number
}

export interface PersonalityStyle {
  /** Response length/depth preference, inferred from avg user message length */
  pace: 'fast' | 'balanced' | 'thorough'
  /** Directness vs encouragement preference */
  tone: 'direct' | 'balanced' | 'warm'
  /** Action-first vs think-first preference */
  focus: 'execution' | 'balanced' | 'strategy'
  inferredAt: number
  sampleSize: number
}

export interface CompanyMemory {
  id: 'singleton'
  // Free-form
  name: string
  oneLiner: string
  idea: string
  icp: string
  stage: 'idea' | 'validating' | 'building' | 'launched' | 'growing'
  goal90d: string
  goal1y: string
  blockers: string[]
  decisions: { ts: number; decision: string; rationale?: string }[]
  // Structured
  metrics: { name: string; value: string; updatedAt: number }[]
  openQuestions: { q: string; status: 'open' | 'answered'; answer?: string; ts: number }[]
  // Inferred from conversation patterns — used to adapt cofounder tone/style
  personalityStyle?: PersonalityStyle
  // Meta
  createdAt: number
  updatedAt: number
}

export interface Conversation {
  id: string
  agentRole: AgentRole
  title: string
  createdAt: number
  updatedAt: number
  messageCount: number
}

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool'

export interface Message {
  id: string
  conversationId: string
  role: MessageRole
  content: string
  // Reasoning chain-of-thought (for reasoning-capable models). Shown expanded
  // by default in the UI under a "View Reasoning" disclosure.
  reasoning?: string
  // Tool calls (for assistant messages)
  toolCalls?: { toolCallId?: string; name: string; args: any; result?: any; status: 'pending' | 'ok' | 'error' }[]
  // Status steps
  steps?: { id: string; label: string; status: 'pending' | 'active' | 'done' | 'error'; detail?: string }[]
  // Generation metadata
  provider?: string
  model?: string
  // Timestamps
  createdAt: number
  // For aborted/error messages
  error?: string
  aborted?: boolean
  // Token usage
  usage?: { input: number; output: number; total: number }
}

export type ArtifactType =
  | 'strategy'
  | 'plan90'
  | 'landing'
  | 'pricing'
  | 'pitch'
  | 'review'
  | 'teardown'
  | 'investor'
  | 'custom'

export interface Artifact {
  id: string
  type: ArtifactType
  title: string
  content: string // markdown
  // Optional: which message this artifact came from
  sourceMessageId?: string
  // Source
  conversationId?: string
  messageId?: string
  // Meta
  createdAt: number
  updatedAt: number
  // Tags for filtering
  tags?: string[]
  pinned?: boolean
  // AI-generated compact summary (2-3 sentences, max ~400 chars). Generated
  // by the user's configured provider/model and refreshed every 48h by the
  // artifactSummarizer scheduler. Used by `search_artifacts` to keep the
  // model's context lean (avoids "context choking" as the library grows).
  summary?: string
  // Epoch ms of the last successful summary generation. Stale entries are
  // re-summarized on the next scheduler tick.
  summaryUpdatedAt?: number
  /**
   * Cached task proposal from "Convert to tasks" (Feature 1). Saved on the
   * artifact so we don't re-prompt the LLM every time the user opens the
   * button. Cleared when the artifact content changes.
   */
  proposedTasks?: {
    strategy: 'regex' | 'llm-fallback'
    tasks: { title: string; week?: number; context?: string }[]
    ts: number
  }
}

export interface MemoryEvent {
  id: string
  ts: number
  // What triggered
  trigger: 'onboarding' | 'conversation' | 'edit' | 'extraction'
  // What changed
  field: keyof CompanyMemory | 'all'
  // Diff
  before?: any
  after?: any
  // Did the user confirm?
  confirmed: boolean
  source?: string
}

export interface CheckIn {
  id: string
  weekOf: number // Monday timestamp
  summary: string
  highlights: string[]
  blockers: string[]
  nextWeek: string[]
  acknowledged: boolean
}

/**
 * A task the founder should do. Created from artifacts (auto-parsed from
 * 90-day plans / strategy docs), from chat ("Add to tasks" button on a
 * message), or manually from the Today widget. Surfaced on the Landing
 * page Today panel and tracked in the Friday check-in flow.
 */
export interface Task {
  id: string
  title: string
  description?: string
  source: 'plan90' | 'strategy' | 'chat' | 'manual' | 'review'
  /** id of the source artifact or message, when applicable */
  sourceId?: string
  conversationId?: string
  artifactId?: string
  messageId?: string
  /** Absolute timestamp the task should be done by. */
  dueAt?: number
  /** Monday-anchored start-of-week timestamp (ms). Used to group weekly. */
  weekOf?: number
  status: 'open' | 'done' | 'dropped'
  createdAt: number
  completedAt?: number
  notes?: string
  /**
   * For tasks generated from artifacts: which strategy produced them.
   * 'regex' = instant parser on the artifact body; 'llm-fallback' = the
   * model was invoked because the regex pass was too sparse.
   */
  proposedStrategy?: 'regex' | 'llm-fallback'
}

// ---------------------------------------------------------------------------
// Tiered memory system (v3)
// ---------------------------------------------------------------------------

export type MemoryNodeType = 'insight' | 'decision' | 'context' | 'metric' | 'question' | 'learning'

/** A single free-form memory node stored in the archival tier. */
export interface MemoryNode {
  id: string
  content: string
  type: MemoryNodeType
  tags: string[]
  sourceConversationId?: string
  /** 0.0 – 1.0. Higher = more important, boosted in BM25 ranking. */
  importance: number
  /** Number of times the AI recalled this node via the recall_memory tool. */
  recallCount: number
  /** True once this node has been included in a digest compaction. */
  compacted: boolean
  createdAt: number
}

/** Freeform founder profile (the "user.md"). Singleton row. */
export interface FounderProfile {
  id: 'singleton'
  content: string
  updatedAt: number
}

/** Compacted prose summary of archived memory nodes (the "memory.md"). Singleton row. */
export interface MemoryDigest {
  id: 'singleton'
  content: string
  nodeCount: number
  generatedAt: number
}

class HatchDB extends Dexie {
  settings!: Table<Settings, string>
  passphraseWrap!: Table<PassphraseWrapRecord, string>
  company!: Table<CompanyMemory, string>
  conversations!: Table<Conversation, string>
  messages!: Table<Message, string>
  artifacts!: Table<Artifact, string>
  memoryEvents!: Table<MemoryEvent, string>
  checkIns!: Table<CheckIn, string>
  tasks!: Table<Task, string>
  memoryNodes!: Table<MemoryNode, string>
  founderProfile!: Table<FounderProfile, string>
  memoryDigest!: Table<MemoryDigest, string>

  constructor() {
    super('hatch')
    this.version(1).stores({
      settings: 'id',
      passphraseWrap: 'id',
      company: 'id',
      conversations: 'id, agentRole, updatedAt',
      messages: 'id, conversationId, createdAt',
      artifacts: 'id, type, createdAt, updatedAt, pinned',
      memoryEvents: 'id, ts, trigger, confirmed',
      checkIns: 'id, weekOf, acknowledged',
    })
    // v2: added the `tasks` table. Founder-facing todos. Indexed by
    // status (for the open / done tabs), weekOf (for the Today panel
    // grouping), and dueAt (for "overdue" and "today" lookups).
    this.version(2).stores({
      tasks: 'id, status, weekOf, dueAt, createdAt, [status+dueAt]',
    })
    // v3: tiered memory system. memoryNodes = free-form archival nodes
    // recalled via BM25 search. founderProfile = the "user.md" singleton.
    // memoryDigest = the "memory.md" compacted prose digest singleton.
    this.version(3).stores({
      memoryNodes: 'id, type, createdAt, sourceConversationId',
      founderProfile: 'id',
      memoryDigest: 'id',
    })
  }
}

export const db = new HatchDB()

// Helpers

export async function getSettings(): Promise<Settings | undefined> {
  return db.settings.get('singleton')
}

export async function ensureSettings(): Promise<Settings> {
  const existing = await getSettings()
  if (existing) return existing
  const now = Date.now()
  const created: Settings = {
    id: 'singleton',
    defaultProvider: 'browser-ai',
    defaultModel: '',
    defaultAgent: 'cofounder',
    encryptedKeys: {},
    searchProvider: 'duckduckgo',
    theme: 'system',
    verbLists: {
      cofounder: ['Pondering', 'Sketching', 'Drafting', 'Crunching', 'Reflecting', 'Architecting', 'Wordsmithing', 'Modeling', 'Weighing', 'Positioning', 'Forecasting', 'Thinking it through'],
    },
    passphraseHash: '',
    hasOnboarded: false,
    hasSetPassphrase: false,
    createdAt: now,
    updatedAt: now,
  }
  await db.settings.put(created)
  return created
}

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await ensureSettings()
  const updated = { ...current, ...patch, updatedAt: Date.now() }
  await db.settings.put(updated)
  return updated
}

export async function getCompany(): Promise<CompanyMemory | undefined> {
  return db.company.get('singleton')
}

export async function ensureCompany(): Promise<CompanyMemory> {
  const existing = await getCompany()
  if (existing) return existing
  const now = Date.now()
  const created: CompanyMemory = {
    id: 'singleton',
    name: '',
    oneLiner: '',
    idea: '',
    icp: '',
    stage: 'idea',
    goal90d: '',
    goal1y: '',
    blockers: [],
    decisions: [],
    metrics: [],
    openQuestions: [],
    createdAt: now,
    updatedAt: now,
  }
  await db.company.put(created)
  return created
}

export async function updateCompany(patch: Partial<CompanyMemory>): Promise<CompanyMemory> {
  const current = await ensureCompany()
  const updated = { ...current, ...patch, updatedAt: Date.now() }
  await db.company.put(updated)
  return updated
}

/**
 * Wipe the entire local database — every table, every encrypted envelope.
 * Used by the "forgot passphrase" recovery flow on the Vault screen and by
 * the "Delete everything" button in Settings.
 *
 * Caller is responsible for:
 *   1. clearing the in-memory unlocked DEK via `lock()` from ./crypto
 *   2. reloading the page (e.g. `location.assign('/welcome')`) so React
 *      state, live queries, and Dexie's internal table handles all reset.
 *      After the reload, `ensureSettings()` / `ensureCompany()` recreate
 *      fresh rows with `hasOnboarded: false`, which routes the user back
 *      into the Onboarding wizard (the proper first-time setup flow).
 */
export async function resetAllData(): Promise<void> {
  await db.delete()
}

// ---------------------------------------------------------------------------
// Memory tier helpers
// ---------------------------------------------------------------------------

export async function getFounderProfile(): Promise<FounderProfile | undefined> {
  return db.founderProfile.get('singleton')
}

export async function updateFounderProfile(content: string): Promise<void> {
  await db.founderProfile.put({ id: 'singleton', content, updatedAt: Date.now() })
}

export async function getMemoryDigest(): Promise<MemoryDigest | undefined> {
  return db.memoryDigest.get('singleton')
}

export async function updateMemoryDigest(content: string, nodeCount: number): Promise<void> {
  await db.memoryDigest.put({ id: 'singleton', content, nodeCount, generatedAt: Date.now() })
}

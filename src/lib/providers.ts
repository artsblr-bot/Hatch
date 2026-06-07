/**
 * Multi-provider AI layer.
 * - OpenAI, Anthropic, OpenAI-compatible (NVIDIA NIM, Ollama, Groq, Together, etc.)
 * - Browser built-in AI (Chrome/Edge Prompt API)
 * - All keys come from the user's encrypted IndexedDB store
 *
 * Model catalog: every supported model per provider, with capability tags so the UI
 * can show "Flagship", "Fast", "Free", "Reasoning", etc. and auto-pick a good default
 * if the user hasn't chosen one.
 */

import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { generateText } from 'ai'
import { decrypt, getUnlockedKey } from './crypto'
import { ensureSettings, type Settings, type EncryptedEnvelope } from './db'
import { webSearch } from './search'

type LanguageModel = any

export type ProviderId =
  | 'browser-ai'
  | 'openai'
  | 'anthropic'
  | 'openai-compatible'
  | 'nvidia-nim'

/** Capability tags for the model selector UI. */
export type ModelTag = 'flagship' | 'smart' | 'fast' | 'reasoning' | 'cheap' | 'free' | 'long-context' | 'open-source'

export interface ModelInfo {
  /** The model id as the API expects it (e.g. "gpt-4o-mini") */
  id: string
  /** Human-readable display name */
  name: string
  /** One-line description */
  description: string
  /** Capability tags */
  tags: ModelTag[]
  /** Approximate context window in tokens */
  contextWindow?: number
  /** Whether the model is free (keyless tier) */
  free?: boolean
  /** Whether this is the recommended default */
  recommended?: boolean
  /**
   * Whether this model supports native reasoning (chain-of-thought) output.
   * When true, Hatch will stream reasoning text separately and the user can
   * expand a "View Reasoning" section under the response. Only enabled for
   * models that cleanly close their reasoning blocks.
   */
  supportsReasoning?: boolean
}

export interface ProviderInfo {
  id: ProviderId
  name: string
  description: string
  needsApiKey: boolean
  needsBaseURL?: boolean
  needsModel?: boolean
  defaultModel?: string
  models?: ModelInfo[]
  keyHint?: string
  keyPlaceholder?: string
  keyHelpUrl?: string
  freeTierNote?: string
  isBrowserBuiltIn?: boolean
}

// ---------------------------------------------------------------------------
// Model catalogs per provider
// ---------------------------------------------------------------------------

const OPENAI_MODELS: ModelInfo[] = [
  {
    id: 'gpt-5',
    name: 'GPT-5',
    description: 'OpenAI\'s most capable model. Best for hard reasoning, code, and long tasks.',
    tags: ['flagship', 'smart', 'long-context'],
    contextWindow: 400_000,
    supportsReasoning: true,
  },
  {
    id: 'gpt-5-mini',
    name: 'GPT-5 mini',
    description: 'Faster, cheaper GPT-5. Great default for most work.',
    tags: ['smart', 'fast', 'cheap'],
    contextWindow: 400_000,
    recommended: true,
    supportsReasoning: true,
  },
  {
    id: 'gpt-5-nano',
    name: 'GPT-5 nano',
    description: 'Cheapest GPT-5. Quick replies, simple tasks.',
    tags: ['fast', 'cheap'],
    contextWindow: 400_000,
    supportsReasoning: true,
  },
  {
    id: 'o3',
    name: 'o3',
    description: 'Reasoning model. Thinks deeply before answering. Best for hard problems.',
    tags: ['flagship', 'reasoning', 'smart'],
    contextWindow: 200_000,
    supportsReasoning: true,
  },
  {
    id: 'o3-mini',
    name: 'o3-mini',
    description: 'Cheaper reasoning model. Strong math/coding.',
    tags: ['reasoning', 'cheap', 'fast'],
    contextWindow: 200_000,
    supportsReasoning: true,
  },
  {
    id: 'o4-mini',
    name: 'o4-mini',
    description: 'Fast reasoning model with tool use.',
    tags: ['reasoning', 'fast', 'cheap'],
    contextWindow: 200_000,
    supportsReasoning: true,
  },
  {
    id: 'gpt-4.1',
    name: 'GPT-4.1',
    description: 'Workhorse GPT-4 successor. 1M context, great for long docs.',
    tags: ['smart', 'long-context'],
    contextWindow: 1_000_000,
  },
  {
    id: 'gpt-4.1-mini',
    name: 'GPT-4.1 mini',
    description: 'Cheaper GPT-4.1, still strong.',
    tags: ['fast', 'cheap', 'smart'],
    contextWindow: 1_000_000,
  },
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    description: 'Multimodal flagship. Vision + text + audio.',
    tags: ['flagship', 'smart'],
    contextWindow: 128_000,
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o mini',
    description: 'Cheap, fast, surprisingly capable. Good default.',
    tags: ['fast', 'cheap', 'smart'],
    contextWindow: 128_000,
  },
]

const ANTHROPIC_MODELS: ModelInfo[] = [
  {
    id: 'claude-sonnet-4-5',
    name: 'Claude Sonnet 4.5',
    description: 'Latest Sonnet. Best balance of intelligence and speed.',
    tags: ['flagship', 'smart', 'long-context'],
    contextWindow: 200_000,
    recommended: true,
    supportsReasoning: true,
  },
  {
    id: 'claude-opus-4-1',
    name: 'Claude Opus 4.1',
    description: 'Top-tier reasoning and writing quality. Slower, pricier.',
    tags: ['flagship', 'smart', 'long-context'],
    contextWindow: 200_000,
    supportsReasoning: true,
  },
  {
    id: 'claude-3-7-sonnet-latest',
    name: 'Claude 3.7 Sonnet',
    description: 'Hybrid reasoning. Fast replies OR extended thinking.',
    tags: ['flagship', 'smart', 'reasoning', 'long-context'],
    contextWindow: 200_000,
    supportsReasoning: true,
  },
  {
    id: 'claude-3-5-sonnet-latest',
    name: 'Claude 3.5 Sonnet',
    description: 'Previous flagship. Still excellent.',
    tags: ['smart', 'long-context'],
    contextWindow: 200_000,
  },
  {
    id: 'claude-3-5-haiku-latest',
    name: 'Claude 3.5 Haiku',
    description: 'Fastest Claude. Cheap, great for short replies.',
    tags: ['fast', 'cheap', 'smart'],
    contextWindow: 200_000,
  },
]

const OPENAI_COMPATIBLE_MODELS: ModelInfo[] = [
  // Groq is the common case for openai-compatible; we show Groq defaults but the
  // user can also point this at Together, OpenRouter, Ollama, etc.
  {
    id: 'llama-3.3-70b-versatile',
    name: 'Llama 3.3 70B (Groq)',
    description: 'Open weights, very capable. Fast on Groq.',
    tags: ['flagship', 'smart', 'open-source', 'long-context'],
    contextWindow: 131_072,
    recommended: true,
    supportsReasoning: true,
  },
  {
    id: 'deepseek-r1-distill-llama-70b',
    name: 'DeepSeek R1 Distill 70B (Groq)',
    description: 'Reasoning model on Groq. Thinks before answering.',
    tags: ['reasoning', 'smart', 'open-source', 'long-context'],
    contextWindow: 131_072,
    supportsReasoning: true,
  },
  {
    id: 'llama-3.1-8b-instant',
    name: 'Llama 3.1 8B (Groq)',
    description: 'Tiny, very fast. Good for simple chat.',
    tags: ['fast', 'cheap', 'open-source'],
    contextWindow: 131_072,
  },
  {
    id: 'mixtral-8x7b-32768',
    name: 'Mixtral 8x7B',
    description: 'Open MoE model. Solid all-rounder.',
    tags: ['open-source', 'smart'],
    contextWindow: 32_768,
  },
  {
    id: 'gemma2-9b-it',
    name: 'Gemma 2 9B',
    description: 'Google\'s small open model. Good for cheap inference.',
    tags: ['fast', 'cheap', 'open-source'],
    contextWindow: 8_192,
  },
]

const NVIDIA_NIM_MODELS: ModelInfo[] = [
  {
    id: 'meta/llama-3.1-70b-instruct',
    name: 'Llama 3.1 70B Instruct',
    description: 'Open-weights 70B. Strong general-purpose.',
    tags: ['flagship', 'smart', 'open-source', 'long-context'],
    contextWindow: 131_072,
    recommended: true,
    supportsReasoning: true,
  },
  {
    id: 'meta/llama-3.1-8b-instruct',
    name: 'Llama 3.1 8B Instruct',
    description: 'Cheap, fast 8B. Good default for simple tasks.',
    tags: ['fast', 'cheap', 'open-source'],
    contextWindow: 131_072,
  },
  {
    id: 'meta/llama-3.3-70b-instruct',
    name: 'Llama 3.3 70B Instruct',
    description: 'Newer 70B. Stronger than 3.1 70B.',
    tags: ['flagship', 'smart', 'open-source', 'long-context'],
    contextWindow: 131_072,
    supportsReasoning: true,
  },
  {
    id: 'deepseek-ai/deepseek-r1',
    name: 'DeepSeek R1',
    description: 'Open reasoning model. Long chain-of-thought.',
    tags: ['reasoning', 'smart', 'open-source', 'long-context'],
    contextWindow: 64_000,
    supportsReasoning: true,
  },
  {
    id: 'qwen/qwen2.5-72b-instruct',
    name: 'Qwen 2.5 72B Instruct',
    description: 'Alibaba\'s flagship 72B. Multilingual.',
    tags: ['flagship', 'smart', 'open-source', 'long-context'],
    contextWindow: 131_072,
    supportsReasoning: true,
  },
]

const BROWSER_AI_MODELS: ModelInfo[] = [
  {
    id: 'gemini-nano',
    name: 'Gemini Nano',
    description: 'Free, local, runs in your browser. No key needed.',
    tags: ['free', 'fast', 'cheap'],
    contextWindow: 32_000,
    free: true,
    recommended: true,
  },
]

// ---------------------------------------------------------------------------

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  'browser-ai': {
    id: 'browser-ai',
    name: 'Built-in browser AI',
    description: 'Free, no key needed. Uses Chrome or Edge\'s built-in model (Gemini Nano).',
    needsApiKey: false,
    isBrowserBuiltIn: true,
    models: BROWSER_AI_MODELS,
    freeTierNote: 'Always free, runs locally in your browser',
  },
  openai: {
    id: 'openai',
    name: 'OpenAI',
    description: 'GPT-5, o-series reasoning, GPT-4.1, GPT-4o.',
    needsApiKey: true,
    keyHint: 'Starts with sk-...',
    keyPlaceholder: 'sk-...',
    keyHelpUrl: 'https://platform.openai.com/api-keys',
    models: OPENAI_MODELS,
  },
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic Claude',
    description: 'Claude Sonnet 4.5, Opus 4.1, 3.7, 3.5 Sonnet/Haiku.',
    needsApiKey: true,
    keyHint: 'Starts with sk-ant-...',
    keyPlaceholder: 'sk-ant-...',
    keyHelpUrl: 'https://console.anthropic.com/settings/keys',
    models: ANTHROPIC_MODELS,
  },
  'openai-compatible': {
    id: 'openai-compatible',
    name: 'OpenAI-compatible (Groq, Together, …)',
    description: 'Any service with an OpenAI-compatible API.',
    needsApiKey: true,
    needsBaseURL: true,
    needsModel: true,
    keyHint: 'Your provider\'s API key',
    keyPlaceholder: 'gsk_... or sk-...',
    keyHelpUrl: '',
    models: OPENAI_COMPATIBLE_MODELS,
  },
  'nvidia-nim': {
    id: 'nvidia-nim',
    name: 'NVIDIA NIM',
    description: 'NVIDIA\'s hosted inference. DeepSeek, Llama, Qwen, and more.',
    needsApiKey: true,
    needsBaseURL: false,
    needsModel: true,
    keyHint: 'Starts with nvapi-...',
    keyPlaceholder: 'nvapi-...',
    keyHelpUrl: 'https://build.nvidia.com/explore/discover',
    models: NVIDIA_NIM_MODELS,
    freeTierNote: '1,000 free requests per month on NVIDIA Build',
  },
}

export const PROVIDER_LIST: ProviderInfo[] = Object.values(PROVIDERS)

/** Get the list of known models for a provider, or an empty list if none. */
export function getProviderModels(providerId: ProviderId): ModelInfo[] {
  return PROVIDERS[providerId]?.models || []
}

/** Pick the recommended default model for a provider. */
export function getDefaultModelFor(providerId: ProviderId): string | undefined {
  const list = getProviderModels(providerId)
  const rec = list.find((m) => m.recommended)
  return rec?.id || list[0]?.id
}

/** Find a model in a provider's catalog by id. */
export function getModelInfo(providerId: ProviderId, modelId: string): ModelInfo | undefined {
  return getProviderModels(providerId).find((m) => m.id === modelId)
}

/** Lightweight display label for a model (used in headers / logs). */
export function describeModel(providerId: ProviderId, modelId: string): string {
  const info = getModelInfo(providerId, modelId)
  return info?.name || modelId
}

// ---------------------------------------------------------------------------

async function decryptProviderKey(
  encrypted?: EncryptedEnvelope
): Promise<{ apiKey: string; baseURL?: string; model?: string } | null> {
  if (!encrypted) return null
  const dek = getUnlockedKey()
  if (!dek) throw new Error('Vault is locked. Set or enter your passphrase to unlock.')
  const json = await decrypt(dek, encrypted)
  return JSON.parse(json)
}

/**
 * Get a configured language model for the given provider+model.
 * - If model is empty/undefined, picks the provider's recommended default.
 * - Throws if the vault is locked or the key is missing.
 */
export async function getModel(providerId: ProviderId, modelId?: string): Promise<LanguageModel> {
  if (providerId === 'browser-ai') {
    throw new Error('Browser AI is not a LanguageModel — use streamBrowserAI() instead.')
  }
  const settings = await ensureSettings()
  const enc = settings.encryptedKeys[providerId]
  const creds = await decryptProviderKey(enc)
  if (!creds?.apiKey) {
    throw new Error(
      `No API key configured for ${PROVIDERS[providerId].name}. Add one in Settings.`
    )
  }
  const resolvedModel = modelId && modelId.length > 0 ? modelId : getDefaultModelFor(providerId)
  if (!resolvedModel) {
    throw new Error(`No model specified and no default available for ${PROVIDERS[providerId].name}.`)
  }
  switch (providerId) {
    case 'openai': {
      const openai = createOpenAI({ apiKey: creds.apiKey })
      return openai(resolvedModel)
    }
    case 'anthropic': {
      const anthropic = createAnthropic({
        apiKey: creds.apiKey,
        headers: {
          // Required for direct browser access to Anthropic API
          'anthropic-dangerous-direct-browser-access': 'true',
        },
      })
      return anthropic(resolvedModel)
    }
    case 'nvidia-nim': {
      const nim = createOpenAICompatible({
        name: 'nvidia-nim',
        apiKey: creds.apiKey,
        baseURL: creds.baseURL || 'https://integrate.api.nvidia.com/v1',
      })
      return nim(resolvedModel)
    }
    case 'openai-compatible': {
      if (!creds.baseURL) {
        throw new Error('OpenAI-compatible provider needs a base URL.')
      }
      const compat = createOpenAICompatible({
        name: 'openai-compatible',
        apiKey: creds.apiKey,
        baseURL: creds.baseURL,
      })
      return compat(resolvedModel)
    }
  }
}

export interface BrowserAICapability {
  available: boolean
  reason?: string
  defaultModel?: string
}

export async function detectBrowserAI(): Promise<BrowserAICapability> {
  if (typeof window === 'undefined' || !('ai' in (window as any))) {
    return { available: false, reason: 'Browser does not expose the Prompt API (try Chrome 128+ or Edge).' }
  }
  const ai = (window as any).ai
  if (!ai || !ai.canCreateTextSession) {
    return { available: false, reason: 'AI API not present on window.' }
  }
  try {
    const caps = await ai.canCreateTextSession()
    if (caps === 'no' || caps === 'unavailable') {
      return { available: false, reason: 'Browser AI is not available on this device.' }
    }
    if (caps === 'after-download') {
      return { available: true, reason: 'A model download is required (Chrome will prompt).', defaultModel: 'gemini-nano' }
    }
    return { available: true, defaultModel: 'gemini-nano' }
  } catch (e) {
    return { available: false, reason: String(e) }
  }
}

export interface StreamCallbacks {
  onToken: (text: string) => void
  /**
   * Reasoning / chain-of-thought delta. Fired separately from onToken so the
   * UI can render a dedicated "View Reasoning" section that streams in real
   * time. Only fires for reasoning-capable models with native reasoning knobs
   * enabled, or for models that emit inline <think>...</think> blocks.
   */
  onReasoningDelta?: (text: string) => void
  onDone: (info: { usage?: { input: number; output: number; total: number; reasoning?: number }; provider: string; model: string }) => void
  onError: (err: Error) => void
  onAbort?: () => void
  signal?: AbortSignal
}

/**
 * Provider-specific options that enable native reasoning output for capable
 * models. Returns undefined if the model has no native reasoning knob and the
 * model itself decides how to expose CoT (e.g. DeepSeek-R1 streams <think>...
 * </think> blocks inline).
 *
 * Notes:
 * - Anthropic: extended thinking (Claude 3.7+ / Sonnet 4.5 / Opus 4.1)
 * - OpenAI: reasoningEffort for o-series and GPT-5 family
 * - Groq / NVIDIA: no native toggle; models that support reasoning (DeepSeek-R1
 *   variants) emit <think> blocks in the text stream and are detected heuristically.
 */
export function getReasoningProviderOptions(
  providerId: ProviderId,
  modelId: string
): Record<string, any> | undefined {
  if (providerId === 'anthropic') {
    return {
      anthropic: {
        thinking: { type: 'enabled', budgetTokens: 10000 },
      },
    }
  }
  if (providerId === 'openai') {
    // GPT-5 family + o-series all understand reasoningEffort
    if (
      modelId.startsWith('o1') ||
      modelId.startsWith('o3') ||
      modelId.startsWith('o4') ||
      modelId.startsWith('gpt-5')
    ) {
      return { openai: { reasoningEffort: 'medium' } }
    }
  }
  return undefined
}

/**
 * Stream from Chrome/Edge built-in AI.
 * The Prompt API does not stream tokens natively, so we chunk the output
 * with a small delay to simulate streaming and keep the UI feeling alive.
 */
export async function streamBrowserAI(
  prompt: string,
  systemPrompt: string,
  cb: StreamCallbacks
): Promise<void> {
  try {
    const session = await (window as any).ai.createTextSession({ systemPrompt })
    const fullText = await session.prompt(prompt, { signal: cb.signal })
    if (cb.signal?.aborted) {
      cb.onAbort?.()
      return
    }
    const chunkSize = 4
    for (let i = 0; i < fullText.length; i += chunkSize) {
      if (cb.signal?.aborted) {
        cb.onAbort?.()
        return
      }
      const chunk = fullText.slice(i, i + chunkSize)
      cb.onToken(chunk)
      await new Promise((r) => setTimeout(r, 16))
    }
    cb.onDone({ provider: 'browser-ai', model: 'gemini-nano' })
    session.destroy?.()
  } catch (e: any) {
    if (e?.name === 'AbortError' || cb.signal?.aborted) {
      cb.onAbort?.()
      return
    }
    cb.onError(e)
  }
}

/**
 * Test a provider connection by sending a tiny "ping" prompt.
 */
export async function testProviderConnection(
  providerId: ProviderId,
  apiKey: string,
  baseURL?: string,
  model?: string
): Promise<{ ok: boolean; error?: string; model?: string }> {
  try {
    if (providerId === 'browser-ai') {
      const cap = await detectBrowserAI()
      return cap.available
        ? { ok: true, model: cap.defaultModel }
        : { ok: false, error: cap.reason }
    }
    let lm: LanguageModel
    const resolvedModel = model && model.length > 0 ? model : getDefaultModelFor(providerId)
    switch (providerId) {
      case 'openai': {
        const openai = createOpenAI({ apiKey })
        lm = openai(resolvedModel || 'gpt-4o-mini')
        break
      }
      case 'anthropic': {
        const anthropic = createAnthropic({
          apiKey,
          headers: { 'anthropic-dangerous-direct-browser-access': 'true' },
        })
        lm = anthropic(resolvedModel || 'claude-3-5-sonnet-latest')
        break
      }
      case 'nvidia-nim': {
        const nim = createOpenAICompatible({
          name: 'nvidia-nim',
          apiKey,
          baseURL: baseURL || 'https://integrate.api.nvidia.com/v1',
        })
        lm = nim(resolvedModel || 'meta/llama-3.1-70b-instruct')
        break
      }
      case 'openai-compatible': {
        if (!baseURL) return { ok: false, error: 'Base URL required' }
        const compat = createOpenAICompatible({
          name: 'openai-compatible',
          apiKey,
          baseURL,
        })
        lm = compat(resolvedModel || 'llama-3.1-8b-instant')
        break
      }
      default:
        return { ok: false, error: 'Unknown provider' }
    }
    const result = await generateText({
      model: lm,
      prompt: 'ping',
      maxOutputTokens: 1,
    })
    void result
    return { ok: true, model: resolvedModel }
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) }
  }
}

/** Get the active default provider/model from settings, with safe fallbacks. */
export function getDefaultProviderModel(s: Settings): { provider: ProviderId; model: string } {
  const provider = (s.defaultProvider as ProviderId) || 'browser-ai'
  const model = s.defaultModel && s.defaultModel.length > 0 ? s.defaultModel : (getDefaultModelFor(provider) || '')
  return { provider, model }
}

/**
 * Test the configured web search pipeline by running a single live query.
 * Returns whether the search worked, how long it took, the source used, and
 * a small sample of results so the Settings page can show "search works".
 */
export async function testWebSearch(query: string, signal?: AbortSignal): Promise<{
  ok: boolean
  query: string
  count: number
  tookMs: number
  source?: string
  sample?: { title: string; url: string; snippet: string }[]
  error?: string
}> {
  const start = Date.now()
  try {
    const results = await webSearch({ query, maxResults: 3, signal })
    return {
      ok: results.length > 0,
      query,
      count: results.length,
      tookMs: Date.now() - start,
      source: results[0]?.source,
      sample: results.slice(0, 3).map((r) => ({ title: r.title, url: r.url, snippet: r.snippet })),
    }
  } catch (e: any) {
    return { ok: false, query, count: 0, tookMs: Date.now() - start, error: e?.message || String(e) }
  }
}

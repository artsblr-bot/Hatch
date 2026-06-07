# Hatch — Working Notes

## Goal
Build "Hatch" — a 100% client-side, BYOK, multi-provider AI cofounder web app for non-technical first-time founders with 4 agents (Mentor, CTO, CMO, CFO), persistent memory, web search, artifacts, sophisticated latency masking, and a model selector with capability tags.

## Constraints
- 100% client-side, no server (no Cloudflare Worker, no backend of any kind)
- BYOK — user provides own API keys for OpenAI, Anthropic, NVIDIA NIM, OpenAI-compatible (Groq, etc.)
- Reliable web search via browser-direct providers (Tavily, DDG, Wikipedia)
- Sophisticated latency masking: rotating verbs, status pipeline, jitter buffer, skeleton artifacts, tool-call animations
- 4 agents with per-agent curated verb lists
- Free in-browser default (Chrome/Edge built-in AI) first, then upgrade to BYOK
- 4-week build timeline with more polish
- Non-technical founder target audience
- No signup, no credit card, no account
- Google Gemini explicitly OUT (no browser CORS)
- Support all models from any plugged-in provider; user can pick any model; show capability tags (flagship, fast, free, reasoning, etc.); auto-default if user doesn't pick

## Progress

### Done
- Project scaffold at `/Users/gurukularts/Desktop/App` (Vite + React 18 + TypeScript + Tailwind)
- AI SDK v5 (`ai@5.0.196`, `@ai-sdk/openai@2.0.106`, `@ai-sdk/anthropic@2.0.80`, `@ai-sdk/openai-compatible@1.0.39`, `@ai-sdk/react@2.0.198`); Dexie 4.4.3, framer-motion 11, react-markdown, react-router-dom 7
- `src/lib/utils.ts`, `src/lib/crypto.ts` (AES-GCM/PBKDF2, DEK wrap/unwrap)
- `src/lib/db.ts` (Dexie schema: 8 tables, `EncryptedEnvelope`)
- `src/lib/providers.ts` (REWRITTEN — full model catalog, capability tags, `getProviderModels`, `getDefaultModelFor`, `getModelInfo`, `describeModel`, `getDefaultProviderModel`; `getModel()` auto-picks recommended default)
- `src/lib/search.ts` (Tavily keyless+BYOK, DDG HTML, Wikipedia REST with fallback chain)
- `src/lib/agents.ts` (4 agents with verb lists and system prompts)
- `src/lib/chat.ts` (AI SDK v5: `inputSchema`, `stopWhen: stepCountIs(5)`, `chunk.text`, `ModelMessage[]`)
- `src/lib/artifacts.ts` (9 templates, parse/strip regex)
- `src/hooks/useJitterBuffer.ts`, `src/hooks/useRotatingWords.ts`
- Components: `AppShell.tsx`, `Toast.tsx`, `ChatHeader.tsx`, `MessageList.tsx`, `ChatComposer.tsx`, `ErrorBoundary.tsx`, **`ModelSelector.tsx`** (search, capability tag chips, recommended badge), **`HatchMark.tsx`** (brand logomark, orange/black inversion modes), **`HatchWordmark.tsx`** (mark + "hatch" lockup), **`FloatingMark.tsx`** (breathing/floating/halo-augmented mark), **`AmbientAurora.tsx`** (slow-drifting colored blob backdrop, GPU-only), **`ParticleField.tsx`** (deterministic floating orbs with per-orb drift), **`WordmarkReveal.tsx`** (per-letter spring reveal of the wordmark), **`CountUp.tsx`** (easeOutCubic number animator)
- Ambient motion applied across the app: BootScreen halo mark, Onboarding welcome/ready (particle field + reveal), Vault (violet aurora + halo mark + particles), AppShell sidebar (breathing wordmark + animated recent conv dots + active-nav accent stripe + gradient hairline), Landing (orange aurora + 26-orb top particle field + count-up stats + hover glow), Chat empty state (active agent breathes with glow + 3 inactive agents orbit), Library empty states (drifting artifact emojis), Memory loaded (pending-extractions banner uses framer-motion)
- Ambient keyframes in `index.css`: `aurora-drift`, `float-y`, `breathe`, `halo-spin`, `halo-spin-rev`, `drift-x`, `shimmer-text` + utility classes `.animate-float`, `.animate-breathe`, `.animate-halo`, `.animate-halo-rev`, `.animate-drift`, `.text-shimmer`
- Brand identity integrated: orange `#FF6B1A` / black `#0E0E0E`; favicon swapped to brand icon; wordmark in `AppShell` sidebar and `Landing` hero; index.html uses brand theme-color, apple-touch-icon, og:image; Tailwind has `brand-orange`/`brand-black` tokens
- Original brand assets in `Logo/` (hatch-icon.svg, hatch-logo.svg, hatch-logo-dark.svg, hatch_final_logo.html)
- Pages: `Landing.tsx`, `Chat.tsx`, `Library.tsx`, `Memory.tsx`, `Settings.tsx`, `Onboarding.tsx`, `Vault.tsx`
- `src/App.tsx` (router with vault-lock + onboarded guards), `src/main.tsx` (ErrorBoundary wrap)
- `Memory.tsx` fix: removed broken JSX-inline `<style>` (Vite doesn't process it through PostCSS); inlined full Tailwind classes on inputs
- README, favicon, configs
- Fixed v4→v5 breaking changes: `parameters`→`inputSchema`, `maxSteps`→`stopWhen: stepCountIs(5)`, `textDelta`→`text`, `CoreMessage`→`ModelMessage`
- v5 usage type: `inputTokens`/`outputTokens`/`totalTokens` (NOT `promptTokens`/`completionTokens`)
- Wired `ModelSelector` into `ChatHeader.tsx` (replaces static badge); added `handleModelChange` in `Chat.tsx` that persists to `settings.defaultModel` and toasts the new model name
- Production build clean: index 441 kB / 133 kB gz, ai-vendor 418 kB / 104 kB gz, react-vendor 179 kB / 59 kB gz, db-vendor 98 kB / 33 kB gz, CSS 35 kB / 7 kB gz
- TS strict + `noUnusedLocals/Parameters: true` — clean
- Dev server: PID in `/tmp/hatch-dev.pid` (still running)
- **Reasoning mode wired end-to-end** for capable models:
  - `ModelInfo.supportsReasoning: boolean` — tags the smart models (OpenAI o-series + GPT-5 family, Anthropic Claude 3.7+ / Sonnet 4.5 / Opus 4.1, Groq `deepseek-r1-distill-llama-70b` + `llama-3.3-70b-versatile`, NVIDIA `deepseek-ai/deepseek-r1` + 70B/72B Llama/Qwen); small/dumb models (<15B params) are left untagged so they don't fail to close `<think>` blocks
  - `getReasoningProviderOptions(providerId, modelId)` — returns Anthropic `thinking: { type: 'enabled', budgetTokens: 10000 }` or OpenAI `reasoningEffort: 'medium'`; undefined for models without a native reasoning knob
  - `StreamCallbacks.onReasoningDelta(text)` — separate callback from `onToken` so the UI can render a dedicated "View Reasoning" section that streams in real-time
  - `runChat` passes `providerOptions` only when `supportsReasoning` is true (avoids "unknown option" rejections on regular models)
  - `runChat` separates `reasoning-delta` chunks from `text-delta` chunks; routes reasoning to `cb.onReasoningDelta`, content to `cb.onToken`
  - `Message.reasoning?: string` field added; persisted in `Chat.tsx` on done/error/abort
  - Defensive `` strip: if a non-reasoning model still emits inline <think>...</think> blocks (e.g. R1 distills routed through the OpenAI-compatible path), the regex lifts them into the reasoning field and keeps the visible content clean
  - `ReasoningBlock` UI in `MessageList.tsx`: collapsible, **expanded by default** so the user sees thinking in real-time; live mode has a pulsing caret and auto-scrolls; uses monospace + `text-fg-muted` so it visually reads as "thinking" not "answer"
- **Groq model added**: `deepseek-r1-distill-llama-70b` (reasoning, free on Groq tier)
- **HTML live preview** — agents output complete HTML mockups in ` ```html ` fenced code blocks and Hatch renders them in a sandboxed iframe with a Code/Preview toggle. Works in all 4 agents (Mentor, CTO, CMO, CFO):
  - `parseHtmlBlocks(text)` / `stripHtmlBlocks(text)` / `hasHtmlBlock(text)` in `src/lib/artifacts.ts` — extracts complete AND partial blocks (live streams that haven't closed the ``` yet)
  - `HtmlPreviewCard` in `src/components/HtmlPreviewCard.tsx` — header (HTML preview + live badge + context + view toggle + refresh + open-in-new-tab + copy), Preview tab (sandboxed `iframe srcdoc` with `sandbox="allow-scripts allow-forms allow-popups"`, 480px tall, debounced 180ms during streaming), Code tab (line numbers, monospace, scrolling)
  - Wired into both `StreamingMessage` (live updates) and `AssistantBubble` (stored messages) in `MessageList.tsx`; HTML blocks are stripped from the visible markdown prose so the user sees one clean answer + one preview box, not duplicates
  - System prompt updated in `src/lib/agents.ts`: removed "Never write code unless explicitly asked" (was making agents refuse mockups); added explicit instruction to output self-contained HTML with inline CSS for any visual request; told to ALWAYS call `web_search` as a real tool when promising to search
- **Web search strengthened**: system prompt now mandates actual `web_search` tool calls (the model was saying "let me search" in prose without invoking the tool); results are synthesized with inline `[example.com](https://example.com)` link citations so the founder can click through
  - **`search_artifacts` tool** — client-side RAG over the founder's saved artifact library. Every AI agent can now ground answers in the user's own materials (strategies, pricing, plans, pitches, teardowns):
  - `src/lib/artifactSearch.ts` — BM25 in-memory search engine: k1=1.5, b=0.75, field-weighted (title ×3, tag ×2, body ×1), pinned boost (+0.6), recency decay (1/(1+ageDays/30) capped at 0.3), 28-stopword filter, snippet generator with `<mark>` highlights, 30-hit cap, max 20 results. Pure functions over `Artifact[]`; reads from Dexie so always consistent with Library.
  - **`computeIdf()` + `bm25DocScore()` are split** — corpus-wide IDF is computed ONCE in `computeIdf()` and reused per-doc in `bm25DocScore()`. The earlier monolithic `bm25Score()` was called per-doc with `[doc]` as the corpus, which collapsed IDF to a constant and destroyed BM25's rarity signal (every doc got the same score). Verified with a 5-pricing + 1-strategy corpus: the rare `strategy` term now ranks first; the common `pricing` term ranks lower per-doc.
  - **No-match queries return 0 hits** — earlier, every doc got a positive score from the `recencyBoost` even when no terms matched, so a query like `"qzxwcnvbnm"` returned the whole library. Fixed by short-circuiting in `searchArtifacts()`: if `baseScore === 0 && matchedFields.length === 0`, score stays 0 and the `score > 0` filter drops the doc.
  - `formatArtifactSearchResultForModel()` — compact model-facing result (`{ id, title, type, snippet, matchedFields, score }`); keeps tool result small enough for cheap models.
  - `highlightSnippet(snippet, queryTokens)` — exports segments `[{ text, match }]` so the UI can render `<mark>` around matches via JSX (no `dangerouslySetInnerHTML` needed). `tokenizeForSearch()` is exported so the UI uses the same stopword-aware tokenizer the search used.
  - Registered as an AI SDK tool in `src/lib/chat.ts` next to `web_search`. Tool `execute` returns `{ summary, hits, fullHits, scanned }`; the `summary` goes to the model, the `fullHits` flow back through `toolOverrides` state in `Chat.tsx` to `MessageList.tsx` so the user sees the matched artifacts.
  - `ToolCallRow` in `MessageList.tsx` reworked to detect tool name: violet `Database` icon + auto-expand on success for `search_artifacts`, sky `Search` icon for `web_search`. New `ArtifactSearchResults` subcomponent shows hit list with type emoji, title, score badge, matched-field chips (title/tag/body), snippet (with `<mark>`-injected highlights via `highlightSnippet()`), and "Open full library" button.
  - **System prompt teaches all 3 tools** — in `src/lib/agents.ts`, the `toolInstructions` block at the end of the prompt has a dedicated `## Library search (\`search_artifacts\`)` section that covers: when to call, how to query (specific 2-4 keywords), optional `types` / `pinnedOnly` filters, citation conventions, and the empty-library fallback. This was MISSING in the first pass — the model had no idea the tool existed.
  - **Self-test in Library** — `FlaskConical` button in the Library header calls `seedSampleArtifacts()` (7 fixture artifacts across 6 types, 1 pinned) and runs 6 probe queries; results shown in a diagnostic modal with per-query hits, scores, scanned counts, matched fields, and snippets. Lets the founder verify search works without a real conversation.
  - `search_artifacts` is **not** wired into the `browser-ai` path in `chat.ts` (browser AI has no tool support); documented as a soft limitation.
  - **End-to-end verified in headless Chrome** via CDP: 6/6 probes pass (broad pricing, type filter, pinnedOnly, no-match returns 0, rarity ranks `rare` first, highlight finds 2 matches). `npx tsc --noEmit` and `npm run build` both pass cleanly; prod index 500.82 kB / 151.30 kB gz.
- **Tool calling overhaul (Jun 2026)**:
  - **Critical bug fixed**: `onStep` callback was declared in `ChatRequest` and wired through `Chat.tsx` but `runChat` never fired it — the status pipeline showed only the initial "plan" step. Now every tool invocation drives a step (`Plan → Search web → Read page → Search library → Answer`) so the user sees the agent's actual workflow.
  - **`toolCallId` added everywhere** — `onToolCall` payload now includes the AI SDK's `toolCallId`, and `Chat.tsx` keys `toolOverrides` by id (not by name) so multiple parallel calls to the same tool don't clobber each other. UI also keys the override lookup by id with a name-based fallback for legacy in-flight calls.
  - **`onInputAvailable` hook used** — the "pending" tool call fires the moment the model commits to its query (before the HTTP request leaves the browser). The user sees "Searching for X…" instantly.
  - **`AbortSignal` propagated** into `webSearch` and the per-provider fetch calls. Stop-button click now actually cancels in-flight searches instead of leaking them.
  - **New `fetch_url` tool** lets the model deep-read a page found by `web_search` (HTML→text conversion, title extraction, configurable char cap, AbortSignal support). This unlocks the "search then read" pattern that real web research needs.
  - **`search_artifacts` wired in** — the tool existed in `artifactSearch.ts` with full Library + MessageList UI, but it was never registered in `chat.ts`. Now all three tools (`web_search`, `fetch_url`, `search_artifacts`) are live for the SDK path.
  - **`web_search` schema upgraded** — added `topic` (`general`/`news`) and `recencyDays` (1-365) params. The model can now hint "this is a news query" and the result filtering is server-side. Auto-detection: if the query contains "latest", "this week", "today", "2026", etc., we pass `topic: "news"` + `recencyDays: 30` even if the model didn't.
  - **Tavily `include_raw_content: true`** — the tool result now carries the actual page text (trimmed to 1500 chars per result, total cap 6k) instead of just snippets. Models can answer questions grounded in the real article body, not a 2-line preview.
  - **Result payload to model is trimmed** to 6k chars max with explicit truncation marker. UI keeps the full `fullResults` for the user to expand.
  - **Search providers hardened**:
    - Retry once on transient network failures (no retry on 4xx client errors)
    - Abort-aware (checks `signal.aborted` between retries and provider hops)
    - Fallback chain is now `user-chosen → tavily → duckduckgo → wikipedia` (Wikipedia last because it's a knowledge base, not a web search)
    - Tavily correctly passes `days` param when `recencyDays` is set
    - DuckDuckGo parser now matches both `<a class="result__snippet">` and `<div class="result__snippet">` (DDG occasionally uses divs in JS-rendered fragments)
  - **System prompt restructured** — tool instructions moved to the END of the prompt (recency effect) with explicit "when to call", "how to query", "no-tool fallback" guidance. Each agent's persona prompt also has a "CRITICAL: ALWAYS call web_search when…" trigger for its domain. Verified all 4 agents have tool instructions in the second half of the prompt (`scripts/smoke-tools.mts`).
  - **UI overhauled** — `ToolCallRow` now has per-tool dedicated renderers:
    - `web_search`: sky accent, "Searched the web" label, query prominent, `N results · tavily · 245ms` chip, expandable result list with titles, URLs (clickable), snippets, published dates
    - `fetch_url`: emerald accent, "Read page" label, URL prominent, char count, "Open in new tab" link, expandable page text preview
    - `search_artifacts`: violet accent, "Searched your library" label, query, hit count, expandable hit list with type emojis, titles, score chips (title/tag/body), snippets, "Open full library" button
  - **"Test search" UI in Settings** — new `SearchTester` component lets the founder run a live query through the configured provider and see the result count, source, timing, and first 3 results inline. Uses the new `testWebSearch()` helper in `providers.ts`.
  - **Smoke tests added** at `scripts/smoke-search.mts` (DDG + Wikipedia + fetch_url + abort signal) and `scripts/smoke-tools.mts` (tool schemas + system-prompt structure). All 4 + 4 = 8 checks pass.
  - **Pre-existing TS errors fixed**: `(ARTIFACT_TEMPLATES as any)[h.type]?.emoji` (was a Record-indexing-any issue), static `import { webSearch } from './search'` in `providers.ts` (was a dynamic import warning at build).
  - Production build clean: index 496.72 kB / 150.07 kB gz, ai-vendor 417.98 kB / 104.48 kB gz, react-vendor 179.39 kB / 58.99 kB gz, db-vendor 97.71 kB / 32.93 kB gz, CSS 42.85 kB / 7.89 kB gz

### Done (Claude-style web search UI + stronger prompt)
- **`WebSearchResults` rewritten Claude-style** in `src/components/MessageList.tsx`:
  - Extracted `WebSearchPending` — sky-500/03 tinted header with `Globe` icon, "Searching the web" label, query, topic/recency meta, pulsing `animate-think-pulse` dot
  - Extracted `WebSearchSources` — header with cite-count badge (`N sources`), provider chip, `tookMs` chip
  - Extracted `WebSearchSourceCard` — circular hostname-letter badge (gradient sky-500/15→/5), clickable title, hostname, URL, publishedDate chip, snippet (2 lines), hover-only external-link button, small `#N` cite label under the badge
- **`FetchUrlResults` rewritten Claude-style** — same treatment with emerald-500/03 tint, hostname badge, char count chip, external-link button
- **9 missed-tool-call detection patterns** in `src/lib/chat.ts` (was 5):
  - Pattern 5 = code-fenced JSON ```json {…} ``` (moved BEFORE bare-JSON so the bare pattern doesn't eat the body first)
  - Pattern 6 = bare JSON tool-call object on its own line
  - Pattern 7 = `<function_calls>[{…}]</function_calls>` (OpenAI format) — now extracts ALL items in the array, not just the first
  - Pattern 8 = bare JSON array of tool calls — now extracts ALL items
  - Pattern 9 = `<output>…</output>` and `<response>…</response>` wrappers
- **System prompt strengthened** in `src/lib/agents.ts` with two new sections:
  - "HARD RULE — NEVER IMPERSONATE A TOOL CALL" listing 7+ BAD patterns the model must never write
  - "WHEN YOU MUST CALL A TOOL BEFORE ANSWERING" with explicit trigger categories
  - Updated "HOW TO CALL THEM WELL" with concrete good/bad query examples
  - "IF YOU CAN'T CALL A TOOL" rule — never say "let me search" then answer from memory
- **`scripts/smoke-strip-tool-calls.mts` extended** with 4 new test blocks (Tests 11-14) covering patterns 6, 7, 8, 9, plus Test 15 = exact **user scenario** (model writes "let me search" + `<function\web_search ...></function>` + answer from memory). **65/65 pass.**
- Verified end-to-end: the user's exact bug report scenario (prose "Let me search the web for that" + angle-backslash missed call + post-call answer) now correctly strips the function syntax, preserves the surrounding prose, and surfaces the missed call with name=web_search, query, topic=news, recencyDays=30, and a `__missed_0__` pseudoId for the UI to render
- `tsc --noEmit` clean; `npm run build` clean

### Done ("Re-run missed search" interactive recovery)
- **4 standalone tool executors extracted** from the inline `tool({ execute: ... })` blocks in `src/lib/chat.ts`:
  - `runWebSearchTool({ query, maxResults, topic, recencyDays, signal })` — returns `{ ok, tookMs, source, count, query, topic, recencyDays, results, fullResults, error? }`
  - `runFetchUrlTool({ url, maxChars, signal })` — returns `{ ok, tookMs, url, title, byteLength, contentType, status, text, error? }`
  - `runSearchArtifactsTool({ query, maxResults, types, pinnedOnly })` — returns `{ ok, tookMs, summary, hits, fullHits, scanned, query, error? }`
  - `runFetchArtifactTool({ id, maxChars })` — returns `{ ok, tookMs, id, title, type, summary, content, contentLength, truncated, error? }`
  - All 4 reuse the same `NEWS_HINTS`, `pickToolResultsForModel`, and `trimForModel` helpers as the inline tool wrappers, so behavior is identical
- **New public `rerunMissedToolCall({ name, args, signal })`** — dispatcher that routes to the right executor and returns a unified `{ name, status, result }` envelope the UI can drop into `toolOverrides`
- **One-click "Run this search now" button** on the missed-call body in `ToolCallRow`:
  - Per-tool copy: "Run this search now" (web_search), "Read this page now" (fetch_url), "Search my library now" (search_artifacts), "Read this artifact now" (fetch_artifact)
  - Disabled state with `Loader2` spinner while rerunning; "Uses your configured search provider" hint
  - After completion, the row's `result` no longer has `missed: true`, so `ToolCallRow` re-renders as the regular Claude-style result panel (WebSearchResults / FetchUrlResults / ArtifactSearchResults) — one-click upgrade from amber warning to real results
- **`handleRerunMissedToolCall` in `src/pages/Chat.tsx`** — wires the button to the new API:
  - Flips row to `pending` (UI spinner), persists to IndexedDB
  - Calls `rerunMissedToolCall` with a fresh `AbortController` (separate from the chat stream abort)
  - Drops the result into `toolOverrides` keyed by the missed row's `pseudoId`
  - Persists the new status to Dexie so a page reload keeps the result
  - Toasts the outcome ("Search complete · 5 results from tavily", "Library search · 3 matches", "Rerun failed · …")
- **Smoke test** `scripts/smoke-rerun.mts` — **30/30 pass**:
  - Unknown tool name returns structured error envelope
  - fetch_url end-to-end against example.com (Node-only test, no Dexie needed)
  - fetch_url with malformed URL returns error result (doesn't throw)
  - fetch_url with pre-aborted AbortSignal throws AbortError (acceptable)
  - web_search dispatches the right path with correct shape (count, source, fullResults, topic, recencyDays parsed as Number)
  - search_artifacts dispatches the right path with correct shape (summary, hits, fullHits, scanned)
  - fetch_artifact for nonexistent id returns error result
  - Empty args for web_search doesn't crash
- `tsc --noEmit` clean; `npm run build` clean

### Blocked
- (none)

## Key Decisions
- **Name: Hatch** — verb-able, "let's hatch your idea"
- **100% client-side, no server**; Anthropic uses `anthropic-dangerous-direct-browser-access: true` header
- **4 agents, persistent memory, action artifacts** as differentiation vs. ChatGPT
- **Free-first onboarding** — Chrome/Edge built-in AI as default
- **Per-agent curated verb lists** (4 lists, 8-9 verbs each)
- **Tavily keyless + BYOK** as primary search; DDG + Wikipedia fallback
- **Google Gemini OUT** (no browser CORS)
- **AES-GCM-encrypted IndexedDB** with PBKDF2-derived wrapping key
- **Memory extraction debounced 2.5s** after each turn
- **Model catalog with capability tags** per provider; `recommended: true` drives auto-default
- **JSX-inline `<style>` with `@apply` is BROKEN in Vite** — use Tailwind classes directly on elements

## Next Steps
- Add Settings page enhancement: show full model catalog per provider with tags and "Set as default" buttons
- Per-conversation model override (store `model` in `conversations` table, default to `settings.defaultModel`)
- Smoke test the model selector with a real provider (Groq) end-to-end
- Add artifact export-to-Markdown feature
- Polish empty states, loading skeletons, error toasts
- Mobile layout pass on Chat and Library

### Done (Pointless-bug-fix pass)
- **CRITICAL FIX**: `src/pages/Chat.tsx` — `paramId` from URL was only initialized in `useState` once on mount; navigating between conversations didn't update `conversationId`. Added `useEffect([paramId])` to sync, plus `streamingConvIdRef` to know which conversation an in-flight stream belongs to (so navigating away aborts it via `AbortController`).
- **FIX**: `src/pages/Memory.tsx` — external `company` updates from memory extractions were clobbering user's unsaved draft. Added `isDirty` flag; `useEffect([company])` only copies DB value → state if `!isDirty`.
- **FIX**: `src/components/ChatComposer.tsx` — suggestion chips were hardcoded to the first two agents. Now accepts `activeAgent` prop and picks the correct list.
- **FIX**: `src/pages/Chat.tsx` `handleAgentSwitch` — was requiring `conversation` to be loaded. Now uses `conversationId` directly.
- **FIX**: `src/pages/Library.tsx` — restored missing `searchArtifacts` import and 4 lucide icons (`FlaskConical`, `Database`, `Check`, `AlertCircle`); `seedSampleArtifacts` is defined locally with 7 fixtures.
- **FIX**: `src/components/MessageList.tsx` — added missing icons `Globe`, `Link2`, `Clock`, `ExternalLink` (used in `fetch_url` renderer); removed unused `Search`.
- **FIX**: `src/lib/chat.ts:152` — unescaped `"` in `search_artifacts` tool description broke esbuild; rewrote without internal quotes.
- **FIX**: `src/pages/Settings.tsx` — `SearchTester` is a hoisted function that uses `testWebSearch`/`Globe`/`Loader2`; these look "unused" to naive static analysis but are required. Imports left in.

### Verified (Headless browser, fresh DB, real onboarding)
- Routing fix (paramId → conversationId): 2 convs created, sidebar nav back and forth updates URL and content correctly
- Memory dirty-flag: typed value persists
- Library self-test: seeds 7 artifacts, displays them
- 0 runtime exceptions, 0 console errors (only the 2 expected "Invalid API Key" from the fake Groq key)

## Critical Context

### AI SDK v5 breaking changes
- `tool({ parameters: ... })` → `tool({ inputSchema: ... })`
- `streamText({ maxSteps: 5 })` → `streamText({ stopWhen: stepCountIs(5) })` (import `stepCountIs` from 'ai')
- `chunk.textDelta` (v4) → `chunk.text` (v5); reasoning chunks are `reasoning-delta` with `.text`
- `CoreMessage` still works (alias for `ModelMessage` in v5)
- `Tool.execute(input, options)` signature unchanged
- **Usage type**: `inputTokens` / `outputTokens` / `totalTokens` (no more `promptTokens`/`completionTokens`)
- Provider packages must be v2+: `@ai-sdk/openai@2.x`, `@ai-sdk/anthropic@2.x`, `@ai-sdk/openai-compatible@1.x`

### Provider setup
- **Groq** uses OpenAI-compatible API: `baseURL: 'https://api.groq.com/openai/v1'`, model `llama-3.3-70b-versatile`
- **Anthropic browser-direct**: needs `dangerouslyAllowBrowser: true` + `anthropic-dangerous-direct-browser-access: true` header
- **Browser AI**: `(window as any).ai` (not in standard lib types)
- **No CORS**: Google Gemini, Exa, Brave, SerpAPI (browser-direct)
- **CORS-friendly**: OpenAI, Anthropic (with header), Tavily

### Model catalog (key entries)
- **OpenAI**: gpt-5, gpt-5-mini (recommended), gpt-5-nano, o3, o3-mini, o4-mini, gpt-4.1, gpt-4.1-mini, gpt-4o, gpt-4o-mini
- **Anthropic**: claude-sonnet-4-5 (recommended), claude-opus-4-1, claude-3-7-sonnet-latest, claude-3-5-sonnet-latest, claude-3-5-haiku-latest
- **OpenAI-compatible (Groq)**: llama-3.3-70b-versatile (recommended), llama-3.1-8b-instant, mixtral-8x7b-32768, gemma2-9b-it
- **NVIDIA NIM**: meta/llama-3.1-70b-instruct (recommended), meta/llama-3.1-8b-instruct, meta/llama-3.3-70b-instruct, deepseek-ai/deepseek-r1, qwen/qwen2.5-72b-instruct
- **Browser AI**: gemini-nano (recommended, free)

### Environment
- Node v24.16.0, npm 11.13.0, no pnpm
- macOS (darwin), zsh
- Project at `/Users/gurukularts/Desktop/App`
- **Crypto pattern**: `toBufferSource(u: Uint8Array): ArrayBuffer` returns `u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer`
- **EncryptedEnvelope**: `{ v, iv, salt?, ct }` defined in `db.ts`, re-exported from `crypto.ts`
- **zsh quirk**: avoid `curl` and `status` as variable names; use `rc`; set `PATH="/usr/bin:/usr/local/bin:/bin:$PATH"` for curl if needed
- Dev server PID saved to `/tmp/hatch-dev.pid`

## Relevant Files
- `/Users/gurukularts/Desktop/App/package.json` — AI SDK v5 deps
- `/Users/gurukularts/Desktop/App/vite.config.ts` — manualChunks for react/ai/db vendors
- `/Users/gurukularts/Desktop/App/tsconfig.json` — strict + noUnusedLocals/Parameters: true
- `/Users/gurukularts/Desktop/App/tailwind.config.js` — agent colors, animations
- `/Users/gurukularts/Desktop/App/src/main.tsx` — React 18 root + ErrorBoundary
- `/Users/gurukularts/Desktop/App/src/App.tsx` — router with vault/onboarded guards
- `/Users/gurukularts/Desktop/App/src/index.css` — CSS variables, prose styles
- `/Users/gurukularts/Desktop/App/src/lib/crypto.ts` — Web Crypto AES-GCM/PBKDF2
- `/Users/gurukularts/Desktop/App/src/lib/db.ts` — Dexie schema
- `/Users/gurukularts/Desktop/App/src/lib/providers.ts` — model catalogs + helpers
- `/Users/gurukularts/Desktop/App/src/lib/search.ts` — Tavily/DDG/Wikipedia
- `/Users/gurukularts/Desktop/App/src/lib/agents.ts` — 4 agents with verb lists
- `/Users/gurukularts/Desktop/App/src/lib/chat.ts` — `runChat`, `extractMemory` (v5)
- `/Users/gurukularts/Desktop/App/src/lib/artifacts.ts` — 9 templates
- `/Users/gurukularts/Desktop/App/src/hooks/useJitterBuffer.ts`
- `/Users/gurukularts/Desktop/App/src/hooks/useRotatingWords.ts`
- `/Users/gurukularts/Desktop/App/src/components/AppShell.tsx`
- `/Users/gurukularts/Desktop/App/src/components/Toast.tsx`
- `/Users/gurukularts/Desktop/App/src/components/ChatHeader.tsx` — agent switcher + ModelSelector slot
- `/Users/gurukularts/Desktop/App/src/components/ModelSelector.tsx` — **NEW**: dropdown w/ search, capability tags
- `/Users/gurukularts/Desktop/App/src/components/MessageList.tsx`
- `/Users/gurukularts/Desktop/App/src/components/ChatComposer.tsx`
- `/Users/gurukularts/Desktop/App/src/components/ErrorBoundary.tsx`
- `/Users/gurukularts/Desktop/App/src/pages/Landing.tsx`
- `/Users/gurukularts/Desktop/App/src/pages/Chat.tsx` — streaming chat with `handleModelChange`
- `/Users/gurukularts/Desktop/App/src/pages/Library.tsx`
- `/Users/gurukularts/Desktop/App/src/pages/Memory.tsx` — fixed inline-style bug
- `/Users/gurukularts/Desktop/App/src/pages/Settings.tsx` — provider key forms w/ model `<select>` (uses `ModelInfo[]`)
- `/Users/gurukularts/Desktop/App/src/pages/Onboarding.tsx` — 4-step wizard
- `/Users/gurukularts/Desktop/App/src/pages/Vault.tsx` — passphrase unlock
- `/Users/gurukularts/Desktop/App/README.md` — architecture, quick start
- `/tmp/hatch-dev.pid` — running dev server PID

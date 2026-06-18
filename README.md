# Hatch — your AI cofounder

A **100% client-side, BYOK, multi-provider** AI cofounder for first-time founders. One cofounder with persistent, tiered memory that actually remembers your business — plus web search, real artifacts, a weekly task & check-in ritual, and a carefully tuned streaming experience.

> **Zero servers. Zero accounts. Zero telemetry.** Your data, your keys, your business.

---

## What makes it different

- **One cofounder, persistent memory.** It remembers your idea, your customers, your decisions, and how you like to work — across every conversation. Memory is *tiered*: a structured company profile, free-form recalled notes, a founder profile, and a compacted long-term digest.
- **Memory you approve.** After a chat, Hatch quietly proposes what it learned. You review and confirm before anything is committed — no silent rewrites.
- **Real artifacts, not just chat.** It produces 90-day plans, landing pages, pricing models, investor updates — wrapped in `<artifact>` markers and saved to your Library with one click. Artifacts can be turned into tracked **tasks**.
- **A weekly rhythm.** A "Today" panel surfaces the week's tasks; a Friday **end-of-week check-in** captures what shipped, what blocked you, and what's next — with streaks to keep you honest.
- **Bring your own key, or use the browser.** OpenAI, Anthropic, NVIDIA NIM, OpenAI-compatible (Groq, Together, Ollama, LM Studio…), or Chrome/Edge's built-in Gemini Nano for free. No account, no card.
- **Sophisticated streaming.** Rotating "thinking" verbs, a jitter buffer for steady text reveal, reasoning (`<think>`) handling, and Claude Code–style tool-call chips.
- **Encrypted vault.** Everything is stored in IndexedDB and encrypted with a passphrase only you know (AES-GCM, PBKDF2 600k). We can't recover it — but neither can anyone else.
- **Earned delight.** Tasteful, accessibility-respecting reward moments — satisfying task completion, milestones, streaks, optional sound/haptics — all behind a "Feel" setting and `prefers-reduced-motion`.

## Brand — "First Light"

A warm, editorial identity grounded in the idea of an idea *hatching* at first light.

- **Yolk amber** accent (`#F2A33C` bright on dark, a deeper ember on light) — replaces the old neon orange.
- **Dual surface:** a cream "shell-paper" canvas for the editorial/home surfaces, and a warm-espresso "workspace" for Chat.
- **Type:** Fraunces (display/serif), Inter (body), JetBrains Mono (data).
- **Logomark:** the crossbar-H `HatchMark` (amber/ink inversion) in `src/components/`; SVGs in `Logo/`.

Colors are token-driven: CSS variables in `src/index.css` (`:root` = light/cream, `.dark` = warm dark) consumed through semantic Tailwind tokens in `tailwind.config.js`. **Re-skin by editing tokens, not components.**

## Quick start

```bash
npm install
npm run dev      # http://localhost:5173
```

First run is a short onboarding: welcome → vault + provider → your business → ready.

## Build & deploy

```bash
npm run build    # tsc -b && vite build → static dist/
npm run preview  # local preview of the production build
npm run lint     # tsc --noEmit (type-check only)
```

`dist/` is a fully static site — drop it on Vercel, Netlify, Cloudflare Pages, GitHub Pages, or any static host. **There is no server and no API endpoint.** Note: the build runs `tsc` first under strict settings, so an unused variable or import fails the build.

## Architecture

```
src/
├── lib/                    # Pure logic (no React)
│   ├── db.ts               # Dexie schema (versioned) + singleton helpers — source of truth
│   ├── crypto.ts           # Web Crypto: AES-GCM, PBKDF2, key wrap/unwrap, in-memory vault
│   ├── providers.ts        # AI providers (OpenAI / Anthropic / NVIDIA / OpenAI-compatible / browser AI)
│   ├── agents.ts           # Cofounder persona + system-prompt builder (injects memory)
│   ├── chat.ts             # runChat() streaming pipeline, tools, extractMemory(), compactMemory()
│   ├── search.ts           # Tavily / DuckDuckGo / Wikipedia with fallback chain
│   ├── searchUtils.ts      # BM25 scoring + helpers
│   ├── artifactSearch.ts   # BM25 search over saved artifacts (the search_artifacts tool)
│   ├── artifacts.ts        # Artifact templates + <artifact> / HTML / markdown block parser
│   ├── artifactSummarizer.ts
│   ├── tasks.ts            # Week-anchored tasks; artifact → task extraction (regex + LLM)
│   ├── memoryNodes.ts      # Free-form archival memory nodes
│   ├── personalityInfer.ts # Adapts cofounder tone from conversation patterns
│   ├── milestones.ts       # Milestone/achievement definitions + detectors (pure)
│   ├── juice.ts            # Haptics, WebAudio sound, reduced-motion, spring presets
│   └── utils.ts            # cn, time, debounce, etc.
├── hooks/
│   ├── useJitterBuffer.ts  # Smooth streaming display
│   └── useRotatingWords.ts # Variable-interval "thinking" verb rotation
├── components/             # AppShell, MessageList, ChatComposer, ChatHeader, ModelSelector,
│                           # TodayPanel, TaskCard, EndWeekDialog, CheckInsList, Library bits,
│                           # Celebration + MilestoneWatcher (reward layer), ConfettiBurst,
│                           # HatchMark / HatchWordmark, Toast, ErrorBoundary, ambient effects…
├── pages/                  # Landing, Chat, Library, Memory, Settings, Onboarding, Vault
├── App.tsx                 # Router + onboarded/vault guards + theme + app-wide providers
└── main.tsx                # React root + ErrorBoundary
```

See `CLAUDE.md` for a deeper architecture walkthrough and gotchas.

## Privacy

- **No backend.** All code is static and runs in your browser. The only outbound calls are to the AI provider you choose and (optionally) a search provider.
- **No telemetry.** No analytics, no error reporting, no cookies.
- **Encrypted at rest.** API keys, conversation contents, and company memory are AES-GCM encrypted with a key derived from your passphrase via PBKDF2 (600k iterations).
- **No recovery.** Forget the passphrase and the data is gone. Write it down.

## Supported providers

| Provider | Needs key | Default model | Browser-direct |
| --- | --- | --- | --- |
| **Chrome/Edge built-in AI** | No | gemini-nano | Yes (Chrome 128+) |
| **OpenAI** | Yes | gpt-4o-mini | Yes |
| **Anthropic** | Yes | claude-3-5-sonnet | Yes (with `anthropic-dangerous-direct-browser-access: true`) |
| **NVIDIA NIM** | Yes | meta/llama-3.1-70b-instruct | Yes |
| **OpenAI-compatible** | Yes | (user-set) | Yes (Groq, Together, Ollama, LM Studio, …) |

**Not supported (browser CORS-blocked):** Google Gemini direct, Brave Search, SerpAPI, Exa.

## Web search

- **Tavily** (primary; keyless tier + BYOK for higher limits, agent-optimized)
- **DuckDuckGo HTML** (no key, slower fallback)
- **Wikipedia REST** (no key, knowledge queries)

Hatch tries your configured provider first, then falls back through the chain automatically.

## License

MIT.

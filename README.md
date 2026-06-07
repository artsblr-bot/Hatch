# Hatch — your AI cofounder

A 100% client-side, BYOK, multi-provider AI cofounder web app for non-technical first-time founders. Four agents (Mentor, CTO, CMO, CFO) with shared persistent memory, web search, real artifacts, and a sophisticated streaming experience.

> **Zero servers. Zero accounts. Zero telemetry.** Your data, your keys, your business.

---

## Brand

- **Hatch orange** `#FF6B1A` — `hsl(21, 100%, 55%)` — used as the primary accent
- **Hatch black** `#0E0E0E` — `hsl(0, 0%, 5%)` — text + light-context mark
- **Wordmark** Inter 700, lowercase, `letter-spacing: -0.04em`
- **Mark** 100×100 tile, 15px H-stems (15% of tile), 15×15 square crossbar, 24px corner radius

Two inversion modes:
- **Dark contexts** (default): orange tile + black H
- **Light contexts**: black tile + orange H

The `HatchMark` and `HatchWordmark` components in `src/components/` handle both. SVGs are in `Logo/`.

---

## What makes it different

- **Four agents, one shared brain.** Switch between Mentor (strategy), CTO (no-code tech), CMO (positioning & copy), CFO (numbers) — they all see the same Company Memory and build on it.
- **Persistent memory with confirmation.** After every chat, Hatch quietly suggests what it learned. You review and approve before it commits. No silent rewrites.
- **Real artifacts, not just chat.** Any agent can produce a 90-day plan, a landing page, a pricing model, an investor update — wrapped in `<artifact>` markers and saved to your Library with one click.
- **Bring your own key, or use the browser.** BYOK with OpenAI, Anthropic, NVIDIA NIM, OpenAI-compatible (Groq, Together, Ollama), or just use Chrome/Edge's built-in Gemini Nano for free. No account, no card.
- **Sophisticated streaming.** Per-agent verb rotation ("Pondering…", "Sketching…", "Crunching…"), a jitter buffer for steady text reveal, animated status pipeline, and Claude Code–style tool-call chips.
- **Encrypted vault.** Everything is stored in IndexedDB, encrypted with a passphrase only you know. We can't recover it — but neither can anyone else.

## Quick start

```bash
npm install
npm run dev
```

Open http://localhost:5173. The first run walks you through a 4-step onboarding: welcome → vault + provider → your business → ready.

## Build & deploy

```bash
npm run build   # outputs dist/
npm run preview # local preview of the production build
```

The `dist/` folder is a fully static site. Drop it on Vercel, Netlify, Cloudflare Pages, GitHub Pages, or any static host. **There is no server. There is no API endpoint. There is nothing to deploy besides the static files.**

## Architecture

```
src/
├── lib/                  # Pure logic (no React)
│   ├── crypto.ts         # Web Crypto: AES-GCM, PBKDF2, key wrap/unwrap
│   ├── db.ts             # Dexie schema (8 tables) + helpers
│   ├── providers.ts      # 5 AI providers + browser-AI detection
│   ├── search.ts         # Tavily / DuckDuckGo / Wikipedia with fallback chain
│   ├── agents.ts         # 4 agent personas + system-prompt builder
│   ├── chat.ts           # runChat() + extractMemory()
│   ├── artifacts.ts      # 9 artifact templates + parser
│   └── utils.ts          # cn, uuid, formatDate, debounce
├── hooks/
│   ├── useJitterBuffer.ts  # Smooth streaming display
│   └── useRotatingWords.ts # Variable-interval verb rotation
├── components/
│   ├── AppShell.tsx       # Sidebar shell, conversations list
│   ├── ChatHeader.tsx     # Agent switcher dropdown
│   ├── MessageList.tsx    # Messages, streaming, artifacts, tool chips
│   ├── ChatComposer.tsx   # Auto-resize composer with suggestions
│   ├── ModelSelector.tsx  # Per-provider model picker w/ capability tags
│   ├── HatchMark.tsx      # Brand logomark (orange/black inversion modes)
│   ├── HatchWordmark.tsx  # Mark + "hatch" wordmark lockup
│   ├── Toast.tsx          # Toast system
│   └── ErrorBoundary.tsx  # Top-level crash fallback
├── pages/
│   ├── Landing.tsx        # Home (recent artifacts, today's plan)
│   ├── Chat.tsx           # Streaming chat
│   ├── Library.tsx        # Artifact list + markdown editor
│   ├── Memory.tsx         # Company memory + extraction review
│   ├── Settings.tsx       # Providers, search, vault, theme, export
│   ├── Onboarding.tsx     # 4-step first run
│   └── Vault.tsx          # Passphrase unlock
├── App.tsx                # Router + vault-lock guard + onboarded guard
└── main.tsx               # React root + ErrorBoundary
```

## Privacy

- **No backend.** Every byte of code is static and runs in your browser. The only outbound calls are to the AI provider you choose and (optionally) to the search provider.
- **No telemetry.** No analytics, no error reporting, no cookies.
- **Encrypted at rest.** API keys, conversation contents, and company memory are all AES-GCM encrypted with a key derived from your passphrase via PBKDF2 (600k iterations). The data is unreadable without the passphrase — and we never see it.
- **No recovery.** If you forget the passphrase, the data is gone. We can't help you. Write it down.

## Supported providers

| Provider | Needs key | Default model | Browser-direct |
| --- | --- | --- | --- |
| **Chrome/Edge built-in AI** | No | gemini-nano | Yes (Chrome 128+) |
| **OpenAI** | Yes | gpt-4o-mini | Yes |
| **Anthropic** | Yes | claude-3-5-sonnet | Yes (with `anthropic-dangerous-direct-browser-access: true`) |
| **NVIDIA NIM** | Yes | meta/llama-3.1-70b-instruct | Yes |
| **OpenAI-compatible** | Yes | (user-set) | Yes (Groq, Together, Ollama, LM Studio, etc.) |

**Not supported (browser CORS-blocked):** Google Gemini, Brave Search, SerpAPI, Exa.

## Web search

- **Tavily** (primary, free keyless tier + BYOK for higher limits, agent-optimized)
- **DuckDuckGo HTML** (no key, slow fallback)
- **Wikipedia REST** (no key, knowledge queries)

Hatch tries your configured provider first, then falls back through the chain automatically.

## Roadmap

See `AGENTS.md` and the in-conversation planning. Coming soon:

- Weekly check-ins (Friday review)
- Artifact export to PDF
- More artifact templates (financial model, customer interview kit)
- Conversation search across full text
- Multi-business support

## License

MIT.

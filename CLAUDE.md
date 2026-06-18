# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Vite dev server on http://localhost:5173
npm run build    # tsc -b && vite build  → static dist/  (this is what Vercel runs)
npm run preview  # serve the production build locally
npm run lint     # tsc --noEmit (type-check only)
```

There is no unit-test framework. Ad-hoc smoke scripts live in `scripts/`:
- `*.mts` scripts are meant to run with `npx tsx scripts/<name>.mts` (e.g. `smoke-search.mts`, `smoke-tools.mts`, `test-runchat-pipeline.mts`).
- Self-contained scripts with no external imports (e.g. `scripts/smoke-dopamine.ts`) also run under `node --experimental-strip-types scripts/<name>.ts` — useful when dependencies aren't installed.
- `smoke-tasks.cjs` requires the `jiti` dev dependency.

To "run a single test", run the one relevant smoke script directly.

## Local environment note

This repo is typically developed from a portable USB drive where `node_modules` is often incomplete and disk writes are slow. **Do not run `npm install` without explicit confirmation.** A portable toolchain (Node 22, Git) lives at `J:\Portable Tools`; prefer `node --experimental-strip-types` for verifying self-contained logic when a full build can't run. If you can't compile, reason about types/contrast statically rather than installing.

## The product in one paragraph

Hatch is a **100% client-side, BYOK** single-page app: an AI "cofounder" for first-time founders. There is **no backend** — every byte runs in the browser, all data lives in IndexedDB (via Dexie), encrypted at rest with a user passphrase. The only network calls are to the user's chosen AI provider and (optionally) a web-search provider.

## Architecture (the parts that span multiple files)

**State & persistence — `src/lib/db.ts`.** A single Dexie database (`HatchDB`) is the source of truth for everything: settings, company memory, conversations, messages, artifacts, tasks, memory nodes, check-ins, founder profile, memory digest. Singleton rows use the literal id `'singleton'` with `ensureX()`/`updateX()` helpers. The schema is versioned (`version(1)`…`version(4)`); **adding/changing an index requires a new `version().stores()` bump.**

**Crypto / vault — `src/lib/crypto.ts`.** API keys and sensitive data are AES-GCM encrypted with a key derived from the passphrase (PBKDF2, 600k iterations). The unlocked data-encryption key lives only in memory; locking clears it. `App.tsx` polls `isUnlocked()` and redirects to `/vault` when locked.

**Routing & guards — `src/App.tsx`.** Declares routes and gates them: not-onboarded → `/welcome`, has-passphrase-but-locked → `/vault`. Also applies the theme and hosts the app-wide providers (`ToastProvider`, `CelebrationProvider`, `MilestoneWatcher`). `AppShell.tsx` is the sidebar shell that wraps the routed pages via `<Outlet/>`.

**Chat pipeline — `src/lib/chat.ts` + `agents.ts` + `providers.ts`.** `runChat()` builds the system prompt (`agents.ts` `buildSystemPrompt`, which injects company memory + the founder profile + recalled memory nodes), selects a model (`providers.ts` — Anthropic, OpenAI, OpenAI-compatible, NVIDIA NIM, and Chrome/Edge browser AI), and streams via the Vercel AI SDK. It supports tool calls (`web_search`, `fetch_url`, `search_artifacts`, `recall_memory`), **strips prose-written "fake" tool calls** from weaker models, and lifts inline `<think>…</think>` reasoning out of the answer. The UI smooths the stream with a jitter buffer (`hooks/useJitterBuffer.ts`) and rotating "thinking" verbs (`hooks/useRotatingWords.ts`).

**Tiered memory.** Four layers, all in Dexie: (1) `company` — structured `CompanyMemory` singleton; (2) `memoryNodes` — free-form archival notes recalled via BM25 search (`lib/search.ts`, `searchUtils.ts`, `artifactSearch.ts`); (3) `founderProfile` — the "user.md" singleton; (4) `memoryDigest` — compacted prose (`compactMemory()` folds new nodes into the existing digest). After a chat, `extractMemory()` proposes what it learned as `memoryEvents` that the user confirms before they commit (no silent rewrites). `lib/personalityInfer.ts` adapts the cofounder's tone from conversation patterns.

**Artifacts → tasks → rituals.** Agents emit `<artifact>`-wrapped outputs that `lib/artifacts.ts` parses (template detection + HTML/markdown block parsing) and saves to the Library. `lib/tasks.ts` turns artifacts into week-anchored tasks (regex pass + LLM fallback); `TodayPanel` is the daily surface; `EndWeekDialog`/`CheckInsList` are the weekly check-in ritual.

**Reward / "juice" layer.** `lib/juice.ts` (haptics, a zero-asset WebAudio sound engine, `prefersReducedMotion()`, shared spring presets — read synchronously from a module cache that `App.tsx` syncs from `Settings.juice`), `lib/milestones.ts` (pure milestone data + detectors), and `components/Celebration.tsx` (`useCelebrate()` — confetti + cue + card). `MilestoneWatcher` fires each milestone once (recorded in `Settings.achievements`; pre-existing users are seeded silently).

**Design system is token-driven.** Colors are CSS variables in `src/index.css` (`:root` = warm cream "light", `.dark` = warm espresso "dark") consumed through semantic Tailwind tokens in `tailwind.config.js` (`bg`, `bg-subtle`, `fg`, `fg-muted`, `accent`, `accent-fg`, `border`, …). **To re-skin, edit the tokens, not the components.** Fonts: Fraunces (display/serif), Inter (body), JetBrains Mono (data). Dual-surface: `AppShell` scopes `.dark` onto the `<main>` for `/chat` so the chat route is always the dark "workspace" even when the rest of the app is in light/cream mode.

## Conventions & gotchas

- **Strict TypeScript** (`noUnusedLocals`, `noUnusedParameters`, `isolatedModules`). An unused import/var/param **fails `tsc -b`, which fails the Vercel build** — not just a warning. Use `import type { … }` for type-only imports.
- **Dexie indexes:** querying a non-indexed keyPath throws at runtime (`KeyPath … is not indexed`) and crashes the page — add the index via a new `version()` bump (see `messages.role` in v4). Booleans are not valid IndexedDB index keys; filter them in memory instead.
- **Path alias:** `@/*` → `src/*`.
- **`README.md` is partially stale.** It describes "four agents (Mentor/CTO/CMO/CFO)" and a bright-orange brand; the code now has a **single `cofounder` agent** (`AgentRole = 'cofounder'`) and a warm amber/cream "First Light" design system. Trust the code over the README for agent count, brand colors, and table count.
- New `Settings` fields are intentionally **optional and default-safe** (e.g. `juice`, `achievements`) so they don't require a Dexie migration — read them defensively.

# CLAUDE.md — Chatdex

Project context for Claude Code. Read this before making changes.

---

## What Chatdex is

Chatdex is a **local-first Claude Code session analyzer**. It ingests Claude Code JSONL traces, lets users browse/search their sessions, provides analytics, and (the current focus) detects **agent failure patterns**: loops, verification-absence, and silent reversions.

**Positioning:** a longitudinal agent evaluation instrument — not just a trace viewer. Detection explainability and the privacy architecture are the differentiators. Never compromise either for convenience.

## Current state vs. current work

**Built and working:** JSONL ingestion, session browse/search, analytics, client-side encryption (AES-GCM master key, WebAuthn+PRF-derived wrapping key, recovery-code fallback), hybrid IndexedDB (local plaintext) + Postgres (synced ciphertext) storage.

**Being built now:** the agent observability layer. The authoritative documents are:
- `SPEC-agent-observability.md` — what to build and why
- `IMPLEMENTATION_PLAN.md` — phase order, acceptance criteria, testing strategy

If a request conflicts with the spec, say so and ask rather than silently diverging.

## Hard architectural invariants

These are non-negotiable. Violating any of them is a bug even if the feature "works":

1. **No plaintext leaves the client.** Session data, findings, and user labels sync to Postgres as ciphertext only. Never add a code path that sends decrypted session content, findings evidence, or derived text to any server, log, analytics endpoint, or third-party API.
2. **Detection runs client-side**, in a Web Worker. Never move detection server-side.
3. **Findings are immutable per detector version.** Never mutate existing findings when a detector changes; bump the detector's semver and create new findings via a new `DetectorRun`.
4. **Every finding must be explainable from its stored `evidence` alone.** If a detector can't populate evidence sufficient to re-render "why this fired," the detector is incomplete.
5. **Detectors are pluggable.** New detectors implement the `Detector` interface and register in the registry; the pipeline, storage schema, and UI must not require per-detector changes.

## Tech stack

- React 19 + Vite 7 (dev server on port 4000)
- TypeScript 5.9, `strict: true` in `tsconfig.app.json` and `tsconfig.node.json`
- Tailwind CSS 4 (via `@tailwindcss/vite`, imported through `src/index.css`)
- Zustand 5 for global state (`src/stores/`); no React Query
- Storage: IndexedDB via **Dexie 4** locally (`src/lib/db.ts`, `src/lib/db/`); Postgres via **Drizzle ORM** behind a Fastify 5 API (`backend/src/`) for encrypted sync
- Crypto: WebCrypto AES-256-GCM (`src/lib/crypto/primitives.ts`). Key material is unlocked via **WebAuthn** (`@simplewebauthn/browser` + `@simplewebauthn/server`) — the earlier Argon2id/password KDF was removed on `main`. Do not reintroduce a password KDF path without an explicit spec change.
- Workers: detection pipeline will run in a Web Worker (not yet wired — see `SPEC-agent-observability.md`)

## Repository layout

**Current tree** (what exists today on `main`):

```
src/
├─ App.tsx, main.tsx
├─ index.css              # Tailwind entry
├─ components/            # shared UI
├─ pages/                 # route views
├─ hooks/
├─ stores/                # Zustand stores (appStore.ts, etc.)
├─ types/                 # unified.ts + shared types
├─ lib/
│  ├─ parsers/            # Claude.ai + Claude Code JSONL parsers (ingest)
│  ├─ db.ts, db/          # Dexie IndexedDB schema + helpers
│  ├─ crypto/             # AES-GCM primitives, keyManager, recovery — DO NOT modify without explicit instruction
│  ├─ auth/               # WebAuthn client + session
│  ├─ sync/               # encrypted sync engine
│  ├─ api.ts              # backend REST client
│  ├─ analytics.ts, search.ts, import.ts, license.ts
│  ├─ aipkms/             # planned AIPKMS feature layer
│  ├─ exporters/, fs/, utils/
└─ test/
backend/
├─ src/
│  ├─ index.ts            # Fastify entry
│  ├─ routes/, middleware/, utils/
│  └─ db/                 # Drizzle schema
```

**Planned addition for the observability layer** (from `SPEC-agent-observability.md` / `IMPLEMENTATION_PLAN.md` — not yet created):

```
src/lib/
├─ detection/         # NEW — the observability layer
│  ├─ normalize.ts    # step + tool-call normalization, signatures
│  ├─ registry.ts     # detector registry
│  ├─ detectors/
│  │  ├─ loop.ts
│  │  ├─ verificationAbsence.ts
│  │  └─ reversion.ts
│  ├─ pipeline.ts     # orchestration, DetectorRun lifecycle
│  └─ worker.ts       # Web Worker entry
```

Extend `src/lib/db.ts` / `src/lib/sync/` for `Finding` and `DetectorRun` storage. Extend existing `pages/` + `components/` for the findings overlay on the session browser and observability views on the dashboard.

## Commands

```
dev server (frontend):     npm run dev            # Vite → http://localhost:4000
dev server (backend):      npm run dev:backend    # Fastify → http://localhost:3003
dev server (both):         npm run dev:all
typecheck:                 npm run typecheck      # tsc -b (project refs; plain tsc --noEmit checks nothing here)
lint:                      npm run lint           # eslint .
lint (fix):                npm run lint:fix
unit tests (frontend):     npm test               # vitest run
unit tests (watch):        npm run test:watch
unit tests (all):          npm run test:all       # frontend + backend vitest
coverage:                  npm run test:coverage
build (frontend):          npm run build          # tsc -b && vite build
build (all):               npm run build:all
Postgres (Docker):         npm run docker:up      # port 5433
db schema push:            npm run db:push        # drizzle-kit push
db studio:                 npm run db:studio
```

## Development workflow rules

- **Always run typecheck + tests before declaring a task done.** (Yes, the irony of skipping verification while building a verification-absence detector is noted. Don't be a finding.)
- **Write tests alongside detector logic, not after.** Every detector rule and every suppression rule gets at least one golden-trace test (see `tests/golden-traces/` and IMPLEMENTATION_PLAN.md).
- Prefer small, reviewable diffs. One detector or one pipeline concern per change.
- When adding a detector rule or threshold, make it configurable via `DetectorConfig` with a documented default — no magic numbers inline.
- Never touch `src/crypto/` without being explicitly asked to.
- If session fixtures are needed for tests, use the sanitized fixtures in `tests/golden-traces/` — never commit real personal session data.

## Domain vocabulary

- **Step:** one entry in a session's normalized event stream (user msg, agent text, tool call, tool result).
- **Signature:** normalized `tool_name + canonicalized_args` used for loop matching.
- **State-changing / verification-shaped / neutral:** the three tool-call classes used by verification-absence detection.
- **Finding:** one detected failure instance, anchored to a step range, with evidence.
- **DetectorRun:** one execution of the detector suite over one session with pinned versions/config.
- **Suppression rule:** a check that prevents a false positive (e.g., retry whitelist); always recorded in `suppressions_evaluated` even when it doesn't fire.
- **Golden trace:** a hand-labeled JSONL fixture with known expected findings, used as the regression suite.

## Things Claude Code should NOT do

- Don't add server-side analysis, telemetry, or "just send it to an LLM API" shortcuts for detection. Client-side only.
- Don't merge or reuse finding rows across detector versions.
- Don't broaden detector heuristics to reduce false negatives without adding the corresponding suppression tests — false positives destroy user trust in this product faster than misses.
- Don't invent new failure-pattern detectors beyond the spec'd three without asking.

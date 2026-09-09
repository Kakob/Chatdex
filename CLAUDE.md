# CLAUDE.md — Chatdex

Project context for Claude Code. Read this before making changes.

---

## What Chatdex is

Chatdex is a **local-first AI-conversation workspace**. It ingests conversation history from multiple providers (Claude.ai, Claude Code JSONL, ChatGPT), lets users browse/search/analyze it, detects **agent failure patterns** (loops, verification-absence, silent reversions), and is growing a **shared understanding workspace** that reconstructs projects and synthesizes current understanding from conversation history (`docs/capabilities/understanding-workspace/PRD.md`).

**Positioning (updated 2026-08-09):** Chatdex is moving away from the client-side-only power-user framing toward robust LLM-provider interactions for synthesis. Detection explainability and encrypted-at-rest sync remain differentiators; the *detection layer* specifically stays fully client-side (see invariants).

## Current state and current work

Read [docs/capabilities/README.md](docs/capabilities/README.md) for capability status
and [docs/changes/README.md](docs/changes/README.md) for bounded work. Do not duplicate
those status tables here. Capability specs retain their architectural laws, security
requirements, and consumer-specific contracts; change plans identify proposed amendments.

Decision Investigation remains quarantined from AI recovery under its spec. Flow Map
remains a draft capability until its outstanding design decisions are resolved. These
boundaries are not changed by the documentation reorganization.

## Where docs live

Current capability contracts live in `docs/capabilities/<capability>/`. Bounded
work packages live in `docs/changes/<change>/`. Read `docs/changes/README.md` for
ownership, planning, spec amendments, completion, and the lightweight plan template.

- `docs/capabilities/README.md` is the capability status and ownership index.
- `docs/changes/README.md` indexes change packages; each package's PLAN.md owns its
  delivery status and open acceptance checks. Index summaries link to that plan.
- A proposal never silently overrides a capability spec. Identify affected sections
  in the change plan and amend them as the corresponding behavior lands.
- Before closing work, update affected contracts, record verification and limitations,
  and close the plan. Small fixes need no change folder unless a durable plan helps.
- Keep historical build logs and completed plans as history. Do not copy them into
  current contracts. Existing capability-local plans/logs are retained legacy records;
  new bounded work uses `docs/changes/`.

Other documents: `docs/prds/` (product-level requirements), `docs/architecture/`,
`docs/territories/` (code walkthroughs), `docs/ownership/`, `docs/assessments/`,
`docs/vision/`, and `docs/archive/` (historical; links inside are not maintained).
Index: `docs/README.md`.

## Hard architectural invariants

These are non-negotiable. Violating any of them is a bug even if the feature "works":

**Sync & storage:**

1. **Sync is ciphertext-only.** Session data, findings, understanding objects, and user labels sync to Postgres as ciphertext. The sync pipeline (`src/lib/sync/`, `/api/sync/*`) must never carry or store plaintext server-side.

**Detection layer (sequestered — the original client-side-only guarantee lives here, unchanged):**

2. **Detection runs client-side**, in a Web Worker. Never move detection server-side, and never route detection through an LLM API. Detection results must never depend on network availability.
3. **Findings are immutable per detector version.** Never mutate existing findings when a detector changes; bump the detector's semver and create new findings via a new `DetectorRun`.
4. **Every finding must be explainable from its stored `evidence` alone.** If a detector can't populate evidence sufficient to re-render "why this fired," the detector is incomplete.
5. **Detectors are pluggable.** New detectors implement the `Detector` interface and register in the registry; the pipeline, storage schema, and UI must not require per-detector changes.

**AI synthesis boundary (amended 2026-08-09 — supersedes the former global "no plaintext leaves the client" rule):**

6. **Synthesis may use user-authenticated LLM providers.** The understanding layer (project discovery, understanding synthesis — PRD stages U1+) may send conversation plaintext to LLM providers, under these conditions:
   - **User-initiated and opt-in.** No conversation content goes to a provider without the user having explicitly enabled synthesis and supplied their own credentials.
   - **Backend relay is transit-only.** The Chatdex backend may proxy provider calls (streaming, rate limiting), but must never persist or log request/response content. Relay handlers must not write conversation plaintext to the database, log lines, or error traces.
   - **Cross-provider disclosure is explicit.** Sending one provider's history to a different provider (e.g., ChatGPT conversations to Anthropic) is a new disclosure; the UI must state which provider will receive which sources before the first such call.
   - **Synthesis outputs are user data.** Understanding objects derived from LLM calls store like everything else: plaintext in IndexedDB, ciphertext in sync.
   - **Transcript excerpts and edit hunks follow the same rule (Decision Recovery, 2026-09-07).** Decision recovery sends the user's messages, the agent's reasoning around each edit, its closing statements, and the edit hunks themselves to the provider under the same user-initiated, disclosed, transit-only conditions; the disclosure states the session, hunk, and repository-excerpt counts (`docs/capabilities/decision-recovery/SPEC.md` §2.6).
   - **Repository excerpts follow the same rule (Intent Trace, 2026-08-28).** File and spec-document excerpts fetched read-only from GitHub are user data and may be sent to the provider under the same user-initiated, disclosed, transit-only conditions — the disclosure must say repository excerpts are being sent. The GitHub token is device-local, goes only to api.github.com, and never enters a relay body or a prompt (`docs/capabilities/intent-trace/SPEC.md` §13). **Whole repository files may be cached locally for Change Workspace search** (GitHub at a pinned sha, or a user-picked local directory, read-only) in a LOCAL-ONLY IndexedDB table that is never synced; synced workspace records carry only paths, shas, line ranges, and capped quotes (`docs/capabilities/change-workspace/SPEC.md` §2.5).

## Tech stack

- React 19 + Vite 7 (dev server on port 4000)
- TypeScript 5.9, `strict: true` in `tsconfig.app.json` and `tsconfig.node.json`
- Tailwind CSS 4 (via `@tailwindcss/vite`, imported through `src/index.css`)
- Zustand 5 for global state (`src/stores/`); no React Query
- Storage: IndexedDB via **Dexie 4** locally (`src/lib/db.ts`, `src/lib/db/`); Postgres via **Drizzle ORM** behind a Fastify 5 API (`backend/src/`) for encrypted sync
- Crypto: WebCrypto AES-256-GCM (`src/lib/crypto/primitives.ts`). Key material is unlocked via **WebAuthn** (`@simplewebauthn/browser` + `@simplewebauthn/server`) — the earlier Argon2id/password KDF was removed on `main`. Do not reintroduce a password KDF path without an explicit spec change.
- Workers: the detection pipeline runs in a Web Worker (`src/lib/detection/worker.ts`, `workerClient.ts`); the worker computes only and the main thread persists so Dexie sync hooks fire. Falls back to the main thread only where `Worker` is undefined (tests).

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

**Observability layer** (built; contract in `docs/capabilities/agent-observability/SPEC.md`):

```
src/lib/
├─ detection/
│  ├─ normalize.ts, signatures.ts, classify.ts   # step/tool-call normalization, signatures, tool classes
│  ├─ registry.ts, registerAll.ts               # detector registry (three detectors registered)
│  ├─ detectors/
│  │  ├─ loop.ts
│  │  ├─ verificationAbsence.ts
│  │  └─ reversion.ts
│  ├─ pipeline.ts                               # orchestration, DetectorRun lifecycle, idempotency
│  ├─ worker.ts, workerClient.ts, workerHandler.ts
│  ├─ autoAnalyze.ts, staleness.ts, stats.ts, findingAnchors.ts
```

`Finding` and `DetectorRun` storage lives in `src/lib/db/` and syncs as ciphertext via `src/lib/sync/`. Findings surface inside Browse, Analytics, Settings, and `HowDetectionWorksPage`; there is no dedicated route. The intervention amendment (SPEC §10, phases I0–I6) is documented but unbuilt.

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
unit tests (backend):      cd backend && npm test # vitest on an in-process PGlite Postgres; no service needed
typecheck (backend+tests): cd backend && npm run typecheck
coverage:                  npm run test:coverage
build (frontend):          npm run build          # tsc -b && vite build
build (all):               npm run build:all
Postgres (Docker):         npm run docker:up      # port 5433
db schema push:            npm run db:push        # drizzle-kit push
db studio:                 npm run db:studio
```

## Development workflow rules

- **Always run typecheck + tests before declaring a task done.** (Yes, the irony of skipping verification while building a verification-absence detector is noted. Don't be a finding.)
- **Write tests alongside detector logic, not after.** Every detector rule and every suppression rule gets at least one golden-trace test (see `tests/golden-traces/` and `docs/capabilities/agent-observability/PLAN.md`).
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

- Don't add server-side analysis, telemetry, or "just send it to an LLM API" shortcuts **for detection** — that layer is client-side only. (Synthesis is different: see invariant 6.)
- Don't log or persist conversation plaintext in backend relay handlers — relay is transit-only.
- Don't merge or reuse finding rows across detector versions.
- Don't broaden detector heuristics to reduce false negatives without adding the corresponding suppression tests — false positives destroy user trust in this product faster than misses.
- Don't invent new failure-pattern detectors beyond the spec'd three without asking.

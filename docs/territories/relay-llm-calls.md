# Territory: Relay an LLM call

The transit-only bridge between the browser and the user's own LLM accounts: API-key mode and the subscription (CLI-login) mode, streaming and not.

## The question

When synthesis or chat calls a model, what exactly does the backend see, keep, and log — and what do the two auth modes actually do under the hood?

## User-visible behavior

```
Settings → LLM Providers: pick Anthropic/OpenAI, choose auth mode
  · api-key: paste a key (stored locally, synced as ciphertext)
  · subscription: no credential — uses the Claude Code / Codex CLI login
    on the machine running the backend
    ↓
"ready" providers appear in Discover/Reconcile/Chat pickers
    ↓
calls stream (chat) or complete (synthesis); errors surface as terse toasts
```

## Entry point

- Client: `src/lib/providers/relayClient.ts` — `complete()` (:59), `streamComplete()` (:100), `listReadyProviders()` (:181).
- Server: `backend/src/routes/llm.ts` — `POST /api/llm/complete` (:282), `POST /api/llm/stream` (:353), `GET /api/llm/subscription/status` (:428). All three **JWT-gated** (`preHandler: app.authenticate`).

## Control-flow path

```
buildRelayBody                          relayClient.ts:27
  api-key mode: requires stored key (metadata['llm.apiKey.<provider>']),
                model = request.model ?? provider default
  subscription:  NO apiKey, NO model unless explicit (CLI default applies)
    ↓ POST with Bearer JWT (if any)
zod CompleteSchema                      llm.ts:26 — messages ≤500, maxTokens ≤64k;
    ↓                                   failure → 400 'Invalid relay request'
                                        (zod issues deliberately not returned — they can carry content)
  api-key branch:  callAnthropic (system hoisted to top-level field) /
                   callOpenAI — plain fetch to the provider
  subscription:    splitSystem() flattens roles → one prompt string →
                   Agent SDK (Claude) / Codex SDK — a CLI subprocess bridge
    ↓
normalize → {text, model, usage:{inputTokens, outputTokens}}
errors → 502 with FIXED STRINGS or provider error *type* only
```

Streaming adds: SSE `PassThrough` (`delta`/`done`/`error` events), a `closed` guard for client disconnects, and `req.raw.on('close') → abort()` — which aborts the upstream fetch in api-key mode but **not** the subscription bridges (they finish server-side; the response is discarded). Client-side, `SSEParser` accumulates deltas as **display-only hints**; the final `done` payload is authoritative and is what gets persisted. [CODE]

### The subscription bridge (`backend/src/llm/subscription.ts`)

Not OAuth. It spawns the vendor SDKs on the backend host and inherits the CLI's existing login — per the build log, the Agent SDK path is "the only sanctioned subscription path — raw OAuth against /v1/messages is banned". [DOC]

- **Anthropic:** `query()` from `@anthropic-ai/claude-agent-sdk`, `tools: []`, `maxTurns: 1`, no session persistence, cwd = tmpdir. **`delete env.ANTHROPIC_API_KEY`** before spawning — a key in the env would silently switch billing to pay-per-token. [CODE :46-47]
- **OpenAI:** Codex SDK thread, read-only sandbox, history persistence off; env rebuilt from scratch excluding both key vars. No system-prompt option → system is string-concatenated. Streaming is prefix-diffing over full-text snapshots. Known cost caveat: Codex wraps every call in its agent harness (~14k input tokens observed for a one-liner) — prefer Anthropic for big runs. [CODE + DOC build log]
- **Status check is existence-only** (keychain entry / `~/.codex/auth.json` present) — a stale login reports ready and fails at call time. [CODE :182-201]
- `maxTokens`/`temperature` are **silently ignored** in subscription mode. [DOC build log]

## Data flow

```
messages (plaintext) ──JWT'd POST──► backend (in-memory only) ──► provider / CLI SDK
                                          │ no db import, no log call [CODE-verified]
response text ◄── normalize ◄─────────────┘
API keys: Dexie metadata (PLAINTEXT locally, by stated design —
"same trust level as conversation content") → sync as ciphertext →
every synced device holds the key. [CODE credentials.ts:1-4]
```

## Decisions and invariants

**Transit-only (CLAUDE.md invariant 6): VERIFIED in code, unverified by tests.** Grep-audited: zero `console/log/logger` and zero db references in `routes/llm.ts` + `llm/*.ts`; every error path returns a fixed string or a provider error *type* (`RelayError`/`SubscriptionError` exist precisely to mark messages content-free). [CODE]
Residual exposure the invariant text doesn't cover: `Fastify({logger: true})` logs request metadata (path, status, timing, per-user pattern) for relay calls like any route; the global 100 MB body limit applies; vendor SDKs may keep their own local state (Codex rollouts under `~/.codex/sessions`). The disclosure modal's "nothing is stored or logged server-side" is stronger than what's guaranteed. [CODE vs UI copy]

**Decision:** Relay requires a Chatdex cloud login (JWT) — in an app that is otherwise fully local-first.
**Evidence:** [CODE llm.ts:282/:353/:428]
**Consequence:** a user with an API key but no cloud account is shown "ready" providers (`listReadyProviders` never contacts the backend for api-key mode), confirms a disclosure modal, and then gets a bare `LLM relay failed: 401`. Whether the JWT gate is intentional (relay as an authenticated service) or copied from the sync routes is **the top fog item of this territory**.

**Decision:** No rate limiting, no quotas, no concurrency caps — anywhere.
**Evidence:** [CODE — exhaustive grep; the only "rate limit" hit in the repo is an unrelated PRD]
**Consequence:** CLAUDE.md's "may proxy (streaming, rate limiting)" is half-realized; cost control is entirely the user's problem.

## Failure modes

- 401 (no/stale JWT) → terse error after the user already consented to disclosure.
- Stale CLI login → status says ready, call throws `SubscriptionError`.
- Backend down → subscription statuses read `false`, api-key providers still look ready.
- Mid-stream provider error → `{type:'error'}` event → client throws → **partial text discarded** (only user Stop preserves it).
- Relay dies without `done` → "stream ended without a completion".

## Tests and verification

`providers.test.ts` covers `complete()` body-shape rules well (key required, subscription omits key+model, providerStatus surfaced) and both SSE parsers are solidly tested. [TEST]
**Zero tests for `routes/llm.ts` and `subscription.ts`** — the transit-only property, the env-stripping billing guard, and `streamComplete`'s state machine are all unasserted. The single most consequential privacy claim in the product has no automated check. Also: root `typecheck` doesn't cover `backend/`, and `backend/package.json` has no test script.

## Visual map

```
browser ──Bearer JWT──► /api/llm/{complete,stream}          [no log, no db]
   │                        ├─ api-key: fetch provider API (abortable)
   │ keys: Dexie metadata   └─ subscription: CLI-login SDK subprocess
   │ (plaintext local,           (env stripped of API keys; not abortable)
   │  ciphertext sync)      errors → fixed strings / error types only
   ▼
deltas = display hints; final done payload is authoritative
```

## Suggested walk

1. Read `providers/types.ts` + `registry.ts` (small) — the provider abstraction.
2. Read `relayClient.ts:27-57` (`buildRelayBody`); predict what the server must validate.
3. Read `routes/llm.ts:26-46` (schema) and :282-346 (`/complete`) — check each error path yourself for content leakage.
4. Read `subscription.ts` — find the env-stripping lines and articulate why they exist before reading the comments.
5. Read `streamComplete` + `sse.ts`; then the server stream route; map the delta/done/error contract end to end.
6. Confirm the JWT gate on all three routes, then find any place the client checks for it first (you won't).

## Ownership challenge

Write the first test file for `backend/src/routes/llm.ts` with a mocked provider: assert (a) a provider error body's message text never reaches the client, (b) an invalid request returns the fixed string with no echoed content, (c) api-key mode without a model 400s. This converts the product's central privacy promise from grep-verified to test-enforced.

## Fog

- ? Is the JWT gate on the relay intentional? (Local-first user + API key = unexplained 401.)
- ? Is key-syncs-to-every-device the intended credential model, and does the user know?
- ? Should the disclosure copy be softened to match reality (request metadata is logged)?
- ? Is rate limiting / cost visibility (token estimates, batch size setting) planned? Backlogged but unshipped.
- ? Should subscription status validate the login (a cheap ping) instead of file existence?
- ? Are subscription-mode's ignored `maxTokens`/`temperature` acceptable, or should the UI hide those knobs in that mode?

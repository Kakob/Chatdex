# Chatdex Application Atlas

A behavior-oriented map of this codebase: what the application *does*, where each behavior lives, and what remains foggy. Built from a full-repo archaeology pass on 2026-08-17 (HEAD `63d7012`). Organized by territory, not by directory.

**Evidence legend** (used throughout the territory docs):

```
[CODE]      directly observed in implementation
[TEST]      established by a test assertion
[DOC]       explicitly stated in existing documentation/spec/comments
[INFERRED]  reasonable interpretation of how code relates
[UNKNOWN]   cannot currently be established
```

When implementation, tests, and docs disagree, the disagreement is stated, not resolved.

---

## The application in one paragraph

Chatdex ingests AI-conversation history (Claude.ai exports, Claude Code JSONL, ChatGPT exports) into a **local-first plaintext IndexedDB**, lets you browse/search/tag/export it, **detects agent failure patterns** (loops, verification absence, silent reversions) entirely client-side in a Web Worker, and — with your own LLM credentials, behind explicit disclosure — **synthesizes "understanding"** of your projects from that history, which feeds back into native chats. A passkey-derived key encrypts everything for **ciphertext-only sync** to Postgres; the server is a blind blob store plus a transit-only LLM relay. The vault gates *only* sync — everything else works locked, offline, accountless.

---

## Territory index

### Core territories (full docs)

| Territory | One sentence | Entry point | Status | Doc |
|---|---|---|---|---|
| **Import a conversation** | Three entry paths converge on parse→normalize→dedup→persist, then auto-analysis; re-import never updates. | `useImport.handleFiles` → `lib/import.ts` | core | [import-a-conversation.md](import-a-conversation.md) |
| **Search and browse** | Main-thread Fuse index over denormalized `fullText`; five non-reactive caches over Dexie with manual, incomplete invalidation. | `lib/search.ts`, `useConversations` | core | [search-and-browse.md](search-and-browse.md) |
| **Detect agent failures** | Worker-hosted, versioned, evidence-carrying detector pipeline — the product's distinctive layer and its best-tested code. | `lib/detection/autoAnalyze.ts` → `pipeline.ts` | core | [detect-agent-failures.md](detect-agent-failures.md) |
| **Synthesize understanding** | LLM-extracted projects/objects/events behind a structural evidence requirement and a human review gate; closes the loop into chat. | `lib/understanding/{discovery,reconcile}.ts` | core (newest, U1–U6) | [synthesize-understanding.md](synthesize-understanding.md) |
| **Relay an LLM call** | Transit-only proxy to the user's own provider accounts — API-key mode or CLI-login subscription bridge; JWT-gated, unlogged, untested. | `lib/providers/relayClient.ts` → `backend/src/routes/llm.ts` | core | [relay-llm-calls.md](relay-llm-calls.md) |
| **Unlock the vault** | Passkey-PRF key wrapping, recovery codes, never-expiring JWTs; gates only sync, not the app. | `CloudSyncSection.tsx` → `lib/auth/session.ts` | core | [unlock-the-vault.md](unlock-the-vault.md) |
| **Sync encrypted state** | Dexie-hook dirty queue → per-record AES-GCM → LWW blob store; silent, Settings-gated, with a suspected metadata ping-pong loop. | `lib/sync/engine.ts` | core | [sync-encrypted-state.md](sync-encrypted-state.md) |

### Supporting territories (documented here, no separate doc)

**Native chat (U5)** — `lib/chat/chats.ts`, `ChatPage.tsx`. Chats are `StoredConversation`s with `source: 'chatdex'`, written with strictly-increasing message timestamps [CODE chats.ts:139]; streaming replies persist the authoritative `done` payload, not the deltas; a chat is itself a reconciliation source (the closed loop). Covered inside the understanding and relay docs. *Status: core, live-verified.*

**Analytics** — `useAnalytics` → precomputed `dailyStats`, rebuilt **only** by the manual "Recompute" button (`api.recomputeStats` — full message-table scan, UTC bucketing, `modelUsage` never populated so the model chart is permanently empty) [CODE]. Sits beside the detection dashboard, which computes on-read — two aggregation philosophies on one page. *Status: supporting, partially broken after the local-first migration.*

**Timeline** — reads an `activities` table **nothing in the app writes**; its feeder (a Chrome extension) lives on another branch and targeted a backend route that no longer exists. A live event listener remains wired to a ghost. *Status: legacy/dead — permanently empty.* [CODE]

**Tagging** — Dexie `tags`/`entityTags` with idempotent transactional `tagEntity` and a denormalized `usageCount`; four simultaneous UI copies of tag state; conversation deletion orphans tag links. *Status: supporting.* [CODE db/tags.ts]

**Knowledge / anchors (AIPKMS)** — the anchors *feature* (bookmark a message → Knowledge page) is live but frozen since April 2026; the `lib/aipkms/` *module* is **5/6 dead code** (threads, workspaces, synthesis, relevance — zero call sites, kept green by their own tests). It is the older, superseded sibling of the understanding layer: two competing knowledge systems, only one alive. Edit button is a shipped no-op TODO; text-selection anchoring is built but unmounted. *Status: partly live, partly legacy; overlap unresolved.* [CODE]

**Exporters** — pure builders (markdown/json/csv) + download helper; markdown export silently drops system/tool messages and all content blocks [TEST]. A shared `ExportMenu` component exists with zero call sites while two pages hand-roll hover-only menus. *Status: supporting.*

**App shell & licensing** — `main.tsx` renders and nothing else: **no boot orchestration**. Theme/'isPro'/counts/auth all hydrate lazily or never; sync and auth wake only when Settings mounts. License is an HMAC check whose secret ships in the client bundle (trivially forgeable) and gates exactly one thing: search-corpus size >100. Header has two dead buttons ("Sync data", "Upgrade to Pro"). *Status: supporting; licensing effectively decorative.* [CODE]

---

## Relationships between territories

```
                    ┌─────────────────────────────────────────────────┐
                    │                  Dexie (15 tables)               │
                    │        single source of truth, plaintext         │
                    └─────────────────────────────────────────────────┘
  IMPORT ──writes──►  conversations/messages  ◄──writes── NATIVE CHAT
     │ triggers                │ reads                        ▲ context
     ▼                         ▼                              │
  DETECTION ──findings──► BROWSE/SEARCH ◄──evidence links── UNDERSTANDING
  (worker, no network)    (5 stale-prone caches)              │ digests
                                                              ▼
  VAULT ──master key──► SYNC (hooks on all 15 tables)      LLM RELAY
  (gates sync only)     (ciphertext → Postgres)         (plaintext out, by consent)
```

- Import → Detection: automatic for new claude-code sessions only.
- Import ↛ Analytics/Search-freshness/Sync: three things people expect import to do that it doesn't fully do (stats never recompute; index invalidates but caches don't refresh; sync only if the engine was already started).
- Understanding ↔ Chat: bidirectional — the closed loop that is the product's current bet.
- Vault → everything else: **weaker than it looks** — only sync needs the key.
- Detection ∥ Understanding: deliberately independent (client-only vs LLM-assisted); they meet only in the UI.

---

## Cross-cutting findings (read these before trusting any doc in `docs/`)

1. **Documentation stratigraphy.** `docs/` contains three eras: extension-era (Jan–May 2026: activity tracker, AIPKMS PRDs, old CLAUDE.mds — describe code that no longer exists here), observability-era (Jul: SPEC + plan + build log — accurate except unbuilt §10), understanding-era (Aug: PRD + build plan + build log — most current; the build log is the single most reliable document in the repo). Root `CLAUDE.md` is authoritative on invariants but stale on the repo tree (calls detection "not yet created", omits `understanding/`, `chat/`, `providers/`).
2. **Doc-vs-code disagreements are catalogued per territory.** Highlights: auth doc claims the server never sees key material (false for the recovery path); architecture doc describes 9 tables/9 sync kinds (reality: 15/15) and a `varchar(20)` that the code — but not the checked-in migration — outgrew; CLAUDE.md's "always run typecheck" doesn't cover `backend/` at all.
3. **Committed secrets.** `backend/.env` (Neon URL+password, `JWT_SECRET`, Google OAuth pair — the latter referenced nowhere in code) and `.env.local` (`VITE_LICENSE_SECRET`, `VITE_DEV_PRO=true`) appear tracked. Worth an immediate decision regardless of documentation goals. [CODE]
4. **The test suite's shape is inverted from the risk surface.** Detection and understanding engines: excellent. The privacy-critical seams — backend auth routes, backend sync route, backend LLM relay, the crypto orchestration in `session.ts`, `search.ts` — have **zero tests**. Dead AIPKMS code has passing tests keeping it green.

---

## Highest-value territories to learn first (ranked)

1. **Import** — smallest complete vertical slice; teaches the unified data model everything else reads; its dedup rule explains downstream staleness behaviors.
2. **Search & browse** — teaches the app's universal state pattern (Dexie + non-reactive snapshots + manual invalidation); once you see it here you'll recognize it everywhere.
3. **Detection** — the product's distinctive engine, best code and best tests; teaches the versioning/evidence/worker contracts and the domain vocabulary in CLAUDE.md.
4. **Sync** — the most intricate machinery; teaches the hooks coupling, LWW, and why several other territories behave oddly (Settings-gated start, echo pushes).
5. **Vault** — small line count, high concept density (key wrapping, PRF, stateless tokens); unlocks reading sync and the backend.
6. **Understanding** — the largest and newest territory; approachable after import (data model) and relay (transport) are familiar.
7. **Relay** — short, and carries the product's central privacy promise.

## Good 15–30 minute code-comprehension exercises

- `lib/crypto/` + `keyManager.ts` (~200 lines total) — the whole crypto core.
- `lib/detection/signatures.ts` + its test — canonicalization in miniature.
- `lib/understanding/livingDocument.ts` — a pure, deterministic projection with a determinism contract.
- `lib/chat/context.ts` — the token-budget shrink ladder.
- `backend/src/utils/challengeToken.ts` (71 lines) — stateless challenge design.
- `lib/parsers/chatgpt.ts:153-281` — the canonical-path tree walk.
- `lib/db/understanding.ts` — two structural invariants enforced in ~250 lines.
- `components/detection/EvidencePanel.tsx` — verify the "explainable from evidence" claim yourself.

## Architectural seams

- **UI ↔ data**: hooks/stores over Dexie with no reactivity — every staleness bug lives on this seam.
- **parser ↔ unified model**: `ParsedData`/`StoredConversation` — provider quirks stop here.
- **main thread ↔ worker**: detection computes in the worker, persists on main (Dexie hooks are per-instance) — the one place this repo splits compute from writes.
- **local ↔ remote**: Dexie hooks → sync engine → blind blob server; plaintext never crosses except through the relay.
- **plaintext ↔ ciphertext**: `keyManager` + `serializer` — one flat master key, per-record GCM.
- **app ↔ provider**: relayClient → JWT-gated backend → API or CLI-SDK subprocess.
- **AI output ↔ database**: the parse firewalls in `discovery.ts`/`reconcile.ts` — the only doors LLM output can enter through.
- **auth ↔ app behavior**: deliberately thin — the vault gates sync only.

## Cognitive debt hotspots

- **Two knowledge systems** (AIPKMS vs understanding) sharing a table (`anchors`) and a nav page, with no recorded supersession decision.
- **Timeline/activities/extension residue** — live listeners and typed enums for a feature whose writer left the repo.
- **The lazy-boot shell** — behavior depends on which pages you've visited (isPro, sync, auth, counts, theme). Nothing documents this; it reads as bugs until you know.
- **Sync engine** — correct-looking code whose emergent behaviors (echo pushes, ping-pong, cursor ties) exist only in interaction; the tests are regression patches, not a spec.
- **Recovery-path crypto** — the doc says one thing, the code does another, and the normalization bug suggests it's never been run end-to-end.
- **Dead-but-tested code** (`lib/aipkms/`), dead UI state (`authStore.syncing`, `appStore.isImporting`), dead buttons — surfaces that look load-bearing and aren't.
- **`api.ts`** — an HTTP-shaped façade over local Dexie, kept for migration compatibility; its vocabulary (`ApiError`, `pagination`) actively misleads.

## Suggested learning order

```
function        crypto primitives · signatures · livingDocument · challengeToken
   ↓
behavior        import a file end-to-end · run one detector on a golden trace ·
                one search query · one tag operation
   ↓
territory       the 7 core docs, in the ranked order above
   ↓
subsystem       Dexie schema v1→v4 as the app's fossil record ·
                the backend as three services (auth/sync/relay)
   ↓
whole app       the closed loop: import → detect → understand → chat → reconcile —
                then re-read CLAUDE.md's invariants and check each one yourself
```

# Invariant register

**Date:** 2026-09-09 · **HEAD:** `3b66fa0` (branch `feature/project-workspace-golden-path`, clean tree) · **Method:** read-only extraction by seven parallel agents over every rule-bearing document, followed by grep verification of every Tier 1 guard-test name and a read of the cited code for every spec-drift row. At extraction no source, test, or spec was modified and suites were not run. **Updated 2026-09-09 (same day):** the three spec-drift rows were fixed (`db060a6`, `9b59690`, `69e00c0`) and a backend test harness landed (`8cd29d8`); rows marked `guarded (2026-09-09)` were verified by running `cd backend && npm test` (53 tests) and `npm run test:all`, plus five deliberate mutations that each failed at least one test (recorded in the backend-test-harness plan Outcome). `guarded` elsewhere still means a test with that name asserts the property.

## Why this exists

The specs contain roughly 150 normative sentences and the code has 117 test files. Nobody can hold that in their head, and prose enforces nothing. This register is one row per guarantee, pointing at the document that owns it and the test that would fail if it were broken. An empty test column is the finding.

**Tier 1 is the list to hold in your head.** Everything else is a lookup table.

## How to read a row

`ID | Guarantee | Owner § | Enforcing code | Guard test | Status`

Paths are repo-relative. Test names are the literal `describe > it` strings; `path::name` means grep that file for that string. Status vocabulary:

| Status | Meaning |
|---|---|
| `guarded` | A test exists whose assertion would fail if the guarantee were violated |
| `implemented-unguarded` | Code enforces it today; no test asserts it, so a regression would pass CI |
| `not-found-in-code` | The spec requires it and no enforcement was located |
| `spec-drift` | Code contradicts the document; the cited line is the contradiction |
| `policy` | A directive with no possible code enforcement (process rules, "don't build X") |
| `proposed` | The owning document labels it draft or unbuilt; never counted as unguarded |

Qualifiers in parentheses narrow a status ("guarded (Accept only)" means the Reject half is unasserted).

## Summary

| Section | rows | guarded | implemented-unguarded | not-found-in-code | spec-drift | policy | proposed |
|---|---|---|---|---|---|---|---|
| Tier 1 — trust invariants (INV) | 35 | 24 | 5 | 0 | 0 | 6 | 0 |
| Decision Recovery + Repository Integration | 62 | 53 | 8 | 0 | 0 | 1 | 0 |
| Decision Investigation | 77 | 47 | 21 | 4 | 0 | 2 | 3 |
| Agent Observability + Understanding Workspace | 77 | 50 | 5 | 0 | 0 | 9 | 13 |
| Intent Trace + Change Workspace + Branch Binding | 95 | 78 | 8 | 0 | 0 | 9 | 0 |
| Orphan rules (territories) | 15 | 10 | 4 | 1 | 0 | 0 | 0 |
| **Total** | 361 | 262 | 51 | 5 | 0 | 27 | 16 |

Tier 3 (proposed contracts) adds 133 rows that are not status-bearing: Flow Map 21, Decision Authoring 28, Experiment Lab 25, Share Build Story 29, Activity Tracker 7, product PRDs 29. Undocumented enforced guarantees add 15 rows with no owner.

## Findings

### 1. Tier 1 rows with no guard (5, down from 12)

The backend test harness (`docs/changes/backend-test-harness/PLAN.md`, `8cd29d8`) guarded INV-11 and INV-21 through INV-25, and the auth fix (`69e00c0`) guarded INV-27 and INV-29. What remains:

| ID | Guarantee | Why unguarded |
|---|---|---|
| INV-4 | Detection compute runs in a Web Worker | jsdom has no Worker; the test drives the handler directly |
| INV-18 | Zustand stores never hold the master key | grep-only |
| INV-19 | PRF output never touches the network | `src/lib/auth/` has no test files at all |
| INV-20 | No password KDF path exists | absence not asserted |
| INV-26 | Drizzle-only, no raw SQL | absence not asserted (the relay's source guard covers `llm.ts` only) |

### 2. Spec-drift (3 found; all 3 fixed on 2026-09-09)

| ID | Document said | Code did | Fix |
|---|---|---|---|
| INV-29 | `auth-architecture.md:111`: after recovery re-enrollment `wrapped_by_recovery_*` and `recovery_code_hash` stay unchanged | `/recover-finish` overwrote the recovery wrap from the request body; its comment claimed the hash was regenerated | `69e00c0`: route no longer accepts a recovery wrap, client no longer sends one, comment matches the doc; guarded by `auth.test.ts` |
| DI-12 | `decision-investigation/SPEC.md` §7.1, §13: parser errors visible without discarding unaffected events | `parsers/claude-code.ts` swallowed malformed JSONL lines into a `console.warn` | `db060a6`: per-line warnings flow through `ImportResult.parseWarnings` to the import screen; guarded by parser + import tests |
| ORPH-13 | `territories/search-and-browse.md:129`: conversation deletion cleans up dependents | `db/conversations.ts` cascaded 13 tables but not `entityTags` | `9b59690`: `removeEntityTagsFor` in both the local cascade and the sync-engine mirror; guarded by db + engine tests |

### 3. Required by spec, not found in code (5)

| ID | Guarantee | Owner |
|---|---|---|
| DI-29 | Human-created unresolved leads | decision-investigation §8.3 (no `lead` symbol anywhere) |
| DI-35 | Workbench search role/kind filter; `filtersJson` on search records | decision-investigation §8.6, §11 |
| DI-46 | Every verdict requires a primary anchor | decision-investigation §8.8 (`verdicts.ts:81-98` never validates it) |
| DI-72 | Local instrumentation events | decision-investigation §15 (conditional on an event ledger that does not exist) |
| ORPH-3 | `CLASSIFIER_VERSION` versions the tool-class mapping | declared at `classify.ts:6`, referenced nowhere |

### 4. Stale documentation (docs claim something false about the code)

- **CLAUDE.md:79** says the detection Web Worker is "not yet wired", and **CLAUDE.md:112-127** says `src/lib/detection/` is a "planned addition, not yet created". Both are false: `worker.ts`, `workerClient.ts`, and the full detection tree exist and are live.
- **decision-recovery/SPEC.md §2.5** says `src/lib/investigation/*` is not modified; **§8.1** of the same document places `agentInspections.ts` there, and it exists there. The quarantine's intent is honoured and guarded; the literal clause is self-contradicted.
- **decision-recovery/SPEC.md §7.1** meta table omits `conversationId`, which the code writes and depends on for session grouping.
- **flow-map/SPEC.md §3** says Dexie is at v12; §7.2/§17 target v14; the schema is at v13.
- **docs/prds/** carries no status headers. `chatdex-prd.md` ("no server, no data collection") and `PRD-patternmirror.md` (Argon2id passphrase KDF, automatic per-conversation extraction, acknowledged unencrypted Postgres tier) contradict shipped invariants 1 and 6 and the WebAuthn migration. They read as pre-backend, pre-WebAuthn history but nothing marks them superseded.

### 5. Gaps no document addresses

- **`src/lib/license.ts` has no test.** Its HMAC compare is a plain `!==` (not constant-time) and the secret is a client-side Vite env var, so the pro gate is forgeable from the shipped bundle. Only `territories/README.md:53` mentions this.
- **CSV export has no spreadsheet-formula-injection guard.** `src/lib/exporters/csv.ts` quotes cells but emits a leading `=`, `+`, `-`, `@` verbatim.
- **`src/lib/demo` is reachable in production with no gate**, imported unconditionally by `LandingPage.tsx` and `ProjectsPage.tsx`. Seeded sample rows write into synced tables and will sync as ciphertext. Looks deliberate; no doc says so.
- **`localOnly.test.ts` regex covers four local-only tables but not `rawSources` or `investigationAnchors`**, which are also declared LOCAL-ONLY (DI-13, DI-14 unguarded as a result).
- **`sync/engine.ts:262-263` rehydrates pulled `verdict_revision` rows with `put`**, which could overwrite a locally finalized revision under last-write-wins. Not traced end-to-end.
- **DR-10 (no importance score) has no negative guard.** Adding a relevance score to the decision browser would fail no test.
- **Decision Investigation has zero component tests.** Every UI-level guarantee (scroll never counts as reviewed, verbatim rendering, finalize confirmation) is `implemented-unguarded` regardless of how clearly the code does it.
- ~~Backend-side guarantees collapse to one backend test file~~ Resolved by `8cd29d8`: `backend/` now has its own vitest config, a PGlite-backed harness (`backend/src/test/harness.ts`), and route tests for the relay, sync, and auth.

### 6. Proposed contracts that would conflict with shipped rules

No proposed rule in the four current change packages (Flow Map, Decision Authoring, Experiment Lab, Share Build Story) contradicts a shipped invariant; Flow Map is uniformly stricter than what it builds on. Two things need explicit amendments before they land:

- **Share Build Story** (SB-1, SB-3) creates the first sanctioned plaintext-at-rest server path. It does not violate invariant 1's letter (it forbids using the sync envelope) but needs an explicit invariant 1 amendment, which its plan schedules.
- **Share Build Story analytics** (SB-5, SB-22) is server-side data collection about readers, conflicting with `chatdex-prd.md`'s "no tracking" only because that PRD is unmarked history (Finding 4).

### 7. What this register does not cover

Rules that live only in code with no comment and no doc were found only where the sweep looked (`parsers`, `exporters`, `db`, `utils`, `aipkms`, `demo`, `search`, `import`, `license`). `docs/capabilities/activity-tracker/IMPLEMENTATION-GUIDE.md` was not read. Territory docs date from 2026-08-17 and are stale in places; only claims re-verified against current code were carried in. Test names were verified to exist; assertion bodies were read only where the title was ambiguous.

---

## Tier 1 — Trust invariants

Owners: `CLAUDE.md`, `docs/architecture/architecture.md`, `docs/architecture/auth-architecture.md`. Line numbers are as of HEAD `3b66fa0`.

| # | Guarantee | Owner (doc §/line) | Enforcing code (path:line) | Guard test (path::name) | Status |
|---|---|---|---|---|---|
| INV-1 | Session/finding/understanding data reaches Postgres only as ciphertext; the server never carries or stores plaintext. | CLAUDE.md:52 (inv 1); architecture.md:79, :112 | `src/lib/sync/engine.ts:682`; `backend/src/routes/sync.ts:33-41` (schema accepts only `iv`/`ciphertext` + routing) | `src/lib/sync/serializer.test.ts::intent trace sync serializer > keeps repository details out of the cleartext envelope (audit S9)` | guarded |
| INV-2 | Only routing metadata (`kind`, `parentId`, `updatedAt`) is in the clear; every domain field lives inside the encrypted `payload`. | architecture.md:84 | `src/lib/sync/serializer.ts` (all `envelope*` fns); `src/lib/sync/engine.ts:682-688` | `src/lib/sync/serializer.test.ts::prepared change sync serializer > round-trips a fully populated Change Workspace and keeps sections out of the cleartext envelope (S9)` | guarded |
| INV-3 | Detection never moves server-side, never routes through an LLM API, and never depends on network availability. | CLAUDE.md:56 (inv 2), :170 | `src/lib/detection/` — no `fetch`/`providers`/`github` import anywhere | `src/lib/understanding/trace/boundary.test.ts::boundary law (§2.5) > lib/detection never imports the GitHub client, intent/trace modules, the LLM providers, or the Change Workspace` | guarded |
| INV-4 | Detection compute runs in a Web Worker. | CLAUDE.md:56 (inv 2); CLAUDE.md:79 says "not yet wired" | `src/lib/detection/workerClient.ts:26`; `src/lib/detection/worker.ts:17`; `src/lib/detection/autoAnalyze.ts:37` | none — `pipeline.test.ts::worker handler — message protocol > emits progress stages then a result` calls `handleAnalyzeRequest` directly, never asserts a `Worker` is constructed | implemented-unguarded (CLAUDE.md:79 stale) |
| INV-5 | Findings are immutable per detector version: a version or config change creates a new `DetectorRun` with new findings, leaving old rows intact. | CLAUDE.md:57 (inv 3), :172 | `src/lib/detection/pipeline.ts:133-142` (fresh ids per run), `:176-177` (`add`/`bulkAdd`, never `put`) | `src/lib/detection/pipeline.test.ts::analyzeSession — idempotency > creates a NEW run with new findings when config changes, leaving old findings intact`; same file `> creates a new run when the detector version bumps` | guarded |
| INV-6 | Every finding is explainable from its stored `evidence` alone. | CLAUDE.md:58 (inv 4) | `src/lib/detection/registry.ts:23`; `detectors/loop.ts:384`, `verificationAbsence.ts:129`, `reversion.ts:216` | `src/lib/detection/detectors/loop.test.ts::loop detector — finding contract > evidence alone explains the finding: signatures, occurrences, thresholds`; `src/components/detection/EvidencePanel.test.tsx::EvidencePanel — explainability from stored evidence > renders summary, severity, detector version, suppressions, and raw steps` | guarded |
| INV-7 | Suppression rules are always recorded in `suppressions_evaluated`, even when they don't fire. | CLAUDE.md:165 | `src/lib/detection/detectors/loop.ts:384`; `verificationAbsence.ts:129`; `reversion.ts:216` | `src/lib/detection/detectors/loop.test.ts::loop detector — finding contract > populates both suppression evaluations on every finding`; `src/lib/detection/detectors/verificationAbsence.test.ts::verification-absence — finding contract > records the verification-within-span evaluation` | guarded |
| INV-8 | Detectors are pluggable: registering one requires no pipeline, storage, or UI change. | CLAUDE.md:59 (inv 5) | `src/lib/detection/registry.ts:35-46`; `src/lib/detection/pipeline.ts:61-66,88-96` | `src/lib/detection/pipeline.test.ts::analyzeSession — persistence (acceptance: stub detector persists) > persists findings and the DetectorRun to IndexedDB` (ad-hoc stub detector drives whole pipeline) | guarded |
| INV-9 | Detector rules/thresholds are configurable via `DetectorConfig` with documented defaults — no inline magic numbers. | CLAUDE.md:154 | `src/lib/detection/registry.ts:31`; `src/lib/detection/pipeline.ts:55-66` | `src/lib/detection/autoAnalyze.test.ts::analyzeConversation — stored config overrides (settings page) > applies stored overrides to analysis and records them on the run` | guarded |
| INV-10 | No conversation content goes to a provider without the user having enabled synthesis and supplied their own credentials. | CLAUDE.md:64 (inv 6, bullet 1) | `src/lib/providers/relayClient.ts` (throws `No API key` before any fetch); `src/lib/providers/credentials.ts` | `src/lib/providers/providers.test.ts::relay client > refuses to call without a configured key` | guarded |
| INV-11 | The backend relay is transit-only: it never persists or logs request/response content; error paths return only status codes and provider error types. | CLAUDE.md:65 (inv 6, bullet 2), :171 | `backend/src/routes/llm.ts:1-7` (stated), `:134-137` (`safeErrorType`), `:149-160`, `:299-305`, `:408-421`; no DB import, no logger call in file | `backend/src/routes/llm.test.ts::POST /api/llm/complete > forwards the content to the provider and returns the normalized completion` (marker never in logs or error bodies, across all five error paths); `::relay source hygiene > routes/llm.ts imports nothing from the database layer`; `> routes/llm.ts never logs` | guarded (2026-09-09, `8cd29d8`) |
| INV-12 | Cross-provider sends are disclosed: the UI states which provider receives which sources before the first such call. | CLAUDE.md:66 (inv 6, bullet 3) | `src/lib/understanding/runDiscovery.ts` (`buildDisclosure`); `src/components/understanding/DisclosureModal.tsx` | `src/lib/understanding/runDiscovery.test.ts::buildDisclosure > flags sources going to a non-native provider`; `src/pages/IntentTracePage.test.tsx::IntentTracePage — per-row trace > cancelling the disclosure sends nothing` | guarded |
| INV-13 | Decision-recovery disclosure states the session, hunk, and repository-excerpt counts before any provider call. | CLAUDE.md:68 (inv 6, bullet 5) | `src/lib/understanding/decisions/runRecovery.ts` (`planRecovery`) | `src/lib/understanding/decisions/runRecovery.test.ts::planRecovery (§9.2, law 2.6) > assembles the disclosure inputs without calling the provider` | guarded |
| INV-14 | The GitHub token is device-local, goes only to api.github.com in an Authorization header, and never enters a relay body, a prompt, or sync. | CLAUDE.md:69 (inv 6, bullet 6) | `src/lib/github/credentials.ts:6`; `src/lib/github/client.ts:15` | `src/lib/providers/relayBody.test.ts::relay request body > carries only provider fields — no github key, no token string`; `src/lib/sync/engine.test.ts::device-local sync state exclusion > never pushes github.* metadata`; `src/lib/github/client.test.ts::transport > hits the constant API host with the right headers and the token only in Authorization` | guarded |
| INV-15 | Whole cached repository files live in a LOCAL-ONLY IndexedDB table that is never synced. | CLAUDE.md:69 (inv 6, bullet 6) | `src/lib/db/repoFiles.ts:1`; `src/lib/db/schema.ts:174-191` | `src/lib/db/localOnly.test.ts::Dexie v12/v13 local-only tables > is never referenced by the sync engine or serializer (audit S1 / S12)` | guarded |
| INV-16 | GitHub access is read-only — the client issues nothing but GET. | CLAUDE.md:69 (inv 6, bullet 6) | `src/lib/github/client.ts` | `src/lib/github/client.test.ts::module surface (read-only law §2.4) > never issues anything but GET` | guarded |
| INV-17 | The unwrapped master key lives only in `keyManager`'s module-level reference, is dropped on lock/logout/tab close, and never touches localStorage or IndexedDB. | architecture.md:65; auth-architecture.md:79 | `src/lib/crypto/keyManager.ts:8-34`; `src/lib/auth/session.ts:3,80-86` (only JWT + user persist) | `src/lib/crypto/index.test.ts::key manager > lock() drops the key`; same file `> starts locked` | guarded (lifecycle only; no test asserts absence of a persistence path) |
| INV-18 | Zustand stores do not hold the master key. | architecture.md:211 | `src/stores/` — no `masterKey`/`getMasterKey` reference (grep) | none | implemented-unguarded |
| INV-19 | The PRF output never touches the network; only the PRF salt and wrapped ciphertext are server-visible. | auth-architecture.md:58-63 | `src/lib/auth/webauthn.ts:105` (`prfOutputToKey`); `src/lib/auth/session.ts:143-169,196-206` (posts only wrapped blobs) | none — `src/lib/auth/` has no test files | implemented-unguarded |
| INV-20 | No password/Argon2id KDF path exists; do not reintroduce one without a spec change. | CLAUDE.md:78; auth-architecture.md:14 | absence — no `argon2`/`pbkdf2`/`deriveKey`/`hash-wasm` in `src/`, `backend/src/`, or either package.json | none | implemented-unguarded |
| INV-21 | `JWT_SECRET` must be set and ≥32 chars, enforced at boot, and is the sole signer for both JWTs and challenge tokens. | architecture.md:132 | `backend/src/middleware/auth.ts:25-28`; `backend/src/utils/challengeToken.ts:24-30` | `backend/src/routes/auth.test.ts::boot guard > refuses to build the app without a secret or with a short one`; `backend/src/utils/challengeToken.test.ts::refuses to sign or verify without a 32+ char JWT_SECRET` | guarded (2026-09-09) |
| INV-22 | Challenge-token verification is timing-safe; tampering or replay outside the 5-minute window fails. | architecture.md:133 | `backend/src/utils/challengeToken.ts:63` (`timingSafeEqual`), `:67` (expiry) | `backend/src/utils/challengeToken.test.ts::rejects a token whose body was tampered with`; `::rejects a token whose signature was tampered with, including a length change`; `::rejects replay after the 5-minute window` | guarded (2026-09-09) |
| INV-23 | The recovery code is never stored in cleartext; it is salt-hashed and verified in constant time. | architecture.md:134; auth-architecture.md:75 | `backend/src/utils/passwordHash.ts:11-26`; `backend/src/routes/auth.ts:296-301,366-371` | `backend/src/utils/passwordHash.test.ts::stores a 32-byte digest that does not contain the code`; `::verifies the same code under the same salt and nothing else`; `::treats a stored hash of the wrong length as a mismatch` | guarded (2026-09-09) |
| INV-24 | Every sync read/write is scoped to the authenticated user (`userId` from the verified JWT). | architecture.md:85, :116 | `backend/src/routes/sync.ts:79,134,153`; `backend/src/middleware/auth.ts:31-41` | `backend/src/routes/sync.test.ts::user scoping > two users can hold the same record id and each pulls only their own`; `> one user's push cannot overwrite the other's row with the same id`; `> DELETE /all wipes only the caller` | guarded (2026-09-09) |
| INV-25 | Sync conflict resolution is atomic last-write-wins by `updatedAt`; the server skips writes when the existing row is newer or equal. | architecture.md:84, :86 | `backend/src/routes/sync.ts:87-89`, `:100-113` | `backend/src/routes/sync.test.ts::last-write-wins by updatedAt > skips an older or equal write and applies a newer one` | guarded (2026-09-09) |
| INV-26 | Application code uses Drizzle's typed query builder exclusively — no raw SQL outside migrations. | architecture.md:117 | absence — no `sql\``/`.execute(`/`.raw(` in `backend/src/` | none | implemented-unguarded |
| INV-27 | The WebAuthn signature counter is checked on each assertion for clone detection: `verifyAuthenticationResponse` throws when the counter did not increase (library, `@simplewebauthn/server` `verifyAuthenticationResponse.js:144-150`), the route answers 401, and a verified higher counter is stored | architecture.md:50 | `backend/src/routes/auth.ts` (login-finish try/catch → 401; counter update) | `backend/src/routes/auth.test.ts::login > a non-increasing counter (SimpleWebAuthn throws) is a 401 with no detail`; `> a verified assertion stores the new counter and returns the material` | guarded (2026-09-09, `69e00c0`) |
| INV-28 | Device-local sync state (`sync.*`) is never pushed and incoming server copies are ignored. | architecture.md:82; CLAUDE.md:52 | `src/lib/sync/engine.ts` (kind filter) | `src/lib/sync/engine.test.ts::device-local sync state exclusion > never pushes sync.* metadata, while other metadata still syncs`; same file `> ignores incoming sync.* metadata records from the server` | guarded |
| INV-29 | After a recovery re-enrollment, `wrapped_by_recovery_*` and `recovery_code_hash` stay unchanged so the recovery code remains valid. | auth-architecture.md:111 | `backend/src/routes/auth.ts` (`RecoverFinishSchema` no longer accepts `wrappedByRecovery`; the update sets passkey fields only); client `src/lib/auth/session.ts` no longer sends one | `backend/src/routes/auth.test.ts::recovery > recover-finish replaces the passkey and its wrap, and leaves the recovery wrap and hash untouched` (also ignores a stale client-sent recovery wrap; the same code works afterwards) | guarded (drift fixed 2026-09-09, `69e00c0`) |
| INV-30 | Never touch `src/lib/crypto/` without explicit instruction. | CLAUDE.md:97, :155 | — | — | policy |
| INV-31 | Don't invent new failure-pattern detectors beyond the spec'd three without asking. | CLAUDE.md:174 | `src/lib/detection/registerAll.ts:14-16` registers exactly three | — | policy |
| INV-32 | Don't broaden detector heuristics without adding the corresponding suppression tests. | CLAUDE.md:173 | — | — | policy |
| INV-33 | Always run typecheck + tests before declaring a task done; golden-trace test per rule and suppression. | CLAUDE.md:151-152 | `tests/golden-traces/golden-traces.test.ts` | — | policy |
| INV-34 | Never commit real personal session data; use sanitized fixtures in `tests/golden-traces/`. | CLAUDE.md:156 | — | — | policy |
| INV-35 | A proposal never silently overrides a capability spec; affected sections are identified and amended in the change plan. | CLAUDE.md:33-36 | — | — | policy |

Verified during extraction: no `argon2`/`pbkdf2`/`hash-wasm` anywhere in `src/`, `backend/src/`, or either `package.json`; `backend/src/utils/passwordHash.ts` is SHA-256(salt‖code) with `timingSafeEqual`, not a KDF. `backend/src/routes/llm.ts` has zero `console`/`log`/DB calls.

---

## Tier 2 — Shipped capability contracts

### Agent Observability (AO)

Owner: `docs/capabilities/agent-observability/SPEC.md` and `AMENDMENT-intervention-v2.md`. The intervention amendment (§10, phases I0–I6) is entirely unbuilt: no `InterventionEvent` exists anywhere in `src/` or `backend/`.

| ID | Guarantee | Owner § | Enforcing code | Guard test | Status |
|---|---|---|---|---|---|
| AO-1 | Signature = `tool_name + canonicalized_args`: paths normalized, whitespace stripped, volatile fields dropped | §2.1.1 | `src/lib/detection/signatures.ts:10,36,79` | `signatures.test.ts::signatureFor — equivalence > whitespace variants of a command produce identical signatures`; `::signatureFor — volatile fields > ignores volatile field "<field>"` | guarded |
| AO-2 | Loop fires only when one signature repeats N in M steps, or a 2–4-signature sequence repeats ≥2 consecutively | §2.1.2 | `detectors/loop.ts:33,69,101` | `loop.test.ts::loop detector — window boundaries > does not fire when no M-step window contains N occurrences`; `::fires at exactly N occurrences inside one window`; `::requires at least two distinct signatures in a sequence unit` | guarded |
| AO-3 | Loop candidates suppressed by retry whitelist and by absence of intervening state change | §2.1.3 | `loop.ts:106,121,157` | `loop.test.ts::retry whitelist suppression > suppresses a custom whitelisted command`; `::does NOT suppress a sequence when only one of its signatures is retry-shaped`; `::state-change suppression > records a fired suppression…` | guarded |
| AO-4 | Every suppression rule that ran is recorded in `suppressions_evaluated`, even when it did not fire | §2.1, §3 | `loop.ts:265`; `verificationAbsence.ts:97`; `reversion.ts:187` | `loop.test.ts::populates both suppression evaluations on every finding`; `verificationAbsence.test.ts::records the verification-within-span evaluation` | guarded |
| AO-5 | Every tool call classified state-changing / verification-shaped / neutral via curated mapping; unknown → neutral and counted | §2.2.1, §6 | `detection/classify.ts:8-102` | `classify.test.ts::classifyToolCall > <tool> → <class>`; `::isKnownTool > recognizes curated tools and flags unknown ones`; `hardening.test.ts::counts unknown tools on the run…` | guarded |
| AO-6 | After each state-changing action, scan forward to topic shift / task transition / session end; flag if no verification occurs | §2.2.2-3 | `verificationAbsence.ts:57-129` | `verificationAbsence.test.ts::span scanning > no finding when a verification-shaped call follows`; `::flags an unverified edit ended by topic shift`; `::flags an unverified edit at session end`; `::a read-back of the edited file counts as verification` | guarded |
| AO-7 | Asserted-but-unverified escalates to high severity | §2.2.4 | `verificationAbsence.ts:95,117` | `verificationAbsence.test.ts::escalates to high when success is asserted and never verified`; `::an assertion followed by verification produces no finding at all` | guarded |
| AO-8 | Verification-absence evidence carries the span, the assertion flag, and the class of every tool call in span | §2.2 | `verificationAbsence.ts:122-128` | `verificationAbsence.test.ts::evidence classifies every tool call in the span` | guarded |
| AO-9 | Per-file edit timeline maintained; a later hunk restoring a prior state (after normalization) is flagged | §2.3.1-2 | `detection/normalize.ts`; `reversion.ts:43-110` | `normalize.test.ts::reconstructs per-file timelines from mixed-session`; `reversion.test.ts::flags a later edit that exactly inverts an earlier one`; `::matches after whitespace normalization`; `::does not pair edits across different files` | guarded |
| AO-10 | Acknowledgment near the reverting edit downgrades to info; absence = silent reversion | §2.3.3 | `reversion.ts:108-201` | `reversion.test.ts::downgrades to info when the agent acknowledges before the edit`; `::ignores acknowledgment outside the configured window`; `::neutral adjustment language is not an acknowledgment` | guarded |
| AO-11 | Reversion and loop share normalization and link an edit→revert→edit cycle | §2.3.4 | `reversion.ts:143-163` | `reversion.test.ts::records cycle steps and coexists with a loop sequence finding on edit→revert thrash` | guarded |
| AO-12 | Findings immutable per detector version; `userLabel` is the sole mutable field | §3; INV-5 | `pipeline.ts:132-180`; `db/findings.ts:34` | `pipeline.test.ts::creates a NEW run with new findings when config changes, leaving old findings intact`; `::creates a new run when the detector version bumps` | guarded |
| AO-13 | `evidence` always suffices to re-render "why this fired" without re-running | §3, §5.1, §9; INV-6 | `registry.ts:23`; `EvidencePanel.tsx:16-40` | `EvidencePanel.test.tsx::renders summary, severity, detector version, suppressions, and raw steps`; `loop.test.ts::evidence alone explains the finding` | guarded |
| AO-14 | Step indices anchor findings to the trace; UI resolves lazily against the stored session | §3, §5.1 | `detection/findingAnchors.ts` | `findingAnchors.test.ts::labels flat-trace messages 1:1 with their step index`; `findingsStore.test.ts::anchors each finding at the message backing its start step` | guarded |
| AO-15 | Detection is client-side only; never routed through an LLM API | §4, §7; INV-3 | `src/lib/detection/**` has no fetch/provider import | see INV-3 (`trace/boundary.test.ts` guards the import boundary) | guarded (via INV-3) |
| AO-16 | Detection runs in a Web Worker | §4; INV-4 | `workerClient.ts:26`; `worker.ts:8`; `autoAnalyze.ts:38` | `pipeline.test.ts::worker handler — message protocol` (protocol only; jsdom has no real Worker) | implemented-unguarded |
| AO-17 | Full three-detector pass over 10k steps < 5 s | §4, §9 | `pipeline.ts:80-98` | `perf.test.ts::completes a full three-detector pass in under 5 seconds`; `pipeline.test.ts::performance — synthetic 10k-step session` | guarded |
| AO-18 | Idempotent per (session, detector_version, config) — no duplicate findings on re-run | §4 | `pipeline.ts:47-53,113-116,171-179` | `pipeline.test.ts::is a no-op when re-run with identical versions and config`; `::buildRunKey is stable under config key order`; `autoAnalyze.test.ts::re-running under the same stored overrides stays idempotent` | guarded |
| AO-19 | Detection triggered on ingest, manually, and in bulk on version bump | §4 | `src/lib/import.ts:44-48`; `findingsStore.ts`; `detection/staleness.ts:17-48` | `import.test.ts::selectAutoAnalyzeIds > keeps claude-code sessions and drops chat-only sources`; `hardening.test.ts::stale-session detection (version bumps)` | guarded |
| AO-20 | Adding a detector needs zero changes outside registering it | §4; INV-8 | `registry.ts:35-50`; `pipeline.ts:55-66,88` | `pipeline.test.ts::persists findings and the DetectorRun to IndexedDB` (stub detector) | guarded |
| AO-21 | Detector `version` is semver, bumped on any behaviour change | §4 | `registry.ts:29`; version constants | none — no test can detect an un-bumped version | policy |
| AO-22 | Every rule/threshold is a documented `DetectorConfig` value; no inline magic numbers | §4; INV-9 | `loop.ts:13-48`; `verificationAbsence.ts:20-40`; `reversion.ts:20-41` | `autoAnalyze.test.ts::applies stored overrides to analysis and records them on the run`; `loop.test.ts::respects a custom repeatThreshold` | guarded |
| AO-23 | Findings render as inline markers at step ranges, colour-coded by severity | §5.1 | `FindingMarker.tsx`; `detection/severity.ts` | `EvidencePanel.test.tsx::FindingMarkers — severity-coded inline markers > renders a marker per finding and selects on click` | guarded |
| AO-24 | Confirm / false-positive labels stored on the finding and persist under encryption | §5.1, §7, §9 | `db/findings.ts:30-36`; `sync/serializer.ts:183-195` | `findingsStore.test.ts::persists a label to IndexedDB and preserves it on fresh load`; `pipeline.test.ts::finding: envelope → encrypt → decrypt → rehydrate is lossless` | guarded |
| AO-25 | Detector health shows false-positive rate per detector from user labels | §5.2 | `detection/stats.ts`; `DetectorHealthCards.tsx` | `stats.test.ts::computes false-positive rate from labels only` | guarded |
| AO-26 | Findings-over-time reconcile with raw record, counting only the latest run per session | §5.2 | `stats.ts:1-259` | `stats.test.ts::totals reconcile with raw table counts`; `::buckets by the session date, not analysis date`; `hardening.test.ts::dashboard stats count only the latest run per conversation` | guarded |
| AO-27 | Documented blind spots appear in an in-app "How detection works" page | §6 | `src/pages/HowDetectionWorksPage.tsx:60-90` | none | implemented-unguarded |
| AO-28 | Findings, runs, labels sync as ciphertext only | §7, §9; INV-1 | `sync/engine.ts:682`; `serializer.ts:183-208` | `pipeline.test.ts::detector run: envelope → encrypt → decrypt → rehydrate is lossless` — proves losslessness, not that the cleartext envelope is content-free (no findings equivalent of the S9 test) | implemented-unguarded |
| AO-29 | Any future ML tier ships client-side or on opt-in decrypted data; cross-user aggregation needs its own consent flow | §7, §8 | no ML tier exists | n/a | policy |
| AO-30 | All three detectors run over the golden-trace suite and match expected findings; every rule and suppression has a golden trace | §9 | `tests/golden-traces/` (11 fixtures incl. 3 must-not-fire) | `golden-traces.test.ts::golden trace: <fixture> > produces the expected findings`; `::parses through the existing ingestion path unmodified`; `::has an up-to-date .jsonl on disk` | guarded |
| AO-31 | The three shipped detectors must not be removed or renamed | AMENDMENT Part 1 | `detection/registerAll.ts:14-16` | `golden-traces.test.ts::golden trace: mixed-session` (exercises all three) | guarded |
| AO-32 | `InterventionEvent` entity in both IndexedDB and Postgres with deterministic content-hash id for `source=auto` | §10.1 | none | none | proposed |
| AO-33 | No stored relationship between finding and intervention streams; join computed at query time | §10.1 | none | none | proposed |
| AO-34 | Derived intervention metrics computed at query time, never stored; window W in `DetectorConfig` | §10.2 | none | none | proposed |
| AO-35 | I-1: intervention detection runs entirely client-side | §10.3 | none | none | proposed |
| AO-36 | I-2: an InterventionEvent never mutates the Findings stream | §10.3 | none | none | proposed |
| AO-37 | I-3: re-running detection never modifies `source=user` events or `status`/`notes` on auto events; dispositions never deleted | §10.3 | none | none | proposed |
| AO-38 | I-4: intervention events derived from trace content are encrypted client-side | §10.3 | none | none | proposed |
| AO-39 | I-5: identical trace + version + config → identical auto event set, ids included | §10.3 | none | none | proposed |
| AO-40 | I-6: every auto event has non-null `evidence` and `detector_run_id` | §10.3 | none | none | proposed |
| AO-41 | I4 corrective-reprompt classifier gated at precision ≥0.8 on ≥50 hand-labeled messages | §10.4 | none | none | proposed |
| AO-42 | I5 takeover detection excludes generated artifacts by glob; formatter-scale diffs → low confidence | §10.4 | none | none | proposed |
| AO-43 | An opt-in LLM classification mode must not be built as a side effect; needs its own amendment | §10.4; Part 4 | `src/lib/detection/**` imports nothing from providers | none | policy |
| AO-44 | Interventions never described as a "fourth failure mode" | AMENDMENT Part 1 | n/a | none | policy |

### Understanding Workspace (UW)

Owner: `docs/capabilities/understanding-workspace/PRD.md` (its contract lives in the PRD).

| ID | Guarantee | Owner § | Enforcing code | Guard test | Status |
|---|---|---|---|---|---|
| UW-1 | Existing Claude.ai / Claude Code ingestion is not removed or replaced; observability stays operational | §3 | `parsers/claude-code.ts`, `parsers/claude-ai.ts`; `parsers/chatgpt.ts:247` (sniff routing) | `chatgpt.test.ts::detects a Claude.ai flat-array export (regression: existing users)`; `golden-traces.test.ts::parses through the existing ingestion path unmodified` | guarded |
| UW-2 | Normalized source layer preserves provider, source type, id, timestamp, messages, ordering, provenance, project association, raw-source ref | §4 | `src/types/unified.ts:28-77`; `db/rawSources.ts:22-40` | `parsers/provenance.test.ts::chatgpt conversations record the export filename…`; `::claude-code conversations record the session filename`; `rawSources.test.ts::stores a capture with its SHA-256 content hash and provenance` | guarded |
| UW-3 | Sources are not forced into one representation if that destroys information | §4 | `chatgpt.ts:237` (`prunedBranches`); `unified.ts:47` (open `providerMeta`) | `chatgpt.test.ts::records pruned-branch counts in providerMeta so discarded edits stay visible`; `::falls back to parts for unknown content_type instead of dropping the message` | guarded |
| UW-4 | Privacy/local-first guarantees apply to understanding data (plaintext in IndexedDB, ciphertext in sync) | §4; INV-1 | `types/understanding.ts:4-5`; `serializer.ts:210+`; `engine.ts:682` | `serializer.test.ts::round-trips events with evidence intact; parentId is the object` — round-trip only; no assertion that the envelope cleartext is content-free | implemented-unguarded |
| UW-5 | Architecture distinguishes SOURCE / INGESTION / UNDERSTANDING layers | §5 | conversations+messages; `rawSources.ts`; `db/understanding.ts` | none | implemented-unguarded |
| UW-6 | AI may propose project associations, each with confidence and reason | §6 | `types/understanding.ts:79-91`; `understanding/discovery.ts:206-270` | `discovery.test.ts::persists proposed projects, associations, and objects as pending ai rows`; `::clamps confidence to [0,1]…` | guarded |
| UW-7 | No mutually exclusive folders — a conversation may relate to one, several, or no project | §6 | `types/understanding.ts:79-91,104` | `db/understanding.test.ts::a conversation can associate with multiple projects (PRD §6)`; `::queries objects by project and status, including the null-project bucket` | guarded |
| UW-8 | Users can correct AI-proposed associations | §6, §11 | `db/understanding.ts` (`setAssociationReviewState`); `ReviewButtons.tsx` | `understanding.test.ts::review-state update bumps updatedAt`; `::lets a user attach an imported conversation to a project` | guarded |
| UW-9 | Ontology stays flexible — object-type list is not final | §7 | `types/understanding.ts:106` (`type: string`) | `livingDocument.test.ts::groups the open ontology by type with pluralized headings` | guarded |
| UW-10 | Understanding is not timeless: introduced/supported/refined/superseded/contradicted/reopened/resolved representable | §8 | `types/understanding.ts:125-132`; `db/understanding.ts:236-275` | `understanding.test.ts::temporal ops update denormalized status (PRD §8)`; `history.test.ts::replays status…` | guarded |
| UW-11 | The corpus is never flattened into one summary | §8 | `understanding/reconcile.ts:1-15` (chronological batches) | `reconcile.test.ts::processes batches chronologically and presents earlier introductions to later batches` | guarded |
| UW-12 | Provenance mandatory: every AI-origin object/event must carry evidence or is rejected | §9 | `db/understanding.ts:173-176,242-245` | `understanding.test.ts::AI-origin objects require evidence (PRD §9)`; `::AI-origin events without evidence are rejected`; `::user-origin objects may omit evidence and start accepted` | guarded |
| UW-13 | User can navigate understanding → evidence → conversation → exact messages; invented indexes dropped | §9 | `types/understanding.ts:23-29`; `discovery.ts:255-270` | `discovery.test.ts::translates cited message indexes into stored message ids on evidence`; `::keeps digest message indexes and drops invented ones (hallucination guard)`; `::drops associations citing unknown conversations` | guarded |
| UW-14 | AI synthesis never erases the underlying source; events append-only; rejection keeps the row | §9, §23 | `db/understanding.ts:236-300`; `understanding/history.ts` | `understanding.test.ts::rejecting a pending event leaves the object untouched`; `::review is one-shot…`; `history.test.ts::includes rejected events in the stream (audit trail)` | guarded |
| UW-15 | New sources reconciled against existing understanding, not summarized independently | §10 | `reconcile.ts:88+` (`buildReconcileMessages`) | `reconcile.test.ts::presents current objects with ids and embeds digests`; `::golden scenario: supersession links old direction to introduced replacement, all pending` | guarded |
| UW-16 | AI interpretations never become canonical automatically: ai → pending → accepted/edited/rejected | §11 | `db/understanding.ts:187,248` | `understanding.test.ts::AI-origin events land pending and do not touch status until accepted`; `::creates human projects as accepted without an LLM review step` | guarded |
| UW-17 | Users are not required to manually extract knowledge; AI extracts, humans judge | §11, §22 | `discovery.ts`, `reconcile.ts`; `pendingReviews.ts` | `pendingReviews.test.ts::counts pending rows across all four kinds` (surface only) | policy |
| UW-18 | No giant force-directed graph just because the data is graph-shaped | §13 | `understanding/map.ts`; `ProjectMapView.tsx` | `map.test.ts::puts a supersession chain on one row in topological order` | policy |
| UW-19 | The living document is generated from understanding, never manually maintained truth | §14 | `understanding/livingDocument.ts` (pure render; no stored row) | `livingDocument.test.ts::is deterministic and only stamps a date when given one`; `::dedupes footnotes…` | guarded |
| UW-20 | No hard-coded permanent three-column layout | §15 | `ProjectUnderstandingPage.tsx:251` (`panel/document/map`) | none | policy |
| UW-21 | Consumer-subscription auth not assumed universal; only supported paths implemented | §16 | `providers/types.ts:13`; `providers/credentials.ts:19-27` | `providers.test.ts::includes subscription-mode providers only when the CLI login is detected`; `::ignores a stored key for a provider switched to subscription mode`; `::treats an unreachable backend as no subscription providers ready` | guarded |
| UW-22 | Provider auth behind an abstraction; no hard-coded billing model | §16 | `providers/registry.ts:3-32`; `relayClient.ts` | `providers.test.ts::provider registry > exposes info for every provider id`; `::auth mode > defaults to api-key and round-trips per provider` | guarded |
| UW-23 | Document which auth modes are officially supported | §16.3 | recorded only in BUILD-LOG (history), no capability doc | none | policy (undocumented) |
| UW-24 | The entire understanding graph is never blindly injected into chat; context is selected and budgeted | §17 | `src/lib/chat/context.ts:13-22,53-108` | `chat/context.test.ts::shrinks to fit the token budget and marks truncation`; `::hard-cuts when even the minimal stage exceeds the budget`; `::injects accepted objects and excludes pending ones` | guarded |
| UW-25 | A Chatdex-native chat is itself a source; no manual copy required | §18 | `chat/chats.ts`; `reconcile.ts:56-63`; `ChatPage.tsx:506-560` | `reconcile.test.ts::scoped reconciliation (U6.1) > conversationIds scopes selection and ignores the project cursor`; `::scoped run stamps the chat…`; `chats.test.ts::createChat > creates a chatdex conversation…` | guarded |
| UW-26 | Software-development direction (build instructions → coding agent → evidence) deferred | §19 | n/a | n/a | proposed |
| UW-27 | Fiction-specific ontology not implemented | §20 | `types/understanding.ts:106` (open string; no fiction types) | none | proposed |
| UW-28 | Not attempted in one session; assessment before large refactor | §21, §26 | `ASSESSMENT-U0.md`, `PLAN-U3-U6.md` | none | policy |
| UW-29 | Both HEAD (current) and HISTORY provided; normal usage emphasizes HEAD | §23 | `currentUnderstanding.ts:136`; `history.ts` | `currentUnderstanding.test.ts::keeps superseded/resolved objects out of sections but their events in recent changes`; `history.test.ts::walks the forward supersession chain…` | guarded |
| UW-30 | Uncertainty allowed: contradiction and unresolved states are legitimate | §24 | `types/understanding.ts:125-132`; `currentUnderstanding.ts:115-165` | `currentUnderstanding.test.ts::collects pending events into pendingChanges…`; `::excludes rejected events…; keeps pending ones` — no test asserts a contradiction co-existing with a leaning | guarded (partial) |
| UW-31 | Old/superseded ideas not presented as current | §25.3, §8 | `currentUnderstanding.ts:136` | `currentUnderstanding.test.ts::keeps superseded/resolved objects out of sections…`; `::excludes rejected objects everywhere` | guarded |
| UW-32 | Before content is sent, UI states which provider receives which sources; cross-provider called out | §4; INV-12 | `runDiscovery.ts:18-65`; `DisclosureModal.tsx:9-80`; `ProjectsPage.tsx:160,456` | `runDiscovery.test.ts::flags sources going to a non-native provider`; `::counts conversations per source, largest first`; `::reports no cross-provider sources when everything is native` — no test asserts the modal blocks the first send on the Projects page | guarded (computation); UI gate unasserted |
| UW-33 | Backend relay is transit-only | §4; INV-11 | `backend/src/routes/llm.ts:4-5,133,352` | see INV-11 (`backend/src/routes/llm.test.ts`) | guarded (via INV-11) |
### Decision Investigation (DI)

Owner: `docs/capabilities/decision-investigation/SPEC.md`. Quarantine verified: the complete import set under `src/lib/investigation/` and all investigation pages/components contains no provider, understanding-synthesis, chat, or API module. The two near-misses (`../db/understanding`, `db.understandingProjects`) are Dexie helpers only. Runtime backstop: `constraints.test.ts` stubs fetch/XHR/WebSocket and asserts zero calls across the full flow.

| ID | Guarantee | Owner § | Enforcing code | Guard test | Status |
|---|---|---|---|---|---|
| DI-1 | Never replace the human's reading with a generated summary, extracted decision, inferred rationale, or model-written conclusion | §2.1, §4, §5.3, §16.3, §19 | `src/lib/investigation/*` (no provider import); `investigation/verdicts.ts:53-68` | `investigation/constraints.test.ts::§16.3 — the complete investigation flow, offline, non-generative > runs import → verdict → ledger → reopen with zero network attempts` | guarded |
| DI-2 | No request to a model, embedding, summarization, classification, or analytics endpoint anywhere in the feature | §2.2, §14, §16.3, §19 | no fetch/XHR/WS under `src/lib/investigation/` or `src/components/investigation/` | `constraints.test.ts` (same; asserts `networkViolations` empty) | guarded |
| DI-3 | Detector conclusions (findings, severities, suppressions) never surface in or seed this feature; only `normalize.ts`/`signatures.ts` reused | §2.2, §21 dec 2 | `investigation/anchors.ts:10`; `agentInspections.ts:14-15` | none | implemented-unguarded |
| DI-4 | `classify.ts` heuristics never label or filter anchors | §2.2, §21 dec 2 | `anchors.ts:90-92` | `anchors.test.ts::never anchors shell commands or non-edit tools (SPEC §7.3)` | guarded |
| DI-5 | Search is literal/exact — no fuzzy, no scoring, no ranking; Fuse.js not used | §2.2, §8.6, §21 dec 7 | `investigation/search.ts:37-53` (`indexOf` loop) | `search.test.ts::searchStepTexts — literal, case-insensitive, exact offsets > treats regex metacharacters as literal text` | guarded |
| DI-6 | Never generate synonyms or rewrite the query | §8.6 | `search.ts:38-51` | `search.test.ts::offsets identify the exact matched characters` | guarded |
| DI-7 | Anchor browser ordering is chronological asc/desc only — no relevance/importance/recommended | §8.1 | `investigation/filter.ts` (no sort); `src/pages/InvestigatePage.tsx:54` | none | implemented-unguarded |
| DI-8 | Every exhibit and finalized verdict remains traceable to immutable source; user can open the exact passage | §2.3, §9, §19 | `investigation/cases.ts:472-514` (`resolveExhibit`) | `cases.test.ts::exhibit resolution (SPEC §8.4) > resolves an intact exhibit from source and flags tampered content` | guarded |
| DI-9 | Raw payload retained per imported source with SHA-256 hash and parser version; never mutated | §7.1, §2.3, §11 | `src/lib/db/rawSources.ts:20-49` | `db/rawSources.test.ts::storeRawSources — immutable raw retention > stores a capture with its SHA-256 content hash and provenance` | guarded |
| DI-10 | A materially changed re-import becomes a new source version, not an update | §7.1, §21 dec 6 | `rawSources.ts:31-46` | `rawSources.test.ts::stores a changed re-import as a new source version, not an update`; `src/lib/import.test.ts::records a grown session file as a new raw version…` | guarded |
| DI-11 | Stored source integrity re-verifiable against its hash | §2.3, §7.1 | `rawSources.ts:66-71` | `rawSources.test.ts::verifyRawSource — integrity check > fails verification when stored text no longer matches its hash` | guarded |
| DI-12 | Parser errors visible without discarding unaffected events | §7.1, §13 | `src/lib/parsers/claude-code.ts` (`ParseWarning` per skipped line) → `parsers/index.ts` (`ImportWarning` with filename) → `import.ts` (`ImportResult.parseWarnings`) → `components/import/ImportProgress.tsx` (amber notice) | `src/lib/parsers/claude-code.test.ts::skips malformed lines and parses valid ones` (asserts the warning); `::numbers malformed-line warnings by source line, counting blank lines`; `src/lib/import.test.ts::surfaces skipped malformed lines on the import result, attributed to the file` | guarded (drift fixed 2026-09-09, `db060a6`) |
| DI-13 | Raw payloads live in a local-only Dexie table excluded from sync; only hash + provenance may sync | §7.1, §21 dec 3 | `db/schema.ts:122`; `sync/engine.ts:603-605` (no hook registered) | `constraints.test.ts::keeps the sync tables untouched for local-only investigation data` — row counts only; does not assert absence of a sync hook | implemented-unguarded |
| DI-14 | Source events and derived anchors never sync (recomputable per device) | §11, §21 dec 4-5 | `schema.ts:126-129`; `sync/syncApi.ts:30-34`; `engine.ts:512-516` | none | implemented-unguarded |
| DI-15 | Normalize only directly represented facts; never inferred intent, rationale, category, importance, topic, sentiment, ownership | §7.2, §11 | `anchors.ts:84`; `src/types/investigation.ts` (no such fields) | none | implemented-unguarded |
| DI-16 | Parsers preserve `tool_use_id` / tool-block `id` on `ContentBlock` | §11, §21 dec 10 | `parsers/claude-code.ts`; `anchors.ts:114` | `import.test.ts::stores tool ids end-to-end on imported message content blocks` | guarded |
| DI-17 | One anchor per parsed structured code-changing event (edit/write/patch/multi-edit) | §4, §7.3 | `anchors.ts:89-124` | `anchors.test.ts::creates one anchor per structured edit, keyed to the raw source hash`; `::represents a MultiEdit as one anchor with ordered child file changes` | guarded |
| DI-18 | An arbitrary shell command never creates a code-change anchor | §7.3 | `anchors.ts:90-92` | `anchors.test.ts::never anchors shell commands or non-edit tools` | guarded |
| DI-19 | Anchor generation deterministic and idempotent; re-import never duplicates | §7.3 | `anchors.ts:106-108` | `anchors.test.ts::is idempotent: re-deriving produces identical ids and no duplicates` | guarded |
| DI-20 | Stable key derives from source hash + event ordinal, never stored message IDs | §7.3, §21 dec 5 | `anchors.ts:66-77,106` | `anchors.test.ts::creates one anchor per structured edit, keyed to the raw source hash`; `::falls back to conversation-keyed legacy identity when no raw source exists` | guarded (key omits the spec's "change index"; deliberate per §7.3 MultiEdit rule) |
| DI-21 | Source, selection, and code content hashes are stable | §16.1.5, §8.4, §8.5 | `anchors.ts:177-183` | `anchors.test.ts::distinguishes a Write (no oldString) from an Edit to empty-old-string` | guarded |
| DI-22 | Anchor labels use literal metadata templates only — never a semantic conclusion | §7.4, §8.1 | `filter.ts:84-95` | `filter.test.ts::anchorFileLabel — literal labels > shows the single path verbatim`; `::shows a literal count for multi-file anchors` | guarded |
| DI-23 | A source with no code-changing tool events cannot create a code-change anchor | §5.1 | `anchors.ts:148-151,90` | `anchors.test.ts::backfills all agent sessions but never chat-only sources` | guarded |
| DI-24 | Event association precedence: explicit IDs → adjacency → timestamps as navigational join only, never causation | §7.5 | `detection/normalize.ts`; `investigation/context.ts` | none in the investigation suite | implemented-unguarded |
| DI-25 | Related-conversation copy says "Nearby conversations", never asserts causation | §7.5, §8.2 | nearby-sources surface not built | n/a | proposed (deferred §20) |
| DI-26 | Anchor browser filters (project/session/date/path-substring/type/case-state) match literally and by exact enum | §8.1 | `filter.ts:43-69` | `filter.test.ts::filterAnchors — literal metadata filters only > matches file-path substrings case-insensitively and literally`; `::filters by case state derived from linked cases`; `::applies inclusive local-day date bounds` | guarded |
| DI-27 | Prose never replaced by summaries; collapsed tool payloads expand to exact original; entire source reachable | §8.2, §19 | `src/components/investigation/TranscriptReader.tsx:1-5,113-125` | none (no component tests for `src/components/investigation/`) | implemented-unguarded |
| DI-28 | Initial case title uses only a deterministic editable literal template | §8.3 | `cases.ts:38-41,76` | `cases.test.ts::startInvestigation (SPEC §8.3) > creates a draft case with the deterministic literal title template` | guarded |
| DI-29 | Notes and leads visibly labeled as the user's writing; "human-created unresolved leads" | §8.3, §13 | `CaseNotebook.tsx` (labels); no `lead` symbol anywhere | none | **not-found-in-code** (leads) |
| DI-30 | Transcript exhibit persists source hash, event id, exact offsets in documented encoding, selection hash, case id, time | §8.4, §11 | `cases.ts:220-241` (`offsetEncoding:'utf16'`) | `cases.test.ts::pinTranscriptExhibit > recomputes selected text and hash from the source, never trusting the caller`; `search.test.ts::finds matches inside non-ASCII text at correct UTF-16 offsets` | guarded |
| DI-31 | Exhibit renders from source + offsets; stored preview is a cache, not authority | §8.4 | `cases.ts:472-514` | `cases.test.ts::exhibit resolution… resolves an intact exhibit from source and flags tampered content` | guarded |
| DI-32 | If source/offsets no longer validate, mark `Source mismatch` and retain prior locator — never relocate | §8.4 | `cases.ts:510-513` | same as DI-31 (asserts `{status:'source_mismatch', cachedText}`) | guarded |
| DI-33 | A selection must not cross source events | §8.4 | `cases.ts:202-218` | `cases.test.ts::rejects out-of-bounds, inverted, and empty spans` | guarded |
| DI-34 | Code exhibits persist literal locator + hash; never generate prose explanation | §8.5 | `cases.ts:289-365` | `cases.test.ts::code exhibits (SPEC §8.5) > pins a line range within a hunk side and validates bounds`; `::sets and clears the human note on an exhibit` | guarded |
| DI-35 | Workbench search offers a role/kind filter; each search record persists filters | §8.6, §11 | no filter control in `WorkbenchSearch.tsx`; `types/investigation.ts:67-73` has no `filtersJson` | n/a | **not-found-in-code** |
| DI-36 | With a case open, each executed query is recorded verbatim with mode, count, timestamp | §8.6 | `cases.ts:382-403` | `cases.test.ts::search records and review scopes > appends verbatim search records` | guarded |
| DI-37 | A search record is evidence about process, not proof of absence | §8.6, §2.4 | UI copy constraint | n/a | policy |
| DI-38 | Regex mode, if added, must be backtracking-safe | §8.6 | not added (`mode` is literal `'literal'`) | n/a | proposed |
| DI-39 | Highlighting marks exact matched characters; excerpts copied from source | §8.6 | `TranscriptReader.tsx:281-296` | `search.test.ts::stepDisplayText — the renderer/search contract > returns prose verbatim…`; `::offsets identify the exact matched characters` | guarded (data layer only) |
| DI-40 | A review scope requires explicit user confirmation over valid ordered boundaries | §8.7, §19 | `cases.ts:409-447` | `cases.test.ts::confirms ordered review scopes and captures prior search records` | guarded |
| DI-41 | Review scope persists hash, start/end ids+ordinals, count, confirmation time, prior search record IDs | §8.7 | `cases.ts:430-444` | same as DI-40 | guarded |
| DI-42 | UI never marks content reviewed because it was rendered, scrolled past, or on screen | §8.7, §19 | `CaseNotebook.tsx:282` (button-only path; no IntersectionObserver) | none (no component tests) | implemented-unguarded |
| DI-43 | Draft scopes/exhibits removable; rows referenced by a finalized revision are permanent even after reopen | §8.7, §8.9, §13 | `cases.ts:367-379,449-461`; `verdicts.ts:153-162` | `verdicts.test.ts::finalize / reopen / refinalize — §8.9 immutability > evidence referenced by a finalized revision cannot be removed after reopen` | guarded |
| DI-44 | Origin/status/confidence from a fixed human-selected taxonomy; rationale is freeform human writing | §8.8, §9 | `verdicts.ts:29-39` | `constraints.test.ts` (lines 157-160) | guarded |
| DI-45 | Finalization requires ≥1 code exhibit + rationale; explicit-direction/agent-proposed/conflict need a transcript exhibit; silence/indeterminate/inherited need a review scope | §8.8 | `verdicts.ts:41-51,74-115` | `verdicts.test.ts::validateVerdict — §8.8 evidence rules > requires a transcript exhibit for explicit-direction categories`; `::requires a review scope for silence/indeterminate/inherited categories`; `::rejects finalization while requirements are missing` | guarded |
| DI-46 | Every verdict requires a primary anchor | §8.8 | not checked — `verdicts.ts:81-98` never validates `primaryAnchorStableKey`; question-kind cases have none | none | **not-found-in-code** |
| DI-47 | UI states exactly which evidence requirement is missing; nothing preselected, prefilled, or auto-scored | §8.8, §19 | `verdicts.ts:74-100`; `cases.ts:70-82` | `verdicts.test.ts::lists every missing requirement for an empty draft`; `constraints.test.ts` | guarded |
| DI-48 | Finalizing creates an immutable revision snapshot, sets `Adjudicated`, retains links to all evidence | §8.9, §11 | `verdicts.ts:107-139`; `db/investigationCases.ts` (`.add()` + unique `&[caseId+revisionNumber]`) | `verdicts.test.ts::finalization snapshots evidence into revision 1 and adjudicates the case` | guarded (local path; see note on sync `put`) |
| DI-49 | Reopening never edits the prior revision; refinalization creates a new one | §8.9, §19 | `verdicts.ts:142-150` | `verdicts.test.ts::reopen + refinalize creates revision 2 without mutating revision 1`; `constraints.test.ts` | guarded |
| DI-50 | Ledger defaults to newest revision while exposing full history | §8.9, §9 | `verdicts.ts:193-206`; `VerdictPanel.tsx:246-268` | `verdicts.test.ts::decision ledger — §9 > lists finalized cases with latest revision and counts; drafts never appear` | guarded |
| DI-51 | Ledger contains finalized human verdicts only; drafts never appear | §6, §9, §19 | `verdicts.ts:180-211` | same as DI-50 | guarded |
| DI-52 | Closure is factual — no confetti, XP, streaks, badges, urgency | §8.10, §5.3 | `VerdictPanel.tsx:58-96` | none | implemented-unguarded |
| DI-53 | Continuation hook is a real neighboring anchor (prev/next uninvestigated, same path) | §8.10 | `verdicts.ts:278-297` | `verdicts.test.ts::continuation — §8.10, real neighbors only > finds chronological uninvestigated neighbors and same-file anchors` | guarded |
| DI-54 | Ledger entry shows human rationale first, then evidence; every exhibit has Open in source; no AI summary above rationale | §9 | `src/pages/LedgerPage.tsx` | none | implemented-unguarded |
| DI-55 | Coverage reports factual counts only; never "percent understood", comprehension or quality score, heat-map labels | §2.5, §10, §19 | `verdicts.ts:215-268`; `CoverageView.tsx` | `verdicts.test.ts::coverage — §10, factual counts only > counts anchors per file path by derived state…`; `constraints.test.ts` | guarded |
| DI-56 | Anchor state derived from linked cases, never stored | §11, §8.1 | `filter.ts:34-41`; `InvestigationAnchor` has no `state` | `filter.test.ts::anchorCaseState — derived, never stored > maps draft/open/reopened case states to "open"`; `::maps adjudicated…` | guarded |
| DI-57 | Never store generated summaries, inferred topics, decision scores, or model provenance | §11 | `types/investigation.ts` (no such fields) | none | implemented-unguarded |
| DI-58 | Migrations safe on a populated database | §11 | `db/schema.ts:75-190` (additive chain) | none | implemented-unguarded |
| DI-59 | All mutations validate ownership, hashes, offsets, allowed case state at the trust boundary, not only in UI | §12 | `cases.ts:45-52,208-218,354-357,529-538`; `verdicts.ts:58-60,109-111,143-146` | `cases.test.ts::updateCaseHumanFields > rejects edits to adjudicated cases`; `::removes draft exhibits and scopes but verifies ownership`; `verdicts.test.ts::reopen rejects non-adjudicated cases` | guarded |
| DI-60 | Long transcripts use bounded rendering without changing order or text; `ConversationView` untouched | §13, §16.4 | `TranscriptReader.tsx:74-125` (`@tanstack/react-virtual`) | none — `perf.test.ts` is data-layer only | implemented-unguarded |
| DI-61 | Opening an anchor never parses the entire raw export | §16.4 | `investigation/context.ts:7-57` | `perf.test.ts::§16.4 — 10,000-event source stays interactive at the data layer` | guarded |
| DI-62 | Source text / code / notes distinguished by label not colour alone; keyboard-accessible; pinning has non-pointer alternative | §13 | `TranscriptReader.tsx:14-31`; `InvestigationWorkbenchPage.tsx:169-191`; `CaseNotebook.tsx:265-288` | none | implemented-unguarded |
| DI-63 | Finalizing uses a confirmation step explaining it creates a revision | §13 | `VerdictPanel.tsx:233-243` (`window.confirm`) | none | implemented-unguarded |
| DI-64 | Empty/error states explain what factual input is missing | §13 | `InvestigatePage.tsx:374,534`; `verdicts.ts:81-98` | `verdicts.test.ts::lists every missing requirement for an empty draft` (data layer) | implemented-unguarded (UI) |
| DI-65 | Investigation works with network disabled after import | §14, §19 | all reads hit Dexie | `constraints.test.ts` | guarded |
| DI-66 | Never send transcript text, code, queries, notes, or verdicts to any model or analytics service | §14, §2.2 | no outbound call site | `constraints.test.ts` | guarded |
| DI-67 | Existing client-side encryption preserved for all new persisted fields | §14 | `sync/serializer.ts:332,366,380,408` (envelopes for case/exhibit/scope/revision) | only `serializer.test.ts::investigation finding sync serializer`; the four entity envelopes have no round-trip test | implemented-unguarded |
| DI-68 | Sanitize rendered imported HTML/Markdown; tool outputs and code are untrusted display data | §14 | no `dangerouslySetInnerHTML` anywhere in investigation UI | none | implemented-unguarded |
| DI-69 | Never execute imported commands/patches/code; never resolve imported paths against the host filesystem | §14 | no `eval`/`Function`/`lib/fs` reference; paths literal (`filter.ts:60`) | none | implemented-unguarded |
| DI-70 | Never log source text, queries, or rationale | §14 | only two log sites, id-and-error only (`anchors.ts:161`, `agentInspections.ts:201`) | none | implemented-unguarded |
| DI-71 | Deleting a source cascades safely or leaves tombstones; no orphan exhibits appearing authoritative | §14 | `db/conversations.ts:40-88`; `sync/engine.ts:117-128` | `anchors.test.ts::cascades derived anchors on conversation deletion` — anchors only | implemented-unguarded (partial) |
| DI-72 | Local instrumentation records only factual events with no transcript content; no third-party analytics | §15 | none of the eight named events exist in `src/`; `src/lib/analytics.ts` is a stats aggregator | n/a | not-found-in-code (§15 conditional on an event ledger that does not exist) |
| DI-73 | No new remote connector, clone, or GitHub/source-control action inside this feature | §5.1, §5.3 | no `lib/github`/`lib/repo`/`lib/api` import | `constraints.test.ts`; `trace/boundary.test.ts` | guarded |
| DI-74 | No new database, search service, analytics vendor, or AI API | §3, §5.3 | Dexie only; one new dep (`@tanstack/react-virtual`) | n/a | policy |
| DI-75 | Sources frozen at import; merge-on-reimport deferred | §7.3, §20 | `rawSources.ts:31-33` | `import.test.ts::records a grown session file as a new raw version…` | guarded (frozen); proposed (merge) |
| DI-76 | Cross-source lexical index out of scope; anchor browser filters metadata only | §8.6, §20 | `search.ts` (single conversation); `filter.ts` | `filter.test.ts::passes everything with no filters` | guarded (metadata-only); proposed (index) |
| DI-77 | None of the §20 future features may weaken the five product laws | §20 | not implemented | n/a | proposed |

Possible append-only weakness: `sync/engine.ts:262-263` rehydrates a pulled `verdict_revision` with `db.verdictRevisions.put(...)`, which could overwrite a local revision under last-write-wins. Whether this can mutate a finalized revision was not traced end-to-end.

### Decision Recovery (DR)

Owner: `docs/capabilities/decision-recovery/SPEC.md`, as amended by `docs/changes/decision-review-experience/SPEC.md` (all seven amendment rows verified applied; no disagreement).

| ID | Guarantee | Owner § | Enforcing code | Guard test | Status |
|---|---|---|---|---|---|
| DR-1 | Every decision and assumption cites ≥1 verified verbatim transcript span; unlocatable claims are dropped, never stored as text | §2.1, §9.4.1, §9.4.5 | `src/lib/understanding/decisions/firewall.ts:107-124,246-250,288-292` | `decisions/firewall.test.ts::drops decisions and assumptions with no verifiable transcript evidence (law 2.1)`; `::rejects unknown steps and unlocatable quotes` | guarded |
| DR-2 | Basis labels are mechanically constrained after the model answers (specified→user span; inherited→pre-existing code/inspected path/dependency; invented→zero user spans; inferred→agent span); failures downgrade + warn | §2.2, §9.4.4 | `firewall.ts:178-217,295,309-313` | `firewall.test.ts::constrainBasis (law 2.2) > specified needs a user span`; `> inherited needs pre-existing code…`; `> invented cannot cite a user span; inferred needs an agent span` | guarded |
| DR-3 | The model never sets `madeBy` or `unsupportedAutonomous`; both derive from span roles/ordering | §2.2, §7.3, §9.4.7 | `firewall.ts:159-168,314,334`; `decisions/meta.ts:40-42` | `firewall.test.ts::derives from span roles and ordering only` | guarded |
| DR-4 | Recovery output lands `origin:'ai'`, `reviewState:'pending'`; recovery never emits superseded/contradicted/resolved events | §2.3, §9.5 | `decisions/runRecovery.ts:440-449,457-466`; `src/lib/db/understanding.ts:187` | `runRecovery.test.ts::re-recognizes an existing decision as a pending supported event and never supersedes` | guarded |
| DR-5 | Model `invalidates` claims land only on the trace and surface via the diff; recording one is a user-origin event | §2.3, §12 | `firewall.ts:345-368`; `runRecovery.ts:491`; `decisions/diff.ts` | `diff.test.ts::records a user-origin contradicted event and a user-origin merge` | guarded |
| DR-6 | Line numbers and offsets are recomputed from the located quote; the model's numbers are discarded | §2.4, §9.4.1 | `firewall.ts:113-123` | `firewall.test.ts::locates a whitespace-tolerant quote and recomputes offsets` | guarded |
| DR-7 | Recovery never writes to Decision Investigation tables; reaches investigation only via read-only db accessors + one-way finding promotion | §2.5, §13.1 S10 | `decisions/fromInvestigation.ts` | `src/lib/understanding/trace/boundary.test.ts::decision recovery reaches investigation only through read-only db accessors and the one-way finding promotion` | guarded (import-level only; DI table writes via shared `db` would not be caught) |
| DR-8 | `planRecovery` runs before any provider call and produces the disclosure (conversations, sources, cross-provider, hunk count, excerpt count) | §2.6, §9.2, §10.4 | `runRecovery.ts:175-275`; `src/pages/DecisionsPage.tsx:152-177,411-421` | `runRecovery.test.ts::assembles the disclosure inputs without calling the provider`; `DecisionsPage.test.tsx::plans and discloses before any provider call, then runs recovery on confirm` | guarded |
| DR-9 | Decisions ordered by first citing step, grouped by primary path or session; group order = first appearance | §2.7, §10.2 | `decisions/decisionMatrix.ts:91-101`; `src/components/decisions/DecisionList.tsx` | `DecisionsPage.test.tsx::browses saved evidence, searches and groups without writes or provider calls, then reviews explicitly` | guarded |
| DR-10 | **No importance score**; no inferred relevance ranking. Only neutral evidence-presence cues, explicit filters, grouping, pagination | §2.7; change spec | `decisions/reviewBrowser.ts:7-15`; `DecisionsPage.tsx:118-130` | none — adding a score field used for ordering would fail no test | implemented-unguarded |
| DR-11 | `DecisionDiff` is a pure function of two trace sets — no model, no network; deterministic; `differVersion` bumps on fold-rule change | §2.8, §12 | `decisions/diff.ts` | `diff.test.ts::is deterministic and builds an idempotent id`; `::emits every op once, in deterministic order` | guarded |
| DR-12 | `agentInspections` and `decisionDiffs` are LOCAL-ONLY, never enter sync | §2.9, §7.5, §13.1 S1 | `src/lib/db/schema.ts` (v13) | `src/lib/db/localOnly.test.ts::is never referenced by the sync engine or serializer (audit S1 / S12)` | guarded |
| DR-13 | `decision_trace` payloads carry only paths, shas, keys, line ranges, quotes ≤500 chars; whole files never sync | §2.9, §13.1 S5 | `firewall.ts:120` → `trace/judge.ts:16` (`MAX_STORED_QUOTE_CHARS`); `src/lib/sync/serializer.ts:552-558` | `trace/judge.test.ts::recomputes line numbers from the quote position and caps stored quotes`; `localOnly.test.ts` (as above) | guarded |
| DR-14 | Nothing is written to the repository, working tree, or GitHub | §2.10 | `src/lib/github/client.ts:13,225`; `src/lib/fs/directoryPicker.ts:28,61` (`mode:'read'`) | `github/client.test.ts::module surface (read-only law §2.4) > never issues anything but GET` | guarded |
| DR-15 | Envelope cleartext for `decision_trace` is ids and timestamps only; parent = `decisionObjectId` | §7.6, §13.1 S9 | `sync/serializer.ts:552-558` | `sync/serializer.test.ts::round-trips a trace; parentId is the decision object` | guarded |
| DR-16 | Deleting an `understanding_object` cascades its decision traces | §7.6 | `sync/engine.ts:172,202-203` | `sync/engine.test.ts::deleting a decision object from the server cascades to its traces` | guarded |
| DR-17 | `DecisionTrace` rows are append-only per (decisionObjectId, runId); no update/delete helper | §6, §7.5 | `src/lib/db/decisionTraces.ts:1-10`; `runRecovery.ts:419` | `runRecovery.test.ts::re-recognizes… never supersedes`; `DecisionsPage.test.tsx::browses saved evidence…` (traces byte-identical after browse and Accept) | guarded |
| DR-18 | `anchorStepIndexes` must be anchors actually supplied; others dropped with a warning | §9.4.3 | `firewall.ts:255-266` | `firewall.test.ts::verifies quotes, constrains bases, derives madeBy, links anchors, and keeps invalidations on the side` | guarded |
| DR-19 | An `existingObjectId` not in the plan is treated as new (and warned) | §9.4.6 | `firewall.ts:316-320` | `firewall.test.ts::re-recognizes only known existing ids and enforces caps` | guarded |
| DR-20 | Response caps: 20 decisions / 8 assumptions / 4 alternatives per call | §9.3 | `decisions/prompt.ts`; `firewall.ts:229-284` | `firewall.test.ts::re-recognizes only known existing ids and enforces caps` | guarded |
| DR-21 | `assertNoSecrets` runs before every provider call; GitHub token and provider keys never enter a prompt | §9.5, §13.1 S2 | `runRecovery.ts:397`; `decisions/challenge.ts:147`; `trace/fetchPolicy.ts:93` | `challenge.test.ts::refuses to send a prompt containing the GitHub token`; `runRecovery.test.ts::sends exactly the planned excerpts…`; `fetchPolicy.test.ts::assertNoSecrets` | guarded |
| DR-22 | `scrubSecrets` on hunks, excerpts, and every stored AI string/quote | §9.1, §13.1 S3 | `decisions/candidates.ts:92,118`; `runRecovery.ts:374`; `firewall.ts:76-80` | `candidates.test.ts::scrubs secrets from agent text and drops the oldest edits first when over the cap` | guarded |
| DR-23 | `isFetchAllowed` on every repository path; sensitive denylist honoured | §9.1, §13.1 S4 | `candidates.ts:197` | `candidates.test.ts::marks pre-existing vs created paths, resolves suffixes, and refuses sensitive paths` | guarded |
| DR-24 | Excerpt caps (user msgs 4000, hunks 1500/side, total 60000, drop-oldest + warn); last 2 closing agent statements always included | §9.1, §13.1 S5 | `candidates.ts:16-22,86-158` | `candidates.test.ts::always includes the closing agent statements after the last edit, even under the cap` | guarded |
| DR-25 | Relay untouched, transit-only — no persistence or logging of content | §13.1 S6 | `backend/src/routes/llm.ts:1-7` | see INV-11 (`backend/src/routes/llm.test.ts`) | guarded (via INV-11) |
| DR-26 | Blast radius makes zero network calls, is never stored, labelled `verification:'heuristic'` | §11.2, §13.1 S8 | `decisions/blastRadius.ts` | `blastRadius.test.ts::finds references outside own files… — heuristic, zero network` (stubs fetch, asserts never called) | guarded |
| DR-27 | Challenge results land as contradicted/supported with `origin:'ai'`, `reviewState:'pending'` only | §11.4 | `decisions/challenge.ts` | `challenge.test.ts::plans without calling the provider… and records a pending event per verdict` | guarded |
| DR-28 | `VerdictOrigin → basis/madeBy/flags` promotion map (7 rows); no `DecisionTrace` created on DI promotion | §7.4 | `decisions/fromInvestigation.ts` | `fromInvestigation.test.ts::maps every VerdictOrigin and derives the unsupported flag` | guarded ("no trace created" half unasserted) |
| DR-29 | Browsing/search/grouping/paging make no provider calls and mutate no saved records | §10.5; change spec | `DecisionsPage.tsx:118-130`; `decisionMatrix.ts:104-132` | `DecisionsPage.test.tsx::browses saved evidence… without writes or provider calls` (asserts `complete` never called, records byte-identical) | guarded |
| DR-30 | 40 rows per page; selection is inspection only; nothing preselected for review | §10.2, §10.5 | `reviewBrowser.ts:3` (`PAGE_SIZE`); `DecisionList.tsx:85` | `DecisionsPage.test.tsx::restores URL selection and filters, handles empty results, and bounds large lists` | guarded |
| DR-31 | Search/grouping/filters/selection/page live in URL query params; reload restores; source links open another tab | §10.2 | `DecisionsPage.tsx`; `DecisionList.tsx` | `DecisionsPage.test.tsx::restores URL selection…`; `::browses saved evidence…` (`target=_blank`) | guarded |
| DR-32 | Keyboard: arrows/Home/End select rows, Tab reaches evidence pane, Escape returns | §10.2 | `DecisionList.tsx` | `DecisionsPage.test.tsx::browses saved evidence…` | guarded (Home/End unasserted) |
| DR-33 | Accept/Reject update only the object's review state + timestamp; never accept pending events, create history events, or record endorsement; Reject preserves object/traces/events | §10.3 | `src/lib/db/understanding.ts:332-334`; `DecisionsPage.tsx:145`; `DecisionDetailPage.tsx:135` | `DecisionsPage.test.tsx::browses saved evidence…` (after Accept: traces + events byte-identical) | guarded (Accept only; Reject unasserted) |
| DR-34 | Filtered result counts exclude rejected objects | §10.2 | `DecisionsPage.tsx:385`; `decisionMatrix.ts:63` | none (`decisionMatrix.ts` has no unit test) | implemented-unguarded |
| DR-35 | Path normalization only replaces separators, repeated slashes, leading `./`; infers no roots or topics | change spec | `reviewBrowser.ts:4-6` | none (`reviewBrowser.ts` has no test file) | implemented-unguarded |
| DR-36 | Hunk previews capped at 3000 chars/side with link to full source; missing anchors labelled unavailable | §10.3 | `src/components/decisions/RecordedEdits.tsx:23-25` | none | implemented-unguarded |
| DR-37 | Every model-authored string is labelled AI and capped (statement 300, free text `MAX_AI_TEXT_CHARS`) | §10.5, §13.1 S5/S7 | `firewall.ts:27,76-80`; labels in `DecisionList.tsx`, `AssumptionList.tsx`, `DecisionDetailPage.tsx` | none asserting the label or caps on the decision path | implemented-unguarded |
| DR-38 | Recorded run/provider/model and repo key/SHA shown from the trace, separately from current binding; `local` is a working-tree marker; missing data explicit | §10.5 | `DecisionList.tsx:92-99`; `src/lib/repo/localDirSource.ts:12` | `DecisionsPage.test.tsx::browses saved evidence…` (asserts recorded snapshot + "No trace quotes available") | guarded (`local` copy unasserted) |
| DR-39 | Trace warnings are never summed into a fabricated run-health report; run-wide diagnostics declared unavailable | §10.5 | `DecisionsPage.tsx:330` | none | implemented-unguarded |
| DR-40 | The bound ref decides the snapshot sha; another branch's cache is never silently substituted; fallback carries a different-branch warning | §2.2, §9.2 | `runRecovery.ts:119-167` | `runRecovery.test.ts::resolves the bound ref rather than reusing the most recently indexed branch`; `::warns instead of failing when the resolved snapshot is not indexed`; `::falls back to the last indexed snapshot with a different-branch warning…` | guarded |
| DR-41 | Agent inspections derive from read-only tools and read-only Bash segments only | §8.1 | `src/lib/investigation/agentInspections.ts` | `agentInspections.test.ts::ignores commands that write or run things`; `::never derives from non-inspection tools` | guarded |
| DR-42 | `agentInspections` ids are idempotent and cascade with conversation delete / `clearAllData` | §8.1, §7.5 | `agentInspections.ts`; `src/lib/db/index.ts` | `agentInspections.test.ts::is idempotent and cascades with the conversation` | guarded |
| DR-43 | Provider failures are isolated per conversation and do not advance the recovery cursor | §9.5 | `runRecovery.ts:507-520` | `runRecovery.test.ts::isolates provider failures per conversation and does not advance the cursor` | guarded |
| DR-44 | A replacement Change Workspace seeded from a decision does not treat a pending decision as accepted understanding | §11.3 | `decisions/replacement.ts` | `replacement.test.ts::seeds intent… without treating a pending decision as accepted understanding` | guarded |

Internal spec inconsistencies (not drift vs code): §2.5 says `src/lib/investigation/*` is not modified, but §8.1 places `agentInspections.ts` there and it exists. §7.1 meta table omits `conversationId`, which the code writes and depends on for session grouping.

### Repository Integration (RI)

Owner: `docs/capabilities/repository-integration/SPEC.md`.

| ID | Guarantee | Owner § | Enforcing code | Guard test | Status |
|---|---|---|---|---|---|
| RI-1 | Persisted `pinnedRef` may hold a moving branch; binding UI allows viewing/changing and accepts consumer-suggested refs | §2 | `src/components/intents/RepoBindingCard.tsx`; `runRecovery.ts:136` | `RepoBindingCard.test.tsx::round-trips a saved ref back into the field`; `::fills the ref from a suggested-ref chip` | guarded |
| RI-2 | Ref validation must not silently discard an invalid branch or substitute the default branch | §2 | `src/lib/github/client.ts` (`assertRef`); `RepoBindingCard.tsx` | `RepoBindingCard.test.tsx::refuses to save a ref that does not resolve`; `github/client.test.ts::names no ref for refless paths…` | guarded |
| RI-3 | Selected branch and resolved SHA are distinct; traces record the immutable revision examined; rebinding never retroactively changes historical evidence | §2 | `src/types/decision.ts:183-184`; `src/lib/db/decisionTraces.ts:1-10`; `runRecovery.ts:151` | partial: `runRecovery.test.ts::resolves the bound ref…` (asserts sha and ref separate). No test rebinds and re-reads old traces | implemented-unguarded (retroactivity clause) |
| RI-4 | Binding controls do not imply scheduled refresh, local `git pull`, or background model reruns | §2, §4 | no scheduler/poller exists | nothing guards against a future refresh timer | policy |
| RI-5 | GitHub files cached by (repoKey, sha, path); snapshots from different revisions coexist | §3 | `src/lib/db/repoFiles.ts`; `schema.ts` | `localOnly.test.ts::caches, lists, and evicts repository files per (repoKey, sha)` | guarded |
| RI-6 | Local directory source uses `fs:` identity and the `local` revision marker, which is not a commit | §3 | `src/lib/repo/localDirSource.ts:12,18-20` | `localDirSource.test.ts::indexes into the local cache under fs:<name> at sha "local"` | guarded |
| RI-7 | Whole-file caches remain LOCAL-ONLY | §3, §4 | `db/repoFiles.ts` | `localOnly.test.ts::is never referenced by the sync engine or serializer (audit S1 / S12)` | guarded |
| RI-8 | Successful ref resolution with no indexed snapshot is a missing-cache condition, not permission to substitute another branch | §3 | `runRecovery.ts:143-151` | `runRecovery.test.ts::warns instead of failing when the resolved snapshot is not indexed` | guarded |
| RI-9 | Resolution-failure fallback may use latest cache only with an explicit different-branch warning | §3 | `runRecovery.ts:152-160` | `runRecovery.test.ts::falls back to the last indexed snapshot with a different-branch warning…` | guarded |
| RI-10 | GitHub is read-only through the validated client; API host is a constant with no base-URL option | §4 | `github/client.ts:13-15,214,225` | `github/client.test.ts::never issues anything but GET`; `::hits the constant API host…` | guarded |
| RI-11 | Tokens are device-local — excluded from sync in both directions | §4 | `github/credentials.ts:11-12`; `sync/engine.ts:81,90,103` | `sync/engine.test.ts::never pushes github.* metadata`; `::ignores incoming github.* metadata records from the server`; `localDirSource.test.ts::keeps the handle keys out of sync` | guarded |
| RI-12 | Tokens sent only to `api.github.com`, only in `Authorization`, never in a URL | §4 | `github/client.ts:6-7,15,214-225` | `github/client.test.ts::hits the constant API host with the right headers and the token only in Authorization`; `::omits Authorization without a token` | guarded |
| RI-13 | Tokens excluded from model prompts and relay bodies | §4; DR §13.1 S2 | `providers/relayClient.ts`; `runRecovery.ts:397`; `challenge.ts:147` | `providers/relayBody.test.ts::carries only provider fields — no github key, no token string`; `challenge.test.ts::refuses to send a prompt containing the GitHub token` | guarded |
| RI-14 | Local directory access is read-only | §4 | `src/lib/fs/directoryPicker.ts:28,61` (`mode:'read'`) | `localDirSource.test.ts::lists allowed files only…` (read-only walk); no test asserts the `mode:'read'` request | implemented-unguarded |
| RI-15 | Consumer records use locators and capped quotes, not whole files | §4 | `src/lib/repo/search.ts:230-231`; `trace/judge.ts:136` | `trace/judge.test.ts::recomputes line numbers… and caps stored quotes` | guarded |
| RI-16 | Sensitive and excluded paths are never cached; per-file size caps apply | §4 | `src/lib/repo/index.ts` (`planIndex`); `github/client.ts:18` (`MAX_FILE_BYTES`) | `repo/index.test.ts::drops sensitive and excluded paths before anything is fetched, then applies caps`; `localDirSource.test.ts::refuses oversized folders (S11)` | guarded |
| RI-17 | Decision Investigation's quarantine gains no new imports, network access, or dependencies from this layer | §1 | forbidden-import list includes `/repo/` and `/github/` | `trace/boundary.test.ts::lib/investigation never imports the GitHub client, intent/trace modules, the LLM providers, or the Change Workspace` | guarded |
| RI-18 | Model calls remain separately disclosed under invariant 6 | §4 | `DisclosureModal.tsx`; `understanding/runDiscovery.ts:48-63` | `DecisionsPage.test.tsx::plans and discloses before any provider call…` | guarded |

### Intent Trace (IT)

Owner: `docs/capabilities/intent-trace/SPEC.md`.

| ID | Guarantee | Owner § | Enforcing code | Guard test | Status |
|---|---|---|---|---|---|
| IT-1 | Every intent cites the real message(s) it came from; AI-origin object without evidence is rejected | §2.1, §7.3 | `db/understanding.ts:173`; `understanding/intents/extraction.ts:341` | `intents/extraction.test.ts::extractIntentsForBatch — persistence > creates pending intent objects with meta and prompt+reply evidence` | guarded |
| IT-2 | Every spec/impl status cites a verbatim quote that is a substring of the fetched file at the pinned commit; unverifiable status downgraded, never invented | §2.1, §9.4 | `understanding/trace/judge.ts:130,214,238` | `trace/judge.test.ts::parseTraceResponse > downgrades statuses whose evidence does not verify`; `::verifyCodeEvidence > rejects unknown paths and paraphrases` | guarded |
| IT-3 | Line numbers recomputed from the quote's position; the model's numbers ignored | §9.4 | `judge.ts:130-136` | `judge.test.ts::recomputes line numbers from the quote position and caps stored quotes` | guarded |
| IT-4 | Origin forced `unprompted` when no assistant text precedes the reply; the model may not override | §2.2, §7.3, D10 | `extraction.ts:242-245` | `extraction.test.ts::parseIntentResponse — firewall > forces origin to unprompted when the pair has no preceding assistant text` | guarded |
| IT-5 | Both unprompted and reply-to-AI intents extracted, each carrying its origin | §5.1, D10 | `intents/pairs.ts`; `extraction.ts:135` | `pairs.test.ts::yields one pair per user message with correct indexes`; `::marks the opening message as unprompted (promptI null)…` | guarded |
| IT-6 | `promptedBy` coerced to the pair's own `promptI`, never trusted from the model | §7.3 | `extraction.ts:272` | `extraction.test.ts::accepts a well-formed intent and coerces promptedBy to the pair` | guarded |
| IT-7 | `statedIn` outside known replies ⇒ dropped; non-JSON ⇒ throw; bad enums ⇒ defaults; unknown `matchesExisting` ⇒ null; cap enforced | §7.3 | `extraction.ts:212-264` | `extraction.test.ts::drops intents citing unknown replies or missing fields`; `::throws on non-JSON`; `::defaults bad enums…`; `::caps the number of intents` | guarded |
| IT-8 | A non-verbatim `statement` is replaced by the reply excerpt + warning | §2.1, §7.3 | `extraction.ts:230-233` | `extraction.test.ts::replaces a non-verbatim statement with the reply excerpt and warns` | guarded |
| IT-9 | All AI output lands `pending`; nothing auto-accepts | §2.3, §7.3 | `db/understanding.ts:187` | `extraction.test.ts::creates pending intent objects…`; `::records a pending supported event (not a new object) for matchesExisting…` | guarded |
| IT-10 | GitHub read via `api.github.com` only; never writes, never clones (GET only) | §2.4, §5.2 | `github/client.ts:15,214,225` | `client.test.ts::never issues anything but GET`; `::hits the constant API host…` | guarded |
| IT-11 | GitHub token device-local; `github.` metadata never enters sync in either direction | §2.4, §8.1, §11.4, D4 | `sync/engine.ts:81-87`; `github/credentials.ts:11` | `engine.test.ts::never pushes github.* metadata`; `::ignores incoming github.* metadata records from the server` | guarded |
| IT-12 | Token travels only in `Authorization`, never in URL, relay body, or prompt | §2.4, §8.2, §13 S2 | `client.ts:222`; `trace/runTrace.ts:338` (`assertNoSecrets`) | `providers/relayBody.test.ts::carries only provider fields — no github key, no token string`; `fetchPolicy.test.ts::assertNoSecrets > throws when a known secret appears in any message` | guarded |
| IT-13 | Only `commitSha`, paths, line ranges, capped quotes (≤500) persisted — never whole files | §2.4, §9.5, §13 S7 | `judge.ts:16,130-140` | `judge.test.ts::recomputes line numbers… and caps stored quotes` | guarded |
| IT-14 | `detection/**` and `investigation/**` gain no import of GitHub, intents, trace, providers; reverse direction uses only `normalizeSession` + anchor reads | §2.5, §13 S10 | `trace/boundary.test.ts:31-40` (the guard is the enforcement) | `boundary.test.ts::lib/detection never imports…`; `::lib/investigation never imports…`; `::the intent/trace modules touch detection only through normalizeSession and investigation only through anchor reads` | guarded |
| IT-15 | Before content leaves, user sees what goes to which provider; repository excerpts are a named distinct disclosure category | §2.6, §10.3, §13.3 | `src/pages/IntentTracePage.tsx:425-432` | `IntentTracePage.test.tsx::re-traces one intent with a typed extra path only after the repository-excerpts disclosure is confirmed`; `::cancelling the disclosure sends nothing` | guarded |
| IT-16 | `planTrace` resolves sha, tree, candidates, spec docs before any LLM call and returns disclosure counts | §9.5, §10.3 | `runTrace.ts:141-200` | `runTrace.test.ts::planTrace > resolves the sha, finds spec docs, selects candidates through the gate, and reports disclosure counts` | guarded |
| IT-17 | Tracing refused (UI disabled with reason) until a repository is bound | §8.3, §10.3 | `runTrace.ts:143`; `IntentTracePage.tsx:329` | `runTrace.test.ts::refuses without a repository binding…`; `IntentTracePage.test.tsx::enables Trace when a repository is bound…` | guarded |
| IT-18 | No spec docs in tree ⇒ `specStatus:'no_spec'` with no model involvement | §9.1, D12 | `judge.ts:36,199-201`; `runTrace.ts` | `runTrace.test.ts::records no_spec without a spec section when the tree has no spec docs`; `judge.test.ts::includes the spec section only when spec excerpts exist…`; `::ignores any spec section when the run had no spec docs…` | guarded |
| IT-19 | Sensitive paths never fetched — candidates, model `suggestedPaths`, user-typed alike; excluded dirs never candidates | §9.3, §13 S4 | `trace/fetchPolicy.ts:10-58`; `runTrace.ts:307` | `runTrace.test.ts::never fetches a sensitive path even when it is suggested or typed…`; `fetchPolicy.test.ts::refuses sensitive paths wherever they sit`; `::refuses excluded dirs, lockfiles, minified and binary files`; `candidateFiles.test.ts::applies the fetch gate to every channel and reports skips` | guarded |
| IT-20 | `scrubSecrets` redacts before any excerpt enters a prompt; counts go to warnings | §9.3, §13 S4 | `fetchPolicy.ts:60-91`; `runTrace.ts:307-311` | `fetchPolicy.test.ts::scrubSecrets > redacts secret-shaped strings and counts them`; `runTrace.test.ts::…and scrubs secrets from excerpts` | guarded |
| IT-21 | Excerpts wrapped in data delimiters; system prompt states file/spec/conversation content is untrusted data | §9.3, §13 S3 | `fetchPolicy.ts:109`; `judge.ts:36-47` | `fetchPolicy.test.ts::wrapExcerpt > delimits content and neutralises an embedded closing tag`; `judge.test.ts::…wraps excerpts as data` | guarded |
| IT-22 | Per-intent failure records `implStatus:'unknown'` + warning; run aborts only on rate limit or relay auth failure | §9.5 | `runTrace.ts:263,313,362,370-386` | `runTrace.test.ts::isolates a failing intent as an unknown trace and aborts only on rate limit` | guarded |
| IT-23 | Caps: `maxIntentsPerRun` 50, `maxTreeEntries` 50k, `maxFiles` 8, `maxCharsPerFile` 6000 — configurable | §9.5, §13 S5 | `runTrace.ts:155-157,173,197,310` | `candidateFiles.test.ts::puts extra paths first and honours keywordDisabled`; `::excerptFile > caps characters` — no test asserts `maxIntentsPerRun` 50 despite §14 IT-4 requiring one | implemented-unguarded (cap 50) |
| IT-24 | `owner`/`repo` match `^[A-Za-z0-9_.-]+$`; path segments encoded, `..` rejected; `sha` matches `^[0-9a-f]{7,40}$`; files >200 KB rejected | §8.2 | `client.ts:65-80,376` | `client.test.ts::assertRepoName rejects unsafe names`; `::encodeRepoPath encodes segments and rejects traversal/empties`; `::…enforces the size cap` | guarded |
| IT-25 | 403/429 ⇒ `GitHubRateLimitError` carrying reset time | §8.2, §13 S5 | `client.ts` (`request()`) | `client.test.ts::raises GitHubRateLimitError with resetAt on 403 remaining=0 and on 429`; `::a 403 with remaining budget is a plain GitHubError` | guarded |
| IT-26 | No `searchCode` / GitHub code-search surface exists | §5.2, §8.2 | absent from `client.ts` | `client.test.ts::never issues anything but GET` (indirect; endpoint absence unasserted) | implemented-unguarded |
| IT-27 | Error responses never echo the GitHub response body | §13 | `client.ts` (`request()`) | `client.test.ts::raises content-free errors (no response body echoed)` | guarded |
| IT-28 | Classic/over-privileged token accepted but flagged; fine-grained not | §8.1 | `client.ts` (`getTokenInfo`); `settings/GitHubSection.tsx:39` | `client.test.ts::getTokenInfo > flags classic tokens with write scopes and accepts fine-grained tokens` | guarded |
| IT-29 | `intentTraces` append-only (new commit ⇒ new row); deleting an object cascades its traces | §11.3, D7 | `db/intentTraces.ts`; `sync/engine.ts:171` | `db/intentTraces.test.ts::getLatestTraceByIntent keeps the newest trace per intent (append-only history)`; `engine.test.ts::deleting an understanding object from the server cascades to its traces` | guarded |
| IT-30 | `intent_trace` cleartext envelope is exactly `{kind, parentId, updatedAt}`; `repoRef` inside ciphertext | §11.4, §13 S9 | `serializer.ts` (`envelopeIntentTrace`) | `serializer.test.ts::keeps repository details out of the cleartext envelope (audit S9)` | guarded |
| IT-31 | Traces bind to an immutable sha, never a branch; `ref` is advisory | §6 | `runTrace.ts:148-151` | `runTrace.test.ts::traces against the branch the binding pins, and config.ref still overrides it` | guarded |
| IT-32 | Every user message yields a pair; system/tool senders never pair; pasted logs skipped; tool calls between assistant text and reply skipped | §7.1 | `intents/pairs.ts` | `pairs.test.ts::ignores system messages for pairing…`; `::skips tool calls/results between assistant text and the user reply…`; `::does not produce a pair from a tool_result-only user message`; `::skips a pasted stack trace…` | guarded |
| IT-33 | Heuristic patterns are linear (no nested quantifiers/backreferences); 10 KB adversarial input within budget | §7.2, §13 S8 | `intents/heuristic.ts` | `heuristic.test.ts::INTENT_PATTERNS > are all linear…`; `::ReDoS resistance (audit S8) > scores adversarial 10 KB inputs quickly` | guarded |
| IT-34 | Extraction cursor advances only when every batch succeeded and the run was unscoped | §7.4 | `intents/runExtraction.ts` | `runExtraction.test.ts::scoped runs never advance the cursor`; `::stops at the first failing batch, keeps earlier writes, and leaves the cursor alone` | guarded |
| IT-35 | `currentUnderstanding` excludes `type==='intent'` from panel buckets | §7.4 | `currentUnderstanding.ts:110` | none | implemented-unguarded |
| IT-36 | Quotes and paths render as text nodes; GitHub links only via validated builders with `rel="noopener noreferrer"`; `htmlUrl` allowlisted to github.com | §10.5, §13 S6 | `components/intents/IntentTraceRow.tsx:54`; `client.ts:449-470` | `IntentTracePage.test.tsx::renders intents…, escapes quotes, and links verified evidence`; `::renders no link for a malformed repository owner…`; `client.test.ts::isGitHubWebUrl allowlists github.com only` | guarded |
| IT-37 | Extraction lives under `understanding/intents/`, never `investigation/` | D9 | directory layout; `boundary.test.ts:31-40` | `boundary.test.ts::lib/investigation never imports…` | guarded |
| IT-38 | Invariant-6 amendment wording lives in CLAUDE.md | §13.3, §17 | CLAUDE.md invariant 6 | n/a | policy |
| IT-39 | `src/lib/crypto/` never touched by this feature | §0 | no import of `lib/crypto` from intents/trace/github | none | policy |
| IT-40 | Out of scope: agentic repo exploration, code search, PR listing, repo writes, spec generation, backend GitHub proxy, OAuth | §5.2, §18 | absent | `client.test.ts::never issues anything but GET` (writes only) | policy |

### Change Workspace (CW)

Owner: `docs/capabilities/change-workspace/SPEC.md` (PRD rules noted where SPEC does not own them).

| ID | Guarantee | Owner § | Enforcing code | Guard test | Status |
|---|---|---|---|---|---|
| CW-1 | Every evidence item carries exactly one `EvidenceKind` plus locator data; a claim without evidence is `unknown`, never hidden or auto-upgraded | §2.1, §8 | `src/types/evidence.ts`; `prepare/lifecycle.ts:63-93` | `prepare/trace.test.ts::deriveEdgeVerification (D4, law §2.2) > it.each(…)`; `lifecycle.test.ts::appends evidence and never exceeds the quote cap` | guarded |
| CW-2 | AI output is `ai_inference` and can never set an edge, criterion, or claim to `verified` | §2.2, §10, §12, S3 | `prepare/trace.ts` (`deriveEdgeVerification`); `lifecycle.ts:250-252`; `verification.ts:42-44` | `trace.test.ts::honours the single human override and never an AI one`; `lifecycle.test.ts::blocks "supported" on AI-only evidence and gates markVerified on notes`; `VerificationSection.test.tsx::blocks AI-only support…` | guarded |
| CW-3 | UI copy for AI actions says "Check my interpretation", never "Verify" | §2.2 | `prepare/assisted.ts:33` | none | implemented-unguarded |
| CW-4 | Hypothesis, criteria, learned, trace edits, statuses, promotion are human-authored; AI text only in `aiSuggested`/`ai_inference` slot | §2.3, §13, §19 | `assisted.ts:366-385`; `lifecycle.ts:71-75` | `assisted.test.ts::routes each action to the only slot it may write`; `::turns an explanation into ai_inference evidence citing only sent paths…`; `lifecycle.test.ts::requires "learned" before close, keeps AI suggestions out of the human text` | guarded |
| CW-5 | Open hypothesis frozen when an implementation is attached; cannot be edited; new hypothesis appends | §2.4, §11 | `lifecycle.ts:128-140,197` | `lifecycle.test.ts::freezes the open hypothesis when an implementation is attached`; `implementation.test.ts::attaching a pasted diff freezes the open hypothesis…`; `ImplementationSection.test.tsx::…freezes the hypothesis` | guarded |
| CW-6 | Whole-file bodies cached in LOCAL-ONLY Dexie table never synced; cleared by `clearAllData()` | §2.5, §7.2, S1/S12; INV-15 | `db/schema.ts:175-180`; `db/index.ts:56-57,87-88`; `db/repoFiles.ts:1-3` | `localOnly.test.ts::is never referenced by the sync engine or serializer (audit S1 / S12)`; `::clearAllData empties both tables` | guarded |
| CW-7 | Synced workspace records carry only paths, shas, line ranges, capped quotes (≤500, scrubbed, hashed) | §2.5, §8, S1/S7 | `types/evidence.ts:25`; `repo/search.ts:230-231`; `lifecycle.ts:65-77` | `repo/search.test.ts::scrubs secrets, caps the quote, and hashes the stored text (S4)`; `lifecycle.test.ts::appends evidence and never exceeds the quote cap` | guarded |
| CW-8 | Cache filled through `fetchPolicy`; denied paths never cached; scrub applied on display/quote, not cached body | §7.2, S4 | `repo/index.ts:9,74-83`; `search.ts:230` | `repo/index.test.ts::drops sensitive and excluded paths before anything is fetched, then applies caps`; `::caches allowed files, never touches denied paths…` | guarded |
| CW-9 | Repository reads read-only; `compareCommits`/`getPullFiles` use the existing `request()` only | §2.5, §3, §11, S2 | `client.ts:15,225,525-527,572` | `client.test.ts::never issues anything but GET`; `::compares two refs through api.github.com only and maps files`; `::rejects traversal and junk refs before any request` | guarded |
| CW-10 | `detection/**` and `investigation/**` never import `prepare/**`, `github/**`, `repo/**` | §2.6, S10 | `boundary.test.ts:28-40` | `boundary.test.ts::lib/detection never imports…`; `::lib/investigation never imports…` | guarded |
| CW-11 | Guided mode makes zero provider calls | §2.7, §13, D5 | `prepare/guided.ts`; `repo/*.ts` (no providers import) | `guided.constraint.test.ts::Guided mode makes no provider call (law §2.7) > walks the whole loop touching only api.github.com` | guarded |
| CW-12 | Every Assisted prompt preceded by disclosure naming provider, sources, repository excerpts | §2.7, §13, S5 | `components/prepare/AssistedSection.tsx:145,258-261` | none (no `AssistedSection.test.tsx`; `assisted.test.ts` tests plan/prompt, not the modal gate) | implemented-unguarded |
| CW-13 | Assisted refuses to send when a secret would enter the prompt; rejects non-JSON | §2.7, S2/S4 | `assisted.ts:356,293-295` | `assisted.test.ts::refuses to send when a secret would be in the prompt (S2) and rejects non-JSON` | guarded |
| CW-14 | Injected instructions in cached repo content cannot set any status, edge, or promotion | §13, S3 | `assisted.ts:366-385` | `assisted.test.ts::injected instructions in a cached file cannot flip a verification row (S3)` | guarded |
| CW-15 | Per-action excerpt caps (≤12 files / 40 KB) with count shown in disclosure | S5 | `assisted.ts:101` (`capExcerpts`) | `assisted.test.ts::enforces the per-action file and byte caps (S5)`; `::builds one prompt per action with scrubbed, capped excerpts…` | guarded |
| CW-16 | Nothing enters Current Understanding without explicit per-item Promote; promoted objects `origin:'user'`, `accepted`, with `introduced` event + evidence | §2.8, §12 | `prepare/promote.ts:65-112` | `promote.test.ts::creates an accepted user object with EvidenceRefs and codeEvidence, and records the promotion`; `::refuses AI items, unverified edges, empty selections, and premature promotion` | guarded |
| CW-17 | Only mechanically-backed evidence and `verified` edges are promotable | §12, §2.8 | `promote.ts:32,82-97` | `promote.test.ts::offers only mechanical evidence and verified edges` | guarded |
| CW-18 | Edge verification never stored, always derived; `contradicted` only via a single human override with a note | §10, D4 | `prepare/trace.ts` | `trace.test.ts::it.each(…)`; `::honours the single human override and never an AI one`; `::updates nodes, requires a note for contradiction, and prunes dangling evidence` | guarded |
| CW-19 | Nested section timestamps are ISO strings; only top-level lifecycle timestamps are `Date` | §7.1, D11 | `serializer.ts` (`rehydratePreparedChange`) | `serializer.test.ts::round-trips a fully populated Change Workspace and keeps sections out of the cleartext envelope (S9)` | guarded |
| CW-20 | `prepared_change` cleartext envelope exactly `{kind, parentId, updatedAt}`; no new sync kinds | §7.3, S9 | `serializer.ts` | same as CW-19 | guarded |
| CW-21 | `validatePreparedChange` requires accepted understanding or non-empty `intent.desiredBehavior` | §7.1, D7 | `prepare/changes.ts` | `changes.test.ts::can start from a stated intent with no accepted understanding`; `::still refuses a workspace with neither understanding nor a stated desired behavior` | guarded |
| CW-22 | Lifecycle gates: `markVerified` only from `implementing` when every criterion has a row or note; `closeWorkspace` only from `verified` with `learned.text` | §7.1 | `lifecycle.ts:263-307` | `lifecycle.test.ts::blocks "supported" on AI-only evidence and gates markVerified on notes`; `::requires "learned" before close…`; `::refuses out-of-order transitions` | guarded |
| CW-23 | Section editability table is total; intent/criteria freeze at `ready`; evidence/trace/questions/hypotheses appendable until `closed` | §7.1, §6 | `prepare/editability.ts:29-79` | `editability.test.ts::covers every state × section with a defined value`; `::freezes intent and criteria at ready and never reopens them`; `TraceSection.test.tsx::is read-only once the workspace is closed` | guarded |
| CW-24 | Indexing caps: 2000 files, 50 MB, 200 KB/file; skipped files listed; rate limit stops after batch, resumable | §9, S1 | `repo/index.ts:15-17,66-83,126` | `repo/index.test.ts::…then applies caps`; `::stops on a rate limit after saving the batch, reporting when to retry`; `::records unreadable files as skipped…` | guarded |
| CW-25 | Search deterministic, LLM-free, 500-hit cap, linear-time regex guard, works offline | §9, §15.2, S8 | `repo/search.ts:13-19,55` | `search.test.ts::respects case sensitivity, path globs, and the hit cap`; `::rejects unsafe regex patterns (S8)`; `::scans a 10 KB adversarial file within the time budget`; `::matches whole identifiers only` | guarded |
| CW-26 | Implementation patches scrubbed and capped (20 KB/file, 200 KB/workspace) | §11, S4/S7 | `prepare/implementation.ts:13,42` | `implementation.test.ts::capPatches (S4, S7) > scrubs secrets, drops oversize patches, and enforces the total cap` | guarded |
| CW-27 | Chatdex never reads a local git; implementation attaches only from GitHub compare/PR, ingested session, or pasted diff with provenance | §11, D6 | `implementation.ts` (`sources`) | `implementation.test.ts::derives per-file stats from a Claude Code session and defaults provenance to ai`; `::wraps compare and PR reads…` | guarded |
| CW-28 | Verification hints suggest, never set; a row whose only evidence is `ai_inference` cannot be `supported` | §12 | `prepare/verification.ts:41-51`; `lifecycle.ts:250-252` | `verification.test.ts::deriveVerificationHint > it.each(…)`; `::tracks criteria, blocks AI-only support, and lists blocking criteria until noted` | guarded |
| CW-29 | Questions are `UnderstandingObject{type:'question', origin:'user', accepted}`; "Start a workspace from this question" sets `originRef` | §12, D8 | `promote.ts:138-147`; `prepare/fromWorkspace.ts` | `promote.test.ts::still allows promotion after close, and questions link both ways`; `lifecycle.test.ts::records mode changes and question links` | guarded |
| CW-30 | Blob/compare/PR URLs only by validated builders; labels, quotes, patches render as text nodes | S6 | `client.ts:449-459,590-598`; `components/prepare/*.tsx` | `client.test.ts::builds compare / pull links only from validated parts`; `TraceSection.test.tsx::adds nodes…` — no test asserts a `<script>` node label renders escaped, contra §16 CW-2 | implemented-unguarded (escaping) |
| CW-31 | Local-directory source: permission gate, same denylist, size caps, `sha='local'`, handle keys device-local; Forget evicts cache | §9, §2.5, S11 | `repo/localDirSource.ts:12-18`; `repo/localDir.ts:11-12`; `engine.ts:84-85` | `localDirSource.test.ts::lists allowed files only…`; `::refuses oversized folders (S11)`; `::remembers the handle device-locally and forgetting evicts the cache`; `::keeps the handle keys out of sync` — this last only greps `engine.ts` source text for `/repo\./` | guarded (weak: source-text assertion) |
| CW-32 | Inspection log local-only, per-project clearable, no server path, never sent to a provider | §7.2, S12, D9 | `db/inspections.ts:66`; `schema.ts:180` | `localOnly.test.ts::is never referenced by the sync engine or serializer`; `::records inspections and summarizes them per target` — no test asserts inspections never enter a prompt | guarded (sync); implemented-unguarded (provider) |
| CW-33 | Workspace caps: 200 evidence items, 100 trace nodes, AI text ≤2000 chars | S7, §8 | `types/evidence.ts:23,25`; `lifecycle.ts:31,72,92,149` | none | implemented-unguarded |
| CW-34 | Trace edges reference existing nodes and evidence; dangling pruned; `???` unknown nodes first-class | §10 | `lifecycle.ts:150-162`; `prepare/trace.ts` | `lifecycle.test.ts::validates trace references against nodes and evidence`; `trace.test.ts::supports branches and unknown nodes, and removes subtrees`; `::reconcileEdges drops edges whose endpoints vanished` | guarded |
| CW-35 | Guided action menu is exactly the deterministic set; no proactive root cause or implementation | §13, D5 | `GuidedActionMenu.tsx`; `guided.ts` | `guided.constraint.test.ts` (network law only, not menu contents) | guarded (network law only) |
| CW-36 | Related-conversation search touches only the project's associated conversations | §13 | `guided.ts` (`findRelatedConversations`) | `guided.test.ts::searches only associated conversations, counts hits, and deep-links the first message` | guarded |
| CW-37 | Out of scope: running tests/apps, agentic mode, AI diff review, comprehension scores, code-search API, OAuth, PR creation, syncing inspections | §5.2, §20 | absent | none | policy |
| CW-38 | `crypto/`, `detection/`, `investigation/` not modified; prepare reads their types/db only | §0, §2.6 | `boundary.test.ts:28-40` | `boundary.test.ts` | guarded |
| CW-39 | Ownership never measured by manual LOC %, prompt count, generated volume, agent use, or AI-vs-human score | PRD §3; SPEC §1, §5.2 | no such metric in `src/lib/prepare/**` | none | policy |
| CW-40 | Desired behavior distinguished from implementation assumptions; a hypothesis never silently becomes a requirement | PRD §5.2 | `criteria`/`hypotheses` separate fields; criteria freeze at `ready` | none | policy (structural) |
| CW-41 | Implementation provenance never equated with correctness or ownership | PRD §13 | `provenance` never an input to `deriveEdgeVerification`/`deriveVerificationHint` | none | policy |
| CW-42 | Chatdex integrates with existing coding environments rather than requiring implementation inside it | PRD §25; SPEC §1, D6 | attach-only paths (`implementation.ts`) | `implementation.test.ts::sources` | policy |

### Branch Binding (BB) — shipped cross-cutting fix

Owner: `docs/changes/branch-binding/PLAN.md` (status: Implemented, acceptance pending). All rules are mirrored in consumer code; Intent Trace §6/§8.3 and Change Workspace S2 accommodate refs without amendment. The Decision Recovery snapshot-resolution ladder (BB-6) is covered by DR-40 above.

| ID | Guarantee | Owner § | Enforcing code | Guard test | Status |
|---|---|---|---|---|---|
| BB-1 | A pasted branch URL's ref is never silently dropped; `parseRepoInput` returns `ref` + longest-first `refCandidates[]`, all passing `assertRef` | §4 step 1a | `client.ts:119-127` | `client.test.ts::parseRepoInput > keeps the branch from a /tree/ URL, longest candidate first`; `::reads refs out of blob, commit, pull, tag and @ref inputs`; `::names no ref for refless paths…` | guarded |
| BB-2 | `listCommits` accepts a ref without weakening the sha check | §4 step 1b | `client.ts:402-403` | `client.test.ts::listCommits > sends a branch as the sha query parameter but keeps assertSha strict for sha` | guarded |
| BB-3 | Save disabled until the ref resolves or is cleared; unresolvable ref persists nothing | §4 step 3.2 | `RepoBindingCard.tsx` | `RepoBindingCard.test.tsx::refuses to save a ref that does not resolve`; `::falls back through slashed-ref candidates…` | guarded |
| BB-4 | Binding card stays reachable after binding, on Intent Trace and Decisions tabs | §4 steps 3.5, 4 | `IntentTracePage.tsx`; `DecisionsPage.tsx` | `IntentTracePage.test.tsx::keeps the binding card reachable once a repository is bound`; `DecisionsPage.test.tsx::keeps the binding card reachable when bound…`; `RepoBindingCard.test.tsx::collapses to a summary when bound…` | guarded |
| BB-5 | Tracing honours the chosen branch: `config.ref ?? pinnedRef ?? defaultBranch` → resolved sha | §2, §6 | `runTrace.ts:148-151` | `runTrace.test.ts::traces against the branch the binding pins, and config.ref still overrides it` | guarded |
| BB-6 | Decision Recovery never substitutes another branch's cache for the bound ref | §4 step 5, D4 | `runRecovery.ts:131-160` | see DR-40 | guarded |
| BB-7 | Explicit `config.sha` wins with zero network; `fs:` repoKey makes zero GitHub calls | §4 step 5 | `runRecovery.ts:133,163-166` | `runRecovery.test.ts::makes no GitHub call when the sha is given, or when the snapshot is a local directory` | guarded |
| BB-8 | Guided "commits touching path" passes the chosen ref | §4 step 2 | `guided.ts:78-82` | `guided.constraint.test.ts` — the plan's §6 called for a `pinnedRef:'feature/x'` case asserting `sha=feature%2Fx`; not present | implemented-unguarded |
| BB-9 | Staleness hint compares against the ref the last trace used; states when binding switched refs | §4 step 4 | `IntentTracePage.tsx:99-112` | `IntentTracePage.test.tsx::reports staleness against the pinned ref, not only the default branch`; `::says the binding switched refs when the last trace ran on another one` | guarded |
| BB-10 | No `listBranches` helper, no `/branches` endpoint (D1) | D1 | absent | `client.test.ts::never issues anything but GET` (verb only) | policy |
| BB-11 | Every GitHub request goes through the single `request()` helper | §5, §6 | `client.ts:214-225` (only `fetch(` site) | `client.test.ts::hits the constant API host…`; `RepoBindingCard.test.tsx::prefills the branch from a pasted /tree/ URL, resolves it, and saves it as the tracked ref` (asserts every URL starts with api.github.com) | guarded |
| BB-12 | Persisted field stays `pinnedRef` (D2); no rename, no fallback in readers | D2 | `runTrace.ts:148`; `EvidenceSection.tsx:96`; `guided.ts:81`; `runRecovery.ts:135` | `RepoBindingCard.test.tsx::round-trips a saved ref back into the field` | guarded |
| BB-13 | No Dexie migration needed — `ProjectRepository` lives unindexed inside `understandingProjects` | §2 | `schema.ts:96` | `serializer.test.ts::round-trips a project with a repository binding and both cursors` | guarded |


---

## Tier 3 — Proposed contracts (not shipped; never counted as unguarded)

Every row here is `proposed`. The "Relation" column says which shipped rule it extends, scopes, restates, or conflicts with.

### Flow Map (draft spec, no code)
| # | Guarantee | Owner | Relation to shipped rules |
|---|---|---|---|
| FM-1 | Every surface and link carries `repoKey`, `sha`, `path`, 1-based line; a surface without a line is a recognizer bug | flow-map/SPEC §2.1 | Extends Change Workspace §2 provenance |
| FM-2 | A link is `declared` only when syntactically explicit on its evidence line; all cross-file name-matching is `heuristic` | §2.2, §8 | New; mirrors INV explainability |
| FM-3 | Exporting to a Change Workspace trace attaches edge evidence only for declared links; heuristic links export with no evidence; `trace.ts` unmodified | §2.2, §12, D4 | Scopes Change Workspace trace contract |
| FM-4 | AI output is naming/grouping only, landing as `suggestedName`/`suggestedGroup` with `ai_inference` provenance — never a surface, link, or confidence upgrade | §2.2, §13, D9 | Extends inv 6 |
| FM-5 | Names, notes, pins, "kept" are human-authored; AI drafts in a separate suggested slot; accepting records `origin: 'ai'` | §2.3, §7.3 | Extends UW provenance |
| FM-6 | Generation is a pure function of (cached rows, recognizer profile+versions, config); ids are content hashes, never random | §2.4, §7.1, D6 | New determinism law |
| FM-7 | Derived map is LOCAL-ONLY (Dexie table never hooked into sync, cleared with repo cache) | §2.5, §7.2, S1, D1 | Extends CW §2.5 / inv 6 |
| FM-8 | Only human-kept flows sync, as ordinary UnderstandingObjects with paths/shas/lines/capped quotes (≤200 chars/step, ≤30 steps); no new sync kind | §2.5, §7.3, S7, D2 | Scopes inv 1 |
| FM-9 | `detection/**` and `investigation/**` never import `flowmap/**`; `flowmap/**` never imports `providers/**` | §2.6, S10 | Extends shipped import-guard boundary |
| FM-10 | Generation and every Guided action make ZERO network calls incl. GitHub; constraint test stubs fetch to throw | §2.5, §13, S2, D5 | Stricter than CW Guided mode |
| FM-11 | Assisted naming reuses DisclosureModal + fetchPolicy; prompt names provider, repo, flow count, excerpt bytes, and states no conversation content is included | §2.7, §13, §18 | Applies inv 6 disclosure |
| FM-12 | Every map reports fog (what it did not understand) as a first-class panel | §2.8, §11.4, D8 | Sibling of inv 4 |
| FM-13 | Hitting any cap sets `truncated` or adds a fog item; never silently drops | §7.1, §9.4 | Matches no-magic-numbers rule |
| FM-14 | Recognizers pluggable + versioned via registry; version bumps on any behavior change | §9.1, §9.3 | Copies inv 5 + inv 3 |
| FM-15 | Never broaden a recognizer without adding the false-positive fixture it must still reject | §0, FM-1 | Restates CLAUDE.md don't-list bullet 4 |
| FM-16 | AI naming passes a parse firewall (≤80 chars, markup stripped, unknown flowIds dropped, text nodes); injected instruction in source changes no surface/link/confidence | §13, S3, FM-5 | Extends judge.ts injection posture |
| FM-17 | `scrubSecrets` on every quote at keep-time and prompt-time; denylisted files never become surfaces | S4 | Reuses Repo Integration scrubbing |
| FM-18 | Regeneration never mutates a kept flow; kept flows re-check `quoteHash` per step | §11.2 | Analogue of inv 3 |
| FM-19 | Blob URLs only via validated builders; `fs:` paths never rendered as links | §11.1, S6, S12 | Reuses link-integrity rules |
| FM-20 | "Discussed in" is deterministic lookup; Flow Map never creates evidence on its own | §11.3 | Scopes CW evidence authorship |
| FM-21 | Deferred follow-ons may not weaken §2 laws | §20 | Self-binding |

### Decision Authoring & Evidence (proposed)
| # | Guarantee | Owner | Relation |
|---|---|---|---|
| DA-1 | Decision Recovery stays owner of AI extraction and immutable traces; quote firewall, basis derivation, pending-output rules not weakened | dae/SPEC §1, §5, §6 | Preserves DR §2.1, §2.3, §7, §10–12 |
| DA-2 | Decision identity stays `UnderstandingObject{type: decision}`; revisions key off it; no second identity | §1, §2 | Extends UW §7–11 |
| DA-3 | Manual/code-only decisions use an authoring path — never fabricated recovery traces or transcript evidence | §1, §5 | Scopes DR §2.1 transcript requirement |
| DA-4 | Existing DecisionTrace rows remain immutable | §1 | Restates DR |
| DA-5 | Never overwrite derived `madeBy`/`basis` with a human authorship claim | §2 | Extends DR derivation |
| DA-6 | Interpretation kind is not a confidence level; user position/coverage/follow-up independent of review status | §2 | New |
| DA-7 | Every revision preserves AI/user/pasted-unknown origin per contribution; adoption never relabels generated text as user-authored | §2 | Extends inv 6 |
| DA-8 | AI suggestions stay pending; cannot silently become current accepted revision | §2 | Restates DR pending law |
| DA-9 | Explicit branch = competing revision; no auto-synthesis erases dissent; old evidence links stay in old revisions | §2 | New append-only |
| DA-10 | Legacy decisions get idempotent "legacy snapshot" baseline with unknown provenance; never invent actor or acceptance time | §2 | New |
| DA-11 | Quote membership validated via existing mechanisms; invalid quotes can't be saved as verified spans; integrity ≠ semantic support | §3 | Reuses CW/IT quote-hash |
| DA-12 | A local snapshot marker is not a commit SHA | §3 | Extends Repo Integration |
| DA-13 | Grounded AI suggestion must include valid source refs; speculation appears as question/hypothesis; code proves neither rationale nor actor | §3 | Extends inv 6 |
| DA-14 | `searched-no-support` requires a SearchCoverage record; "undocumented" badge never sets `unsupportedAutonomous` or `madeBy` | §3 | Guards vs reusing DI labels |
| DA-15 | Later doc support requires locator to observed new revision; no automatic spec writes | §3, §6 | New |
| DA-16 | Project ID must match every loaded referenced object | §4 | Restates project isolation |
| DA-17 | Selecting sources / opening workspace / manual edits make no provider calls | §4 | Extends inv 6 |
| DA-18 | Disclosure shows provider + actual selected sources incl. repo excerpts and cross-provider; expanded scope needs new disclosure; no auto full-repo send | §4 | Applies inv 6 + IT §13 |
| DA-19 | Preview and chat render same response ID; Continue in chat = no new call; retry never overwrites first response | §4 | New |
| DA-20 | No claim to reveal hidden model reasoning | §4 | New |
| DA-21 | Reuse opt-in credentials and transit-only relay; no new logging backend | §4 | Restates inv 6 |
| DA-22 | Whole repo files stay local-only; synced excerpts obey caps; chat records follow ciphertext-sync rules | §5 | Restates inv 1 + CW §2.5 |
| DA-23 | New sync kinds only with matched client+backend support; backend first; feature-gate writes until then | §5 | Extends sync deploy discipline |
| DA-24 | Current-revision pointer conflicts surfaced for human selection, never LWW-flattened | §5 | New |
| DA-25 | DI tables/modules never consume recovery/authoring AI output; no renames, no widened AI boundary | §5 | Restates DI quarantine |
| DA-26 | No crypto primitive changes | §5 | Restates CLAUDE.md |
| DA-27 | Story collection copies selected revisions privately; not publication | §5 | Scopes Share Build Story |
| DA-28 | Excluded: auto actor attribution, forced resolution, importance ranking, repo writes, auto spec/code edits, agent execution | §6 | Consistent with no-repo-writes |

### Experiment Lab (proposed)
| # | Guarantee | Owner | Relation |
|---|---|---|---|
| EL-1 | Prepare Change keeps its route and lifecycle; lab links but never shortcuts | el/SPEC §1 | Preserves CW §6–7, §12, §14 |
| EL-2 | CatalogTemplate is bundled immutable source; editing ideas never mutates templates | §2 | New |
| EL-3 | Template population is explicit + idempotent per project/template; never silently populates other projects | §2 | New |
| EL-4 | Adapting an idea to another project creates new identity with inspired-by link; never copies private attempts | §2 | New |
| EL-5 | IDs independent of catalog numbers; preserve original wording/categories/tiers; no silent duplicate merges | PRD; EL-0 | New |
| EL-6 | NextMove origin user/AI/pasted-unknown; pasted never auto-labeled; store original suggestion + edits | §2 | Same as DA-7 |
| EL-7 | AI estimate is a suggestion, not a measured duration; tier estimate is separate field | §2 | New |
| EL-8 | Linked change has own status, never inferred from idea label; no 1–10 score or % completion | §3 | New |
| EL-9 | Attempt starting snapshots frozen; revisions append; parent changes can't rewrite starting conditions | §3 | Analogue of inv 3 |
| EL-10 | Idea state never auto-overwritten when one attempt changes; summary + event commit atomically | §3 | New |
| EL-11 | Observations carry human-observed/simulated/imported basis; none = verified; local trees aren't snapshots | §4 | Extends Repo Integration |
| EL-12 | Safe text rendering; http/https links only; no preview fetches; no artifact execution or binary uploads | §4, §7 | Extends XSS posture |
| EL-13 | No provider request on browse/select/edit/paste/state change; only explicit Suggest/Estimate under existing disclosure | §4, §7 | Applies inv 6 |
| EL-14 | Suggestions retain provider/model/context/time; accept ≠ generate; provider failure leaves manual entry usable | §4 | Extends inv 6 |
| EL-15 | Suggested tradeoffs never presented as established observations | §4 | New |
| EL-16 | Selecting a next move never auto-creates an attempt or Change Workspace; no auto Current Understanding promotion | §5 | Preserves UW §9, §11, §15 |
| EL-17 | Promotion stores draft+promotion+event atomically with unique attempt constraint; missing target shown honestly | §5 | New |
| EL-18 | Copy compatible evidence; never fabricate transcript references for lab events | §5 | Same as DA-3 |
| EL-19 | Idea-to-change links may attach existing change without pretending attempt origin | §5 | New |
| EL-20 | v1 persistence device-local (versioned JSON + Markdown export), labeled "Saved on this device"; no new sync kinds | §6 | Scopes inv 1 |
| EL-21 | No plaintext private experiment records to sync backend; later sync needs separate plan | §6 | Restates inv 1 |
| EL-22 | Dependent local records included in project erase/reset; archiving ≠ erasure | §6 | Extends clearAllData |
| EL-23 | Catalog + manual ops work offline; browsing never calls providers or runs repo work | §6, §7 | New |
| EL-24 | Excluded: worktree creation, auto spec edits, recommendation learning, timers, auto activity capture, agent orchestration, repo writes, collaborative editing, arbitrary attachments | §7 | Consistent |
| EL-25 | No changes to DI tables or AI quarantine | PLAN | Restates DI quarantine |

### Share Build Story (proposed)
| # | Guarantee | Owner | Relation |
|---|---|---|---|
| SB-1 | Public publication needs a DISTINCT owner API, public-read API, storage model; never public plaintext in private sync envelopes; never persist provider requests in relay | sbs/SPEC §1 | **Scopes inv 1 + inv 6 by adding a deliberate plaintext-at-rest server path outside them** |
| SB-2 | Public readers get only a self-contained approved snapshot; never call authenticated APIs or resolve private IDs | §1, §6 | New |
| SB-3 | Snapshot compiler uses a FIELD ALLOWLIST; never serialize-then-strip; snapshot blocks get fresh public IDs | §2 | New — the load-bearing leak rule |
| SB-4 | Raw excerpts, redaction maps, internal paths/IDs, project membership, hidden metadata, source URLs excluded unless explicitly selected+reviewed; a hash alone is not sanitization | §2 | New |
| SB-5 | StoryMetric carries no reader identity (no user/session IDs, IPs, UA, referrers, free text); no cookies/fingerprinting/journey reconstruction | §2, §5 | New; conflicts with chatdex-prd "no tracking" |
| SB-6 | Upstream revision changes mark collected material stale + offer comparison; never automatic published replacement | §2 | Extends DR §10 |
| SB-7 | Narrative annotations separate from source corrections; prose edits never mutate traces/decisions | §2 | Preserves DR §10 |
| SB-8 | AI must not invent motivation, attribution, outcomes, certainty, links, events; suggestions separate until accepted; no request on open | §3 | Extends inv 6 |
| SB-9 | Change after approval invalidates approval; publish only exact reviewed content hash/version | §3 | New |
| SB-10 | Server validates allowlisted schema but never claims to have verified truth or privacy | §3 | New |
| SB-11 | Redaction preserves meaning or marks excerpt incomplete; never claims source proves what it no longer supports | PRD | New |
| SB-12 | No active HTML/scripts/remote embeds/binary uploads in v1; inert rendering; no auto external fetches | §3, §4 | Extends XSS posture |
| SB-13 | Public repo links explicitly reviewed (filenames/URLs can disclose) | §3 | New |
| SB-14 | Publish is authenticated, submits reviewed snapshot + idempotency key + expected revision; CAS updates | §4 | New |
| SB-15 | Unlisted = high-entropy token + noindex; UI must say this is NOT access control | §4 | New |
| SB-16 | Owner-only update/unpublish/analytics with server ownership checks independent of client IDs | §4 | Extends backend auth |
| SB-17 | Prior versions owner-only, not publicly addressable by guessed IDs; draft save never changes published content | §4 | New |
| SB-18 | Unpublish disables all public endpoints (neutral unavailable); `no-store`; downloads can't be revoked and this is stated | §4 | New |
| SB-19 | Permanent deletion removes served content AND aggregates | §4, §5 | Extends delete-all posture |
| SB-20 | Exports omit analytics code, private locators, redaction originals, hidden metadata | §4 | New |
| SB-21 | No provider credentials or private plaintext in publication payloads unless that exact excerpt is expressly reviewed | §6 | Scopes inv 6 — the only sanctioned private→public route |
| SB-22 | Analytics events validated against served revision/allowed blocks, bounded; content/tokens excluded; abuse controls never become profiling | §5 | New |
| SB-23 | Counts labeled as events not visitors; empty ≠ no readers; analytics failure never blocks reading; no third-party SDK | §5 | New |
| SB-24 | Preview/owner mode emits no public reader events | §5 | New |
| SB-25 | Retention: daily aggregates deleted after 90 days (unratified default) | §5 | New |
| SB-26 | Draft storage local-first; only approved snapshots reach public server; encrypted draft sync deferred | §6 | Scopes inv 1 |
| SB-27 | Publish/unpublish never claims success before server confirms; network errors leave state "unknown until reconciled" | §6 | New |
| SB-28 | No assumed publication service; never call private sync or AI relay a publishing backend | PLAN | Guards inv 1 / inv 6 |
| SB-29 | Progressive disclosure stops at the approved boundary; never reveals full private conversation or repo | PRD | New |

### Activity Tracker (Chrome extension PRD; partial code present)
Code presence: YES but half-dead. Built artifacts (no source) committed at `dist-extension/` (manifest.json MV3 "Claude Utils Companion" v1.0.0, background.js, content-script.js, injected.js, webapp-sync.js), last touched `ce61d25` 2026-02-14. Web-app side live: `src/types/activity.ts`, `src/lib/db/activities.ts`, `activities` Dexie table (`schema.ts:78`), timeline/analytics components; `'activity'` is a valid ciphertext sync kind (`backend/src/routes/sync.ts:10`). BROKEN: `dist-extension/background.js` POSTs plaintext activity (incl. `metadata.fullContent`, `userMessage`) to `http://localhost:3003/api/activities` — route does not exist (index.ts registers only auth/sync/llm). Dead path, nothing leaks today, but the artifact encodes a plaintext-to-backend path inv 1 forbids.
| # | Guarantee | Owner | Relation |
|---|---|---|---|
| AT-1 | Activity data stored locally in extension; cloud sync future/optional | PRD Storage | Weaker than inv 1; shipped app already syncs `activity` as ciphertext, so inv 1 governs |
| AT-2 | Permissions limited to webRequest/storage/tabs + claude.ai/* hosts | PRD Permissions | Shipped manifest: only storage+tabs, but adds localhost:3003/4000 hosts |
| AT-3 | Data retention is a user setting | PRD Storage | New |
| AT-4 | Claude Code capture requires a native messaging host | PRD Data Capture | New |
| AT-5 | Export: timeline JSON, per-conversation, CSV; one-time historical import | PRD Export | Aligns with chatdex-prd D12/D13 |
| AT-6 | Capture success >99%; UI <100ms | PRD Metrics | Quality bar |
| AT-7 | UNRESOLVED: "How do we handle privacy concerns with storing conversation data locally?" is an open question — no privacy contract exists despite capturing full message content | PRD Open Q #3 | Gap |

### Product PRDs (docs/prds/)
| # | Guarantee | Owner | Relation |
|---|---|---|---|
| P-1 | Product runs entirely client-side — no server, no data collection; data never leaves the browser | chatdex-prd Exec Summary, Core Principles §1 | **SUPERSEDED** by inv 6 (2026-08-09) and shipped backend; only inv 2 (detection) still has this shape |
| P-2 | All processing in-browser: no server, no tracking, no data collection | chatdex-prd Core Principles §1 | Conflicts with SB-5/SB-22 and shipped relay |
| P-3 | Users must get export/backup for local DB | chatdex-prd Risk 4; D12/D13 | Extends export posture |
| P-4 | Clear-all-data and clear-by-source provided | chatdex-prd Feature 6 (D9, D10) | Implemented in `src/lib/db/index.ts` |
| P-5 | Postgres-tier users must be able to trust operators cannot read their data, even in principle; user-verifiable | PRD-patternmirror §6.1 | Goal behind inv 1 |
| P-6 | Encrypted in browser before Postgres; key never leaves device unencrypted, never persisted unencrypted | patternmirror §6.2 | Restates inv 1 |
| P-7 | Key derivation via Argon2id/scrypt from passphrase with per-user salt | patternmirror §6.2 | **CONFLICT** — KDF removed on main for WebAuthn; CLAUDE.md forbids reintroduction without spec change |
| P-8 | AES-GCM-256, unique IV per record, authenticated | patternmirror §6.2 | Matches `src/lib/crypto/primitives.ts` |
| P-9 | Encrypted: message contents, summaries, tags, notes, annotations. Not: IDs, timestamps, index metadata, schema version, blob length | patternmirror §6.2 | Matches S9 envelope contract |
| P-10 | Search client-side after decryption; local index encrypted at rest; searchable encryption out of scope | patternmirror §6.3 | Consistent with inv 1 |
| P-11 | Chatdex stores neither passphrase nor recovery key; first-run states lost credentials = unrecoverable | patternmirror §6.4 | Restates recovery posture |
| P-12 | Server-side audit logs must not contain decryptable data | patternmirror §6.6 | Extends inv 6 relay rule |
| P-13 | Privacy policy: no selling, no ads, no third-party sharing, no model training on user data | patternmirror §7 | Product promise; no enforcement |
| P-14 | Extraction cached forever; never re-processes unless schema version changes | patternmirror §5.2 | Analogue of inv 3 |
| P-15 | No model calls at query time; rendering pass only on user open, cached | patternmirror §5.3, §3 | Scopes inv 6 |
| P-16 | Chatdex fully usable without ever contributing | research-contribution Purpose, §4 | New |
| P-17 | Marking for contribution is a second deliberate action distinct from tagging | research-contribution §5.1 | Extends inv 6 opt-in |
| P-18 | Nothing leaves device until explicit per-item "Confirm and upload"; no background/batch/blanket consent; preview exact JSON | research-contribution §5.3 | Strongest opt-in rule in corpus |
| P-19 | PII redaction conservative by default, transparent, never fully automated; over-redact then un-redact | research-contribution §6 | New |
| P-20 | Never contributed: auth tokens, API keys, passwords, credential patterns; "private" conversations; account/internal IDs | research-contribution §6.3 | Extends scrubSecrets posture |
| P-21 | Contributions are explicitly OUTSIDE the encryption boundary and the ONLY path data leaves it | research-contribution §9.2 | Scopes inv 1; predates inv 6 and SBS, which each add another exception |
| P-22 | Contribution backend stores no user identifiers; random ID + rotated install ID; operators can't link — enforced architecturally | research-contribution §9.3 | Analogue of SB-5 |
| P-23 | Contribution DB is a separate service from user-storage Postgres | research-contribution §9.1 | Same separation as SB-1 |
| P-24 | Retraction end-to-end; consent flow states downloaded data can't be retrieved | research-contribution §8 | Same honest-limits shape as SB-18 |
| P-25 | Dataset releases versioned + immutable; first release at ≥500 contributions | research-contribution §7.4 | Analogue of inv 3 |
| P-26 | 24-hour delay between approval and upload | research-contribution Risk mitigation | New |
| P-27 | AIPKMS local-first, no mandatory server; cloud sync optional+encrypted (future) | prd-aipkms §3.2 | Internally inconsistent: doc's own AT section says shared store is Postgres |
| P-28 | No remote code execution; Chrome Web Store policy compliance | prd-aipkms §7 | New |
| P-29 | Haiku for classification, Sonnet for synthesis; BYOK or included in premium tier | prd-aipkms §3.3 | BYOK matches inv 6; "included in premium tier" does not |

### CONFLICTS (Tier 3 vs shipped)
1. **Password KDF**: PRD-patternmirror §6.2 mandates Argon2id/scrypt passphrase KDF + passphrase recovery. CLAUDE.md: KDF removed on main for WebAuthn, forbidden to reintroduce without spec change. Direct contradiction; PRD predates migration, unreconciled.
2. **"No server, no tracking, no data collection"**: chatdex-prd Exec Summary / Core Principles §1 contradicted by inv 6 (explicitly supersedes), shipped Fastify backend + encrypted sync (inv 1), and SBS §5 StoryMetric reader counters.
3. **Plaintext-at-rest server storage**: SBS §1, §2, §6 requires public snapshot tables holding plaintext narrative + reviewed excerpts. Does not violate inv 1's letter (forbids sync envelope, requires distinct API/table) but creates the first sanctioned plaintext-at-rest server path. Needs explicit inv 1 amendment before SB-3 lands; PLAN schedules it.
4. **PatternMirror automatic extraction**: §5.2 "triggered when a conversation is first added… calls the Claude API once per conversation" — automatic, non-user-initiated send. Violates inv 6 bullet 1. Every current change package (EL-13, DA-17, FM-10) upholds inv 6; this PRD does not.
5. **AIPKMS automatic provider calls + Postgres plaintext**: prd-aipkms §3.3 auto-categorization per anchor event / topic detection per new conversation — same inv 6 conflict. §"How AIPKMS relates to Activity Tracker" says conversations+messages shared in Postgres — reads as plaintext server-side, conflicts with inv 1 and its own §3.2.
6. **PatternMirror acknowledged unencrypted Postgres tier**: §6 "current Postgres tier stores conversation data in a form operators can technically access", §6.5 plans 3–6 month transition. Under inv 1 that state is a bug, not a migration window. Historical.
7. **Activity Tracker local-only claim vs shipped**: PRD says extension-local with sync future; privacy is open question #3; but `dist-extension/background.js` POSTs full plaintext to a nonexistent `/api/activities`; `'activity'` is a live ciphertext sync kind. Dead path today.
8. **Non-conflicts**: Flow Map uniformly stricter (FM-10 zero network > CW Guided). EL and DA restate rather than relax inv 1, inv 6, DI quarantine. No proposed rule in the four change packages contradicts a shipped invariant.

### LIMITS (Tier 3 agent)
- No enforcing code/tests verified (none shipped by construction) except Activity Tracker code-presence.
- Flow Map §3 says "Dexie at v12" while §7.2/§17 target v14; `src/lib/db/schema.ts` is at v13, so v14 is correct next and §3 is stale.
- No extension source tree — only dist-extension build output. Can't tell abandoned vs unbuilt.
- `docs/capabilities/activity-tracker/IMPLEMENTATION-GUIDE.md` (32 KB) NOT read.
- chatdex-prd.md read selectively after normative grep; remaining ~1200 lines are feature specs/pricing/roadmap/mockups.
- Cannot tell whether conflicts are known-and-accepted or unreconciled — docs/prds/ carries no superseded status headers.


---

## Cross-check: orphan rules and undocumented guarantees

### Orphan rules (ORPH) — stated in `docs/territories/*` but owned by no spec, CLAUDE.md, or architecture doc

| ID | Guarantee | Stated in | Enforcing code | Guard test | Status |
|---|---|---|---|---|---|
| ORPH-1 | The detection Web Worker computes only, never writes; the main thread persists so Dexie sync hooks fire | `territories/detect-agent-failures.md:56` | `detection/workerHandler.ts:5-7`; `workerClient.ts:51-52` | `pipeline.test.ts::worker handler — message protocol > emits progress stages then a result` (asserts zero rows written) | guarded |
| ORPH-2 | Step index is 1:1 with non-system JSONL entries — the convention golden-trace step ranges depend on | `detect-agent-failures.md:114` | `detection/normalize.ts:5-9` | `normalize.test.ts::preserves the 1:1 step-index convention on mixed-session`; `::skips system messages without disturbing indices` | guarded |
| ORPH-3 | `CLASSIFIER_VERSION` versions the tool-class mapping | `detect-agent-failures.md:99` | `classify.ts:6` — declared, referenced nowhere else | none | not-found-in-code |
| ORPH-4 | A detection / derivation failure can never fail an import | `import-a-conversation.md:138` | `autoAnalyze.ts:47-56`; `import.ts:50-65` | none | implemented-unguarded |
| ORPH-5 | One `StoredConversation` per Claude Code JSONL file; a subagent transcript never collides with or replaces its parent | `import-a-conversation.md:135` | `parsers/claude-code.ts:80-86` | `claude-code.sidechain.test.ts::gives a subagent transcript its own conversation id, links the parent, and marks messages delegated` | guarded |
| ORPH-6 | `conversationsAdded + conversationsSkipped === parsed.conversations.length` | `import-a-conversation.md:137` | `import.ts:113,135-136` | none | implemented-unguarded |
| ORPH-7 | The subscription bridge must strip provider API keys from the subprocess env (a key in env silently switches billing to pay-per-token) | `relay-llm-calls.md:53-54` | `backend/src/llm/subscription.ts:44-47,99-106` | `backend/src/llm/subscription.test.ts::strips ANTHROPIC_API_KEY from the Claude subprocess env and keeps everything else`; `::strips OPENAI_API_KEY and CODEX_API_KEY from the Codex env and keeps everything else` | guarded (2026-09-09) |
| ORPH-8 | Relay request caps: 1–500 messages, `maxTokens` ≤64000, `temperature` 0–2 | `relay-llm-calls.md:35` | `backend/src/routes/llm.ts:33-35` | `backend/src/routes/llm.test.ts::POST /api/llm/complete > enforces the request caps with a content-free 400`; `> accepts exactly the documented limits` | guarded (2026-09-09) |
| ORPH-9 | Only accepted understanding reaches the chat system prompt; pending withheld | `synthesize-understanding.md:102,161-163` | `chat/context.ts:81-84` | `chat/context.test.ts::injects accepted objects and excludes pending ones` | guarded |
| ORPH-10 | Native-chat messages carry strictly increasing `createdAt` per conversation | `search-and-browse.md:127`; `README.md:41` | `chat/chats.ts:143-149` | none (only indirect ordering in `chats.test.ts`) | implemented-unguarded |
| ORPH-11 | Understanding objects/events survive conversation deletion | `sync-encrypted-state.md:71,139`; `synthesize-understanding.md:135` | `sync/engine.ts:112-114`; `db/conversations.ts:40-58` | `db/understanding.test.ts::deleting a conversation deletes its associations only` | guarded |
| ORPH-12 | `entityTags` uniqueness backs `tagEntity` idempotence; `usageCount` mutated only inside those transactions | `search-and-browse.md:128` | `db/tags.ts:49-62,71-80` | `db/index.test.ts::tagging an entity is idempotent and bumps usageCount once`; `::untag decrements usageCount and removes link` | guarded |
| ORPH-13 | Conversation deletion cleans up dependents | `search-and-browse.md:129` (stated there as violated) | `src/lib/db/conversations.ts` + `src/lib/sync/engine.ts` via `removeEntityTagsFor` (`src/lib/db/tags.ts`) | `src/lib/db/index.test.ts::conversations > cascades delete to tag links and gives usage counts back`; `src/lib/sync/engine.test.ts::conversation deletion from the server > cascades to tag links and gives usage counts back (mirrors deleteConversation)` | guarded (drift fixed 2026-09-09, `9b59690`) |
| ORPH-14 | The living document is a pure deterministic projection — no LLM, never stored, clock injected | `synthesize-understanding.md:104` | `understanding/livingDocument.ts` | `livingDocument.test.ts::is deterministic and only stamps a date when given one` | guarded |
| ORPH-15 | The vault gates only sync — import, search, detection, understanding, chat all work locked, offline, accountless | `README.md:21`; `unlock-the-vault.md:39,200-202` ("No doc states this threat model explicitly") | absence-enforced: `src/App.tsx` has zero auth/lock references; lock checks only in `sync/engine.ts:396,422,495` | none | implemented-unguarded |

### Undocumented enforced guarantees (UNDOC) — code enforces a deliberate rule that no owner document states

| ID | Guarantee | Enforcing code | Guard test | Stated in any doc? |
|---|---|---|---|---|
| UNDOC-1 | Raw source written **before** normalized writes so the primary source survives a partial import failure | `import.ts:92` | `import.test.ts::retains the raw payload once and dedups a byte-identical re-import`; `::records a grown session file as a new raw version…` | no (DI SPEC states retention, not ordering) |
| UNDOC-2 | Subagent transcripts get their own conversation id (see ORPH-5) | `claude-code.ts:80-86` | `claude-code.sidechain.test.ts` | build log only (`decision-recovery/BUILD-LOG.md:79-83`) |
| UNDOC-3 | Parser version constants must be bumped whenever output changes for identical input | `claude-code.ts:14`; `claude-ai.ts:7`; `chatgpt.ts:21` | version *value* pinned by `claude-code.sidechain.test.ts::is version 1.2.0`; nothing guards the bump rule | partly (DI SPEC requires storing a version; bump rule only in DI BUILD-LOG:18) |
| UNDOC-4 | ChatGPT `mapping` tree walk is cycle-guarded (user-supplied JSON must not hang the parser) | `chatgpt.ts:249-265` (`seen` set) | none — 19 tests, none feeds a cyclic mapping | no |
| UNDOC-5 | Pruned ChatGPT edit branches are counted, not silently dropped | `chatgpt.ts:8,237-242` | `chatgpt.test.ts::records pruned-branch counts in providerMeta…` | territory only |
| UNDOC-6 | Markdown export emits only user/assistant messages; system and tool dropped | `exporters/markdown.ts:30-31` | `markdown.test.ts::skips system and tool messages` | assessment only |
| UNDOC-7 | CSV export quotes every cell and doubles embedded quotes | `exporters/csv.ts:9-13` | `csv.test.ts::quotes all cells`; `::escapes embedded double quotes` | no. **Gap:** no spreadsheet-formula-injection guard — a cell beginning `=`, `+`, `-`, `@` is emitted verbatim |
| UNDOC-8 | `src/lib/utils/hash.ts` is explicitly not a crypto boundary | `utils/hash.ts:2-3` | none | no |
| UNDOC-9 | License validation fails closed without `VITE_LICENSE_SECRET`; requires `tier==='pro'`, `issuedAt`, matching HMAC, non-expired | `license.ts:18,58-95` | **none** (no `license.test.ts`) | no. Flags: HMAC compare is plain `!==` (not constant-time); the secret is a client env var, so the gate is forgeable from the bundle (`territories/README.md:53`) |
| UNDOC-10 | Local-only tables never referenced by sync engine/serializer/syncApi — enforced by source-text assertion | `schema.ts:118,125-126,173-186`; `engine.ts:603-604` | `localOnly.test.ts::is never referenced by the sync engine or serializer` | yes. **Coverage gap:** regex covers only `repoFiles|inspections|agentInspections|decisionDiffs`; `rawSources` and `investigationAnchors` are also LOCAL-ONLY but not covered (engine legitimately names `investigationAnchors` for the delete cascade) |
| UNDOC-11 | `clearAllData` wipes every table, local-only included | `db/index.ts:28` | `db/index.test.ts::wipes every table`; `localOnly.test.ts::clearAllData empties both tables` | yes (CW SPEC:280, DR SPEC:278) |
| UNDOC-12 | Thread reordering must preserve set identity | `aipkms/threads.ts:54` | `aipkms/threads.test.ts::rejects order with missing items` | no — `src/lib/aipkms` is mostly dead code with no owning spec |
| UNDOC-13 | Fuse search index has a hard 10000-conversation ceiling; free index is the 100 newest | `search.ts:33,43,53` | **none** (no `search.test.ts`) | yes (`architecture.md:193,196`) |
| UNDOC-14 | Sample-workspace rows are self-labelling as synthetic (`providerMeta.sampleWorkspace`, `disclosure` string) | `demo/seedWorkspace.ts:92-93,152,171` | `seedWorkspace.test.ts::loads the real golden path with synthetic provenance and is idempotent` | no |
| UNDOC-15 | Sample-workspace seeding is idempotent | `seedWorkspace.ts:137-160,267-272` | same | no |

**Demo gating:** `src/lib/demo` is fully reachable in production. `LandingPage.tsx:19-23` and `ProjectsPage.tsx:36-40` import it unconditionally; nothing in `src/` references `import.meta.env.DEV/MODE/PROD`; no Vite exclusion. `seedSampleWorkspace` writes into synced tables, so an unlocked user's sample data will sync as ciphertext like any other row. This looks like a deliberate feature ("Load sample workspace"), but no owner document describes it and no spec covers `src/lib/demo`.

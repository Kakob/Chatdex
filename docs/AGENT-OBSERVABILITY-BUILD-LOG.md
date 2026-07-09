# Agent Observability — Build Log (Phases 0–7)

Companion to `SPEC-agent-observability.md` and `AGENT-OBSERVABILITY-IMPLEMENTATION_PLAN.md`.
Records what was actually built per phase: files touched, what changed in them, and the
design decisions made along the way. Phases 8–8b (hardening, dogfooding) are not yet
started.

**Status after Phase 7:** dashboard (findings over time, per-project, detector health),
per-session report block, "How detection works" page, and settings-page detector config
with bulk re-analyze; golden suite 30/30; full frontend suite 352/352; production build
clean.

| Phase | Commit | Summary |
|---|---|---|
| 0 | `e306ced` | Golden-trace harness + 10 fixtures |
| 1 | `417c33b` | Normalization: signatures, classifier, step stream, edit timelines |
| 2 | `2239b56` | Detector framework, Dexie v2 storage, encrypted sync, Web Worker |
| 3 | `af840bd` | Loop detector |
| 4 | `17036ac` | Verification-absence detector |
| 5 | `beb0a29` | Reversion detector — detector suite complete |
| 6 | `4bb1921` | Findings overlay UI, evidence panel, labeling, auto-analyze (+ `ecc0d8e` typecheck fix) |
| 7 | `791e07f` | Dashboard, session report, explainer page, detector settings |

---

## Phase 0 — Golden-trace harness and fixtures

Detection code without labeled fixtures is unfalsifiable, so the test bed came first.

**New files**

- `tests/golden-traces/fixture-builder.ts` — `userMsg()`, `agentText()`, `toolCall()`,
  `toolResult()` helpers plus `buildTrace()`, emitting schema-correct Claude Code JSONL
  (flat-entry format matching `src/types/claude-code.ts`). Timestamps auto-increment;
  session metadata (sessionId/cwd/gitBranch) attaches to the first entry the way real
  session files carry it.
- `tests/golden-traces/fixtures.ts` — all ten scenarios defined as readable builder code
  (~20 lines each), exactly as the implementation plan prescribed:
  `loop-exact-repeat`, `loop-sequence-repeat`, `loop-legit-polling` (must-NOT-fire),
  `loop-with-state-change` (must-NOT-fire), `verify-clean`, `verify-absent`,
  `verify-asserted`, `reversion-silent`, `reversion-acknowledged`, `mixed-session`.
- `tests/golden-traces/*.jsonl` (10) — generated artifacts, committed so the app can
  import them directly (needed for Phase 6 acceptance). A freshness test compares disk
  content to builder output; regenerate with `UPDATE_FIXTURES=1 npm test`.
- `tests/golden-traces/*.expected.json` (10) — hand-authored contracts declaring expected
  findings (detector, severity, stepRange) per fixture. These are the regression contract:
  any detector change that alters results means fixing the detector or consciously
  updating expectations + bumping the detector version.
- `tests/golden-traces/golden-traces.test.ts` — the runner: per fixture it (1) verifies
  the on-disk JSONL is fresh, (2) parses it through the real ingestion path
  (`parseClaudeCodeContent`) unmodified, (3) diffs pipeline findings against expectations.

**Modified files**

- `vitest.config.ts` — test include extended with `tests/**/*.test.{ts,tsx}`.
- `tsconfig.app.json` — `include` gains `tests`; `types` gains `node` (the runner uses
  `node:fs`/`node:path`).
- `docs/IMPLEMENTATION_PLAN.md` → renamed `docs/AGENT-OBSERVABILITY-IMPLEMENTATION_PLAN.md`,
  with a new decisions log: one phase per session; DetectorConfig user-editable via the
  Settings page (Phase 7); findings sync batched at DetectorRun completion; and the
  step-indexing convention (0-based over non-`system` JSONL entries, 1:1 with normalized
  steps for flat traces).

---

## Phase 1 — Normalization layer

The shared machinery every detector consumes.

**New files** (all under `src/lib/detection/`)

- `signatures.ts` — `signatureFor(toolName, input)` producing the loop-matching signature:
  recursive canonicalization with sorted keys, whitespace collapsing, textual path
  normal-form (`normalizePath`: duplicate slashes, `.`/`..` segments, trailing slashes),
  and an explicitly enumerated `VOLATILE_FIELDS` list (timestamp, request/session/trace/run
  IDs, nonce) — each field individually proven inert by a test.
- `classify.ts` — the curated, versioned tool-call classifier
  (`CLASSIFIER_VERSION = '1.0.0'`): `state_changing` / `verification_shaped` / `neutral`.
  Non-Bash tools map by name; Bash commands match an ordered regex rule list
  (mutating-curl → verification patterns → state patterns → neutral default), so
  `npm test > out.log` classifies as a test run while `curl -X POST` stays state-changing.
  Unknown tools default to `neutral`; `isKnownTool()` exposed for Phase 8's mapping-gap
  counter. **Documented judgment call:** local builds (`npm run build`, `cargo build`)
  classify `verification_shaped` — a build after an edit is a success check, and build
  artifacts should not suppress loop findings — while deploy/publish commands remain
  `state_changing`. SPEC §2.2 is ambiguous here; rationale lives in the module comment.
- `normalize.ts` — `normalizeSession(sessionId, messages)` → `NormalizedSession`:
  - `Step` stream (`user_msg` / `agent_text` / `tool_call` / `tool_result`) with
    `messageId` back-references for UI anchoring; flat traces map 1:1 to the golden-trace
    step convention; messages with embedded `tool_use`/`tool_result` content blocks expand
    to one step per block.
  - Tool-call steps carry precomputed `signature`, `toolClass`, and extracted `editHunks`
    (Edit / MultiEdit / Write / NotebookEdit).
  - Per-file edit timelines (`Map<normalizedPath, TimelineEdit[]>`) for the reversion
    detector. Malformed stored tool input degrades to `{}` rather than crashing.
- `signatures.test.ts`, `classify.test.ts` (39-case classification table),
  `normalize.test.ts` (includes reconstruction of `mixed-session.jsonl` timelines:
  config.ts edits at steps 3/14 forming an inverse pair, cache.ts at 20).

---

## Phase 2 — Detector framework, storage, sync, worker

The chassis: everything detector-agnostic.

**New files**

- `src/types/detection.ts` — `StoredFinding` and `StoredDetectorRun` per SPEC §3, plus
  `FindingSeverity`, `UserLabel`, `StepRange`, `SuppressionOutcome`. Two additive
  deviations from the spec's field list: `runId` (links finding → run) and `updatedAt`
  (last-write-wins sync when a user label changes; everything else is immutable per
  detector version).
- `src/lib/detection/registry.ts` — the `Detector` interface
  (`id` / semver `version` / `defaultConfig` / `run(session, config)`), `DetectorFinding`
  (what detectors emit; the pipeline adds identity/run linkage/timestamps), and the
  registry (`registerDetector` / `getDetectors` / `clearDetectorRegistry` for tests).
  Adding a detector requires zero changes outside registration.
- `src/lib/detection/pipeline.ts` — orchestration split into compute and persist halves:
  - `runDetectors(session, overrides?)` — pure compute over a normalized session (the
    golden runner calls this directly).
  - `computeDetectorRun(conversationId, …)` — loads messages, normalizes, checks
    idempotency, runs detectors; reads storage but never writes.
  - `persistDetectorRun(result)` — one batched Dexie transaction writing the run + all
    findings, rechecking the unique `runKey` inside the transaction.
  - `buildRunKey` — stable-stringified `(conversationId, detectorVersions, config)`;
    re-running with unchanged inputs is a no-op (SPEC §4 idempotency).
- `src/lib/detection/registerAll.ts` — single registration point used by both worker and
  main thread.
- `src/lib/detection/workerHandler.ts` — message protocol
  (`analyze` → `progress`(loading/normalizing/detecting) → `result`/`error`) and the
  testable handler.
- `src/lib/detection/worker.ts` — thin Vite module-worker entry binding the handler.
- `src/lib/detection/workerClient.ts` — main-thread `DetectionWorkerClient`: sends
  requests, relays progress, and persists results.
- `src/lib/db/findings.ts`, `src/lib/db/detectorRuns.ts` — CRUD helpers mirroring the
  existing per-entity module pattern; `setFindingLabel()` is the only mutation path on a
  finding and bumps `updatedAt`.
- `src/lib/detection/pipeline.test.ts` — acceptance tests: stub-detector persistence,
  idempotent re-runs, new run on config/version change with old findings untouched,
  lossless envelope → AES-GCM encrypt → decrypt → rehydrate round-trips for both
  entities, worker protocol (including compute-only verification), and a synthetic
  10k-step session under the 5-second budget.

**Modified files**

- `src/lib/db/schema.ts` — Dexie `version(2)`: `findings` table
  (`&id, conversationId, runId, detector, severity, userLabel, createdAt,
  [conversationId+createdAt]`) and `detectorRuns` (`&id, &runKey, conversationId,
  finishedAt` — the unique `runKey` enforces idempotency at the DB level).
- `src/lib/db/index.ts` — barrel exports for the new modules; `clearAllData` covers both
  tables.
- `src/lib/db/conversations.ts` — `deleteConversation`, `deleteConversationsBySource`,
  and `clearConversations` cascade to findings and detector runs.
- `src/lib/sync/syncApi.ts` — `SyncKind` gains `'finding' | 'detector_run'`.
- `src/lib/sync/serializer.ts` — `envelopeFinding`/`rehydrateFinding`,
  `envelopeDetectorRun`/`rehydrateDetectorRun` (`parentId = conversationId`; finding
  `updatedAt` drives last-write-wins for label changes).
- `src/lib/sync/engine.ts` — hooks, `applyIncomingRecord`, and `buildEnvelope` cases for
  both kinds; incoming conversation deletes cascade to findings/runs.
- `backend/src/routes/sync.ts` — zod `KindSchema` accepts the two new kinds.
- `backend/src/db/schema.ts` — `kind` column type union extended (varchar, so no
  Postgres migration needed).
- `tests/golden-traces/golden-traces.test.ts` — placeholder replaced with the real
  pipeline (`normalizeSession` + `runDetectors`).

**Key design decision:** Dexie hooks are per-instance, so a worker that wrote IndexedDB
would silently bypass the main thread's sync engine. Therefore **the worker only
computes; the main thread persists** — which also delivers the "batched at DetectorRun
completion" sync decision naturally.

---

## Phase 3 — Loop detector

**New:** `src/lib/detection/detectors/loop.ts` (`loop` v1.0.0) + `loop.test.ts` (12 tests).
**Modified:** `registerAll.ts` (registration only — the framework needed no changes,
validating the registry invariant).

- **Exact repeats:** sliding-window seed (≥N occurrences of one signature within an
  M-step window; defaults N=3, M=10) then gap-based extension so an established loop
  absorbs subsequent repeats. Windowing is precise: occurrences at steps 0/9/18 do not
  fire because no single 10-step window holds three.
- **Sequence repeats:** 2–4-signature blocks repeating ≥2× consecutively in the tool-call
  stream, requiring ≥2 distinct signatures; exact-in-sequence dedupe guarantees one loop
  never produces two findings.
- **Suppression 1 — retry whitelist:** configurable regex list (gh run view/watch,
  sleep, `--watch`, kubectl get, docker ps, status/health/ping); fires only when *every*
  distinct signature in the candidate is retry-shaped.
- **Suppression 2 — intervening state change:** an external state-changing call between
  repeats segments the candidate; surviving segments are re-qualified and the trim is
  recorded (`fired: true` with the boundary step). The loop's *own* signatures never
  self-suppress — preserving SPEC §2.3's edit→revert→edit cross-reference case.
- Both suppressions recorded on every surviving finding; evidence carries signatures,
  occurrence steps, repeat count, and effective thresholds.
- Golden results: `loop-exact-repeat` {1,11}, `loop-sequence-repeat` {1,12}, both
  must-NOT-fire fixtures suppressed, `mixed-session` loop trimmed to {5,10} with step 16
  correctly excluded.

---

## Phase 4 — Verification-absence detector

**New:** `src/lib/detection/detectors/verificationAbsence.ts` (`verification_absence`
v1.0.0) + `verificationAbsence.test.ts` (13 tests).
**Modified:** `registerAll.ts`.

- **Forward scan** from every state-changing call to the span boundary: new user message
  (`topic_shift`), agent text matching a task-transition pattern (`task_transition`), or
  `session_end`. Verification appearing *after* a boundary does not clear the earlier
  action.
- **What clears a span:** any verification-shaped call, or a **read-back** — a `Read` of
  the exact (path-normalized) file the action edited. SPEC §2.2 lists read-backs as
  verification-shaped, but that property is contextual, so the detector resolves it
  rather than the intrinsic classifier.
- **Severity escalation:** configurable success-assertion regexes ("should pass/work",
  "this/that fixes", "fixed", "all set", "good to go") escalate to **high** when asserted
  but never verified. Tuned so plain completion language ("Done, I have updated the
  timeout") stays medium — that distinction is pinned by the `verify-absent` fixture.
- Evidence: scanned span + end reason, assertion excerpt with matched pattern, and the
  classification of every tool call in the span.
- Golden results: `verify-clean` no finding; `verify-absent` medium {1,3};
  `verify-asserted` high {1,3}; `mixed-session` gains high {20,22}.

---

## Phase 5 — Reversion detector

**New:** `src/lib/detection/detectors/reversion.ts` (`silent_reversion` v1.0.0) +
`reversion.test.ts` (12 tests).
**Modified:** `registerAll.ts`.

- **Inverse-hunk matching** over the Phase 1 per-file timelines: a later edit restores a
  region when its normalized `newString` equals an earlier edit's `oldString` and it
  removes what that edit introduced. Whitespace-normalized textual comparison; whole-file
  `Write` restores are caught; nearest-earlier pairing yields one finding per reverting
  edit; cross-file pairs never match.
- **Acknowledgment downgrade:** configurable patterns (reverting, undoing, rolling back,
  going back to, restore original) scanned in a configurable window (default 3 steps
  before/after the reverting edit). Present → `info`; absent → `medium` silent reversion.
  "Let me adjust the implementation" does not count.
- **Loop cross-reference:** edit→revert→edit thrash records
  `crossReference.cycleSteps` in evidence rather than a hard finding-to-finding link
  (finding IDs don't exist at detector time, and inter-detector coupling would break the
  registry invariant). The UI connects findings by overlapping step ranges. Unit-verified:
  the same thrash session yields coexisting reversion findings and a loop
  sequence-repeat finding.
- Golden results: `reversion-silent` medium {1,6}; `reversion-acknowledged` info {1,6};
  `mixed-session` fully green with all three detectors — loop {5,10} +
  silent_reversion {3,14} + verification_absence high {20,22}.

---

## Phase 6 — Findings overlay UI, evidence panel, labeling, auto-analyze

The detectors become visible: markers in the session browser, a self-explaining
evidence panel, ground-truth labeling, and analysis wired into ingest.

**New files**

- `src/stores/findingsStore.ts` — Zustand store: findings + run counts per conversation,
  per-conversation analyzing stage (for progress spinners), selected finding, and actions
  `loadFindings` / `analyze` / `selectFinding` / `labelFinding` (label toggling supports
  reset-to-unset).
- `src/lib/detection/autoAnalyze.ts` — shared analysis entry point: uses the Web Worker
  when `Worker` exists, falls back to main-thread `analyzeSession` otherwise (tests, older
  webviews); both paths persist via `persistDetectorRun` on the main thread.
  `autoAnalyzeConversations(ids)` logs per-session failures without throwing.
- `src/lib/detection/findingAnchors.ts` — `mapFindingsToMessages(session, findings)`:
  findings anchor to step indices; steps carry `messageId` back-references, so resolving a
  marker to a message bubble is a lookup, not a heuristic.
- `src/components/detection/severity.ts` — severity order/labels/badge classes and the
  cosmetic detector display-name map (unknown detector ids fall back to the raw id — no
  per-detector UI requirement).
- `src/components/detection/FindingMarker.tsx` — inline severity-coded marker chips;
  click selects the finding (ring highlight when selected).
- `src/components/detection/EvidencePanel.tsx` — the "why this fired" panel, rendered
  entirely from the stored finding: summary, severity + detector version, step range with
  a jump-to-location button, generic evidence renderer (detector-agnostic key/value +
  JSON), suppression checks with fired/not-fired states and details, the raw steps in
  range, and Confirm / False-positive labeling with a privacy note. Prev/next navigation
  (with n-of-m counter and wrap-around) browses all findings in step order, scrolling the
  feed to each; added after Jacob's first click-through showed the chips were dead ends.
- `src/stores/findingsStore.test.ts` + `src/components/detection/EvidencePanel.test.tsx`
  — analyze→findings→label flows against real golden traces in fake-indexeddb; marker
  anchoring verified against `mixed-session` (messages 3/5/20 carry reversion/loop/
  verification markers); labels persist across a simulated reload with `updatedAt` bumped
  for sync.

**Modified files**

- `src/components/conversations/ConversationView.tsx` — loads findings per conversation,
  normalizes the session once (`useMemo`) for anchoring, severity-count chips + an
  Analyze/Re-analyze button with live pipeline-stage spinner in the header, and the
  evidence panel rendered beside the message feed when a finding is selected. The
  severity chips are interactive: clicking one opens the first finding of that severity
  and cycles through the rest on repeat clicks, scrolling the feed along.
- `src/components/conversations/MessageBubble.tsx` — accepts `findings` and renders
  markers in all bubble variants; tool bubbles gained `id="message-…"` anchors so
  jump-to-finding works for tool steps. Bubbles also show subtle `#n` step labels
  (`mapMessagesToStepLabels`; ranges like `#5–6` when a message expands to multiple
  steps) for Claude Code sessions only, so the step numbers findings cite are visible
  in the feed — added after Jacob's click-through flagged that steps appeared nowhere
  in the UI.
- `src/lib/import.ts` — `storeData` returns `addedConversationIds`; `importFiles` runs
  `autoAnalyzeConversations` over them before reporting completion (auto-analyze on
  ingest, SPEC §4 trigger (a)).

**Repo bug found and fixed in passing:** `npm run typecheck` was `tsc --noEmit` against
the solution-style root `tsconfig.json` (`files: []`), which type-checks *nothing* — every
prior "typecheck clean" was vacuous; the real check only ran inside `npm run build`
(`tsc -b`). The script is now `tsc -b` (CLAUDE.md updated). Making the check real
surfaced and fixed three latent issues: discriminated-union narrowing failures in
`src/lib/parsers/claude-code.ts` (pre-existing: the `ClaudeCodeUnknownEntry.type: string`
catch-all defeats narrowing — per-case casts added), a non-distributive `Omit` over the
entry union in `tests/golden-traces/fixture-builder.ts` (now a distributive omit), and an
unused parameter in `detectors/loop.ts`.

**Verification:** full suite 338/338 (9 new UI tests); production build clean with the
worker emitted as its own chunk (`dist/assets/worker-*.js`); dev server boots and serves
the worker module. Interactive click-through (markers → panel → labels in a real browser,
worker non-blocking under load) still needs a human pass — jsdom cannot exercise it.

## Phase 7 — Dashboard, session report, explainer page, detector settings

The longitudinal view — Chatdex's core differentiator vs. one-shot trace viewers —
plus the settings surface from decisions log #2.

**New files**

- `src/lib/detection/stats.ts` — dashboard aggregates computed client-side from Dexie:
  `computeObservabilityStats()` joins findings to conversations and returns
  findings-over-time (weekly `WeekBucket`s keyed by **session date, not analysis date**,
  so bulk-imported history produces a real longitudinal view; `weekStartOf` is
  UTC-consistent — a local/UTC mixing bug was caught by its own test), per-project
  breakdown (via `projectPath`/`workingDirectory`), and per-detector health (confirmed /
  false-positive / unlabeled counts, FP rate from labels only, `null` until labels
  exist). Also `busiestSpan()` for the session report (max-overlap step range).
- `src/components/detection/FindingsOverTimeChart.tsx` — stacked weekly bars (Recharts)
  with a By severity / By detector toggle; detector series colors assigned by palette
  index so unknown detectors need no UI changes.
- `src/components/detection/DetectorHealthCards.tsx` — per-detector cards with the
  false-positive rate surfaced honestly (highlighted when > 25%).
- `src/components/detection/ProjectBreakdownTable.tsx` — project × detector counts +
  session counts, basename display with full-path tooltip.
- `src/components/detection/ObservabilityDashboard.tsx` — section composition +
  totals header + "How detection works" link; rendered at the bottom of the Analytics
  page.
- `src/components/detection/SessionReport.tsx` — one-line per-session block (SPEC §5.3):
  severity counts + busiest span, or a green "no failure patterns" state; shown only
  for analyzed Claude Code sessions.
- `src/pages/HowDetectionWorksPage.tsx` — the in-app explainer (SPEC §6): privacy model,
  the three detectors in plain language, the verbatim known-limits/roadmap table, and
  why labels matter. Routed at `/how-detection-works`, linked from the dashboard and the
  settings section.
- `src/components/settings/DetectionSettingsSection.tsx` — detector config editor
  (decisions log #2). The form is **generated from each detector's `defaultConfig`
  shape** (numbers → number inputs, string arrays → line-separated textareas), so new
  detectors get a settings UI with zero per-detector code. Save persists overrides to
  metadata (`detection.configOverrides`); "Re-analyze all sessions" walks every Claude
  Code conversation with a progress counter (disabled while unsaved edits exist).
- `src/lib/detection/stats.test.ts` — acceptance: a synthetic 24-session corpus across
  8 weeks / 3 projects; every dashboard total reconciles with raw table counts, buckets
  verify session-date semantics, FP rates verified against per-label queries.
- `src/lib/detection/autoAnalyze.test.ts` — stored overrides flow: default config
  doesn't fire on a 2-repeat trace, stored `repeatThreshold: 2` does, the new run
  records the effective config, prior findings remain untouched, and idempotency holds
  under overrides.

**Modified files**

- `src/lib/detection/autoAnalyze.ts` — `getStoredConfigOverrides` /
  `setStoredConfigOverrides` (metadata-backed); `analyzeConversation` now applies stored
  overrides on every path (UI button, auto-analyze on import, bulk re-analyze) unless
  explicit overrides are passed.
- `src/pages/AnalyticsPage.tsx` — renders `<ObservabilityDashboard />` below the
  existing charts.
- `src/pages/SettingsPage.tsx` — renders `<DetectionSettingsSection />` after cloud sync.
- `src/components/conversations/ConversationView.tsx` — renders `<SessionReport />`
  under the header for Claude Code sessions.
- `src/App.tsx` + `src/pages/index.ts` — route + barrel export for the explainer page.

## Invariants held throughout

1. No plaintext leaves the client — findings and labels sync as AES-GCM ciphertext only.
2. Detection is client-side, worker-ready; the worker never writes.
3. Findings immutable per detector version — re-runs create new `DetectorRun`s + rows.
4. Every finding self-explains from stored `evidence` (thresholds, spans, excerpts,
   classifications included).
5. Detectors are pluggable — phases 3–5 each changed only their own module plus one
   registration line.
6. All thresholds/patterns are `DetectorConfig` fields with documented defaults — no
   inline magic numbers.
7. Suppression rules carry equal test weight to detection rules; every surviving finding
   records all evaluated suppressions, fired or not.

## What remains (Phases 8–8b)

- **Phase 8:** performance profiling against the 10k-step target, bulk re-analysis flow
  for detector version bumps (the settings-page re-analyze covers config changes),
  graceful degradation for malformed JSONL / partial sessions / unknown tools (counted
  so mapping gaps are visible).
- **Phase 8b:** the real-corpus dogfooding pass — run detectors over the full personal
  history, label every finding, turn false positives into new must-NOT-fire fixtures +
  suppression fixes, and read the detector-health view against reality.

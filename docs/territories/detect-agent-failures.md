# Territory: Detect agent failures

The product's distinctive layer: analyzing a stored Claude Code session for loops, verification absence, and silent reversions — client-side, in a Web Worker, with explainable evidence.

## The question

From "a session lands in Dexie" to "chips on the browse card and an evidence panel in the conversation view" — what computes, where, under what versioning contract, and what does a finding actually contain?

## User-visible behavior

```
Import a Claude Code session
    ↓ (automatic, silent, awaited inside the import)
findings appear: severity chips on browse cards, markers + SessionReport
in the conversation view, aggregate dashboard on Analytics
    ↓
click a finding → EvidencePanel: "why this fired", suppression checks,
steps involved, jump-to-message; label it (real / false positive / not sure)
    ↓
detector version bump → StaleAnalysisBanner offers bulk re-analyze
config change in Settings → separate "Re-analyze all sessions" button
```

## Entry point

Three triggers, matching SPEC §4 [CODE]:
- **Auto after import** — `lib/import.ts:39-42` → `autoAnalyzeConversations(new ∩ claude-code)`; serial, error-swallowing, awaited.
- **Manual** — Analyze/Re-analyze button in `ConversationView` → `findingsStore.analyze` (the only path with an in-flight guard).
- **Bulk** — `StaleAnalysisBanner` (version staleness) and `DetectionSettingsSection` (config change; re-analyzes *all* claude-code sessions, not just stale) — both call `analyzeConversation` directly, **bypassing** the store's guard.

## Control-flow path

```
analyzeConversation(convId, onProgress?, overrides?)     autoAnalyze.ts:31
    ↓ registerAllDetectors() (idempotent) + stored overrides from
      metadata['detection.configOverrides']
    ↓ typeof Worker !== 'undefined' ?
      workerClient.analyze(...)  :  analyzeSession(...)   ← silent main-thread fallback
    ↓ (worker) postMessage → worker.ts → computeDetectorRun
    │
computeDetectorRun                                       pipeline.ts:105
    ↓ runKey = stableStringify({conversationId, detectorVersions, config})
    ↓ existing run with this runKey?  → {skipped: true} — doesn't even load messages
    ↓ load messages ([conversationId+createdAt] order) → normalizeSession
    ↓ runDetectors: per-detector try/catch — a throwing detector is isolated
      into run.errors, others continue
    ↓ findings stamped with id/runId/detectorVersion/userLabel:'unset'
    │
worker posts result → MAIN THREAD persists               workerClient.ts:52
    ↓ one rw transaction: detectorRuns.add + findings.bulkAdd
      (in-transaction runKey re-check absorbs concurrent duplicates)
    ↓ Dexie hooks fire → findings/runs sync as ciphertext
    ↓ findingsStore.loadFindings → UI
```

The worker **computes only, never writes** — Dexie hooks are per-instance, so worker-side writes would be invisible to the sync engine. [CODE workerHandler.ts:5-7 + DOC implementation-plan decision #3]

### The three detectors, algorithmically

- **Loop** (`detectors/loop.ts`, always `medium`): tool calls keyed by *signature* (`tool:JSON(canonicalized args)` — sorted keys, volatile fields dropped, paths normalized). Exact-repeat pass (≥N in an M-step window, then extended beyond the window once established) + sequence-repeat pass (repeating multi-signature units, greedy). Two suppressions, always recorded: **retry-whitelist** (regexes; fires only if *every* signature matches → drops the finding) and **intervening-state-change** (segments occurrences at external state changes — a state change *by the loop's own signature* doesn't count, which preserves edit-loops; exact repeats only).
- **Verification absence** (`detectors/verificationAbsence.ts`): for *every* state-changing tool call, scan forward to a boundary (next user msg / task-transition text / session end); no verification-shaped call and no read-back of the edited file in the span → finding. A success *assertion* ("tests pass") in the span upgrades severity to `high`. Tool classes come from `classify.ts`: a name table plus an ordered Bash-regex list (local builds → verification-shaped; deploy/publish → state-changing — a documented judgment call over an ambiguous spec).
- **Silent reversion** (`detectors/reversion.ts`): per-file edit timelines; a later edit whose `newString` whitespace-normalizes to a nearest earlier edit's `oldString` (with region identity) = reversion. Acknowledgment language nearby downgrades to `info` — **the only suppression in the system that fires while still emitting a finding**. Thrash cycles are recorded in evidence as `crossReference`, not linked findings.

## Data flow

```
StoredMessage[] ── normalizeSession ──► Step[] {index, kind, messageId, toolName,
                (system msgs skipped;      signature, toolClass, editHunks}
                 contentBlocks expanded)   + editTimelines per file + unknownToolCounts
        ↓ runDetectors
DetectorFinding {detector, severity, stepRange, summary, evidence, suppressionsEvaluated}
        ↓ + id/runId/detectorVersion/createdAt/userLabel
Dexie findings + detectorRuns ── hooks ──► encrypted sync
        ↓ read path
latest-run-only filtering (older runs retained for audit) → chips, dashboard, panel
```

**"Explainable from evidence alone" (CLAUDE.md invariant 4): substantially upheld, one caveat.** `EvidencePanel` renders the header, summary, "Why this fired" (a fully detector-agnostic renderer over `finding.evidence` — no per-detector branch exists), and the suppression checks purely from stored data [CODE + TEST EvidencePanel.test.tsx]. But the "Steps involved" excerpts and jump-to-message are **re-derived live** from a required `NormalizedSession` prop — the explanation is evidence-only; the raw-step context is not. [CODE]

## State ownership

```
Dexie findings/detectorRuns    durable; findings immutable except userLabel+updatedAt
findingsStore (Zustand)        per-conversation cache + analyzingStage + selectedFindingId
useFindingSummaries            separate chip cache, keyed on the id list —
                               NOT invalidated by labeling ⚠ (false-positive chip lingers)
staleness                      computed on demand: full scans of conversations + runs;
                               config changes deliberately don't count as stale
```

## Decisions embodied by the code

**Decision:** Identity of an analysis = `runKey(conversationId, detectorVersions, config)` — **no message-content hash**.
**Evidence:** [CODE pipeline.ts:34-53]
**Consequence:** if messages ever change under a stable conversation id, re-analysis is a silent no-op and findings anchor to the wrong steps. Today this is masked by import's skip-existing rule — the two gaps interlock: re-import doesn't update messages, so runKey never sees changed content. Fixing either exposes the other.

**Decision:** Findings immutable per detector version; version bump ⇒ new run + new rows, old rows untouched.
**Evidence:** [CODE — only `bulkAdd` in the pipeline; TEST pipeline.test.ts:159-168]
**Caveat:** `CLASSIFIER_VERSION` (`classify.ts`) claims the tool-class mapping is versioned — **the constant is referenced nowhere**: not in runKey, not on runs, not in staleness. Changing a Bash regex changes two detectors' behavior with zero staleness signal. A breach of the invariant in spirit. [CODE vs its own comment]

**Decision:** Fully-suppressed candidates leave **no record anywhere**.
**Evidence:** [CODE loop.ts:247, :261-264 — the comment concedes "no finding survives to carry the record"]
**Conflict:** the implementation plan's Phase 3 acceptance says `suppressions_evaluated` is populated "on every candidate, **including suppressed ones**". CLAUDE.md's weaker phrasing is satisfied; the plan's is not. Sharpest documented-vs-actual gap in the layer. [DOC vs CODE]

**Decision:** Latest-run-only display; older runs kept for audit.
**Evidence:** [CODE stats.ts:57, findingsStore.ts:38; DOC build log "Issue #1"; TEST hardening.test.ts]
**Caveat:** two independent latest-run implementations with different tie-breaks (`>=` in array order vs sort-desc-first) — same-millisecond `finishedAt` can make the chip count, dashboard, and session view disagree. [CODE]

**Decision:** Detector pluggability (invariant 5) is genuinely upheld — registry-driven pipeline, open `detector: string`, settings form *generated from `defaultConfig` shape*, generic evidence renderer. Three cosmetic exceptions only (label map, a test union, a `grid-cols-3`). [CODE]

## Invariants and assumptions

- Detection is client-side, worker-hosted, network-free: no network call or LLM import anywhere in `src/lib/detection/`. ✅ [CODE] Nuance: the main-thread fallback when `Worker` is undefined is silent — "never blocks the UI" isn't guaranteed there.
- Step indexing is 1:1 with non-system JSONL entries — the convention golden-trace step ranges depend on. [CODE normalize.ts:5-9][TEST]
- Findings/runs sync losslessly as ciphertext. [TEST pipeline.test.ts:177-198]
- User-editable config is assumed sane: regex fields compile with `new RegExp` at run time **with no try/catch** — one invalid user regex silently zeroes that detector for every session (it lands in `run.errors`, which no banner surfaces). [CODE]

## Failure modes

1. **Worker crash = permanent hang.** `workerClient` sets only `onmessage` — no `onerror`, no timeout. A dead worker leaves the promise unsettled forever and the Analyze button disabled until reload. [CODE workerClient.ts:24-33]
2. **Stale findings after content change** (runKey gap above).
3. **Findings that can't anchor are silently dropped from markers while still counted** — "3 findings" in the header, 2 markers rendered. [CODE findingAnchors.ts:16]
4. **Label edits don't refresh chip/dashboard caches** — a false-positive label should remove the chip; it doesn't until the id list changes.
5. Bulk re-analysis is serial, unbounded, uncancellable; navigating away abandons it mid-way; the banner optimistically clears regardless of per-item failures.
6. Concurrent analyze on one conversation: safe (in-transaction runKey re-check) but the loser gets `{skipped:true, findings:[]}` — an empty array that doesn't mean "no findings".

## Tests and verification

This is by far the best-tested territory. [TEST]
- **Golden traces** (`tests/golden-traces/`): 10 hand-labeled fixtures, byte-compared against the fixture builder, run through the *real* parse→normalize→detect path, findings compared by (detector, severity, stepRange). Both loop suppressions have must-not-fire fixtures; `mixed-session` proves coexistence + state-change trimming.
- Unit suites cover: window boundaries, whitelist partial-match non-suppression, edit-loop self-suppression prevention, read-back path normalization, span boundaries (topic-shift vs task-transition), reversion nearest-pairing/thrash/ack-window, runKey idempotency and version-bump behavior, sync round-trips, throwing-detector isolation, a real 10k-step perf test (<5s), corrupted-JSONL hardening, staleness lifecycle.
- **Gaps:** the real `Worker` path is entirely untested (jsdom has no Worker — every test takes the fallback branch); no test for suppressed-candidate recording (because there is none); no tie-break test; no changed-content-same-id test; Phase 8b (real-corpus dogfooding, FP-rate labeling) never happened, so no detector's real-world false-positive rate is known — the detector-health card has no real data behind it.

## Spec vs code (beyond the decisions above)

- **SPEC §10 (interventions, phases I0–I6) is entirely unimplemented** — grep for "intervention" over src/backend/tests returns nothing. The dashboard still leads with finding counts, the exact framing I6 says to invert. The product-positioning copy update is explicitly blocked on I6. [DOC vs CODE]
- SPEC §2.1 says suppression "downgrades or drops" loop candidates — code only drops/trims; `low` severity exists in the type and is used by no detector.
- SPEC's cross-detector "link" is, in code, evidence + a comment saying "the UI connects findings by overlapping step ranges" — **no UI does this**.
- CLAUDE.md still says the detection layer is "planned… not yet created" and the worker "not yet wired" — both long false.

## Visual map

```
import ──auto──┐
button ────────┼─► analyzeConversation ──► WORKER: normalize → 3 detectors → result
bulk (2 paths)─┘        │ (fallback: main thread, silent)          │
                        ▼                                          ▼
              metadata['detection.configOverrides']    MAIN THREAD persists (1 txn)
                                                       findings + detectorRuns
                                                            │ hooks → encrypted sync
              runKey = f(convId, versions, config) ── same key ⇒ skip (no content hash ⚠)
                                                            ▼
              latest-run-only: chips (browse) · markers+report (view) · dashboard (analytics)
```

## Suggested walk

1. Read `src/types/detection.ts` first — the domain vocabulary (Finding, DetectorRun, evidence, suppressions) is all here with design comments.
2. Read `normalize.ts`; predict what a Step must carry for a detector to explain itself later.
3. Read `signatures.ts` (canonicalization) — then predict how a loop detector would use it before opening `detectors/loop.ts`.
4. Read `loop.ts` in full; pay attention to the order dedup → suppression, and to what happens to a fully suppressed candidate.
5. Read `pipeline.ts:34-66` (runKey + config resolution). Ask: what *isn't* in the runKey?
6. Read `workerClient.ts` + `workerHandler.ts` (short) — the compute/persist split is the architectural heart.
7. Open `tests/golden-traces/` — read one fixture + its `.expected.json`, then the harness's three assertions.
8. Finish in `EvidencePanel.tsx`: verify for yourself which sections render from stored evidence and which need the live session.

## Ownership challenge

Close the `CLASSIFIER_VERSION` hole: include it in `detectorVersions` (or the runKey) so classify.ts changes mark sessions stale, add it to `StoredDetectorRun`, and write the test that fails if the constant becomes unreferenced again. Small, sharpens the layer's core versioning contract, touches pipeline + staleness + types. (Alternative: add `onerror` + a timeout to `DetectionWorkerClient` with a test using a mock worker.)

## Fog

- ? Where should suppressed candidates be recorded — run-level counters, zero-severity findings, or accepted invisibility? (Plan says one thing, code does another.)
- ? Should message content (count/hash) join the runKey? What's the intended story for grown sessions?
- ? Latest-run tie-break: which is canonical, and should both call sites share a helper?
- ? Worker death: reject-and-respawn, fall back to main thread, or surface an error?
- ? Sequence repeats: is the unfireable state-change rule intentionally out of scope? And is exact-subsumed-by-later-suppressed-sequence (a silent miss) known?
- ? Should analyzing non-claude-code sources be blocked, or is the current "possible but unsupported" state fine?
- ? Are interventions (SPEC §10) next after U6, or abandoned? Product copy is blocked on the answer.
- ? When does Phase 8b (real-corpus FP labeling) happen? The honesty surface (detector health) is empty without it.
- ? Config regex fields: validate at save time in Settings, or keep failing at run time?

# Chatdex Agent Observability — Implementation Plan

Companion to `SPEC-agent-observability.md`. Phases are ordered so that every phase ends with something runnable and testable. Work with Claude Code one phase at a time; don't start a phase until the previous phase's acceptance criteria pass.

---

## Decisions log

**2026-07-08:**
1. **Cadence:** one phase per working session, strictly sequential. A phase is done only when its acceptance criteria pass (`npm run typecheck` + golden-trace suite).
2. **DetectorConfig is user-editable** via a section on the existing Settings page (thresholds N/M, retry whitelist), with documented defaults. Changing config prompts a re-analysis (new `DetectorRun`s — findings from prior configs remain immutable). Built in Phase 7.
3. **Findings sync is batched:** `Finding` and `DetectorRun` records are written in one Dexie transaction when a `DetectorRun` completes (`persistDetectorRun`), so the sync engine's hooks see one burst per analysis rather than a mid-run trickle. Corollary (built in Phase 2): the Web Worker only *computes* — it never writes, because Dexie hooks are per-instance and worker-side writes would be invisible to the main thread's sync engine. The worker posts results back and the main thread persists.
4. **Golden-trace step indexing convention:** `stepRange` indices in `*.expected.json` are 0-based positions in the fixture's entry stream, counting every non-`system` JSONL entry (user, assistant, tool_use, tool_result). Phase 1 normalization must preserve this 1:1 mapping for flat-entry traces.

**2026-07-09:**
5. **Intervention amendment approved** (SPEC §10, source `chatdex-intervention-update-v2.md`). Phases I0–I6 appended below; same cadence (one phase per session, strictly sequential, acceptance criteria gate).
6. **Auto-event ids are content hashes** of `(session_id, message_index, type, detector_version, config_hash)` — config hash included so same-version/different-config runs don't silently overwrite.
7. **Dispositions reset on version/config bumps** (new ids → new rows starting `active`); superseded rows keep their dispositions as labeled data. Matches Findings' `userLabel` reset behavior. Carry-forward is roadmap.

---

## Phase 0 — Golden traces & test harness (do this FIRST)

Detection code without labeled fixtures is unfalsifiable. Build the test bed before any detector.

**Fixture sourcing strategy — synthetic first.** Golden traces are **hand-constructed, not harvested from real sessions**. Each fixture should be minimal and surgical (a short trace containing exactly one scenario and nothing else), which real sessions never are. Build a small `fixture-builder` helper — functions like `userMsg()`, `toolCall()`, `toolResult()`, `agentText()` that emit schema-correct Claude Code JSONL — so each fixture is ~20 readable lines of code rather than an opaque JSONL blob. Copy the message envelope structure from any real session to get the schema right; author the content deliberately. Optionally, generate 1–2 realistic traces (e.g., `mixed-session.jsonl`) by *inducing* failures in a sandbox repo: give Claude Code a task with a secretly broken dependency or a deliberately flaky test, and capture the resulting session. Real personal sessions enter the picture only after Phase 5, as a validation corpus (see Phase 8b).

**Tasks:**
1. Create `tests/golden-traces/` with 8–12 fixtures (built via the fixture-builder above). Each fixture targets one scenario:
   - `loop-exact-repeat.jsonl` — same command fails 4x identically
   - `loop-sequence-repeat.jsonl` — a 3-step sequence repeats
   - `loop-legit-polling.jsonl` — build polling that must NOT fire (suppression test)
   - `loop-with-state-change.jsonl` — repeats with intervening edit, must NOT fire
   - `verify-clean.jsonl` — edit → test run, no finding
   - `verify-absent.jsonl` — edit → moves on, finding
   - `verify-asserted.jsonl` — edit → "tests should pass now" → session ends, HIGH severity
   - `reversion-silent.jsonl` — edit → later edit restores prior hunk, no acknowledgment
   - `reversion-acknowledged.jsonl` — same but agent says "reverting", informational only
   - `mixed-session.jsonl` — a long realistic session containing 2–3 findings of different types
2. The `fixture-builder` helper module, with its output verified to parse through Chatdex's existing JSONL ingestion path (this is itself a test of schema correctness).
3. For each fixture, a sibling `*.expected.json` declaring the expected findings (detector, severity, step range).
4. A test runner that loads each fixture, runs the pipeline, and diffs findings against expectations.

**Acceptance:** `npm test` (or equivalent) runs the harness; all fixtures parse through the existing ingestion code without modification; expectations files exist (tests will fail red until detectors exist — that's correct).

---

## Phase 1 — Normalization layer

**Tasks:**
1. `NormalizedSession` type: ordered steps with kind (user_msg / agent_text / tool_call / tool_result), tool metadata, and file-edit hunks extracted.
2. Signature generation: `tool_name + canonicalized_args` (path normalization, whitespace stripping, volatile-field dropping — enumerate the volatile fields explicitly and test each).
3. Tool-call classification (state-changing / verification-shaped / neutral) as a curated, versioned mapping in its own module, covering at minimum: file write/edit tools, bash commands matched by pattern (test runners, linters, curl, git, package managers, build tools).
4. Per-file edit timeline construction.

**Acceptance:** unit tests prove (a) two textually different but equivalent tool calls produce identical signatures, (b) volatile fields don't affect signatures, (c) the classifier maps a list of ~30 representative tool calls correctly, (d) edit timelines reconstruct correctly from `mixed-session.jsonl`.

## Phase 2 — Detector framework + pipeline

**Tasks:**
1. `Detector` interface, `DetectorConfig`, registry.
2. Pipeline orchestration: run all registered detectors over a `NormalizedSession`, produce `Finding[]` + `DetectorRun`.
3. Storage: IndexedDB stores for `Finding` and `DetectorRun`; extend the encrypted sync layer to cover both. Sync is **batched at DetectorRun completion** (decisions log #3), not per-record hooks.
4. Web Worker wrapper; message protocol (analyze session id → progress → results).
5. Idempotency: re-running with same (session, versions, config) is a no-op.

**Acceptance:** a stub detector registered in tests produces findings that persist to IndexedDB, round-trip through encryption/sync, and are not duplicated on re-run. Worker analyzes without blocking main thread (verify with a synthetic 10k-step session).

## Phase 3 — Loop detector

Implement per SPEC §2.1: signatures, sliding window (N=3/M=10 defaults, configurable), sequence repeats, retry whitelist, state-change suppression.

**Acceptance:** all four `loop-*` golden traces pass — including the two must-NOT-fire fixtures. `suppressions_evaluated` populated on every candidate, including suppressed ones.

## Phase 4 — Verification-absence detector

Implement per SPEC §2.2: forward scan from state-changing actions, task-boundary heuristic, success-assertion escalation.

**Acceptance:** all three `verify-*` golden traces pass with correct severities; evidence includes the full classified span.

## Phase 5 — Reversion detector

Implement per SPEC §2.3: hunk diffing against the per-file timeline, acknowledgment-language check, cross-reference links to loop findings.

**Acceptance:** both `reversion-*` golden traces pass; `mixed-session.jsonl` now passes end-to-end with all expected findings from all three detectors; the edit→revert→edit case produces cross-linked loop + reversion findings.

## Phase 6 — UI: findings overlay + evidence panel

**Tasks:**
1. Inline severity-coded markers in the session browser at finding step ranges.
2. Evidence panel: summary, rule that fired, suppressions evaluated, raw steps.
3. Confirm / False-positive labeling, persisted (encrypted) on the finding.
4. Auto-analyze on ingest + manual "re-analyze" action.

**Acceptance:** open any golden trace in the app → markers appear at correct steps → every finding's panel fully explains itself from stored evidence → labels persist across reload and sync.

## Phase 7 — Dashboard + session report

**Tasks:**
1. Findings-over-time chart (by detector, by severity).
2. Per-project breakdown.
3. Detector health view (false-positive rate from labels).
4. Per-session report block.
5. "How detection works" page including the known-limits table from SPEC §6.
6. Settings-page section for `DetectorConfig` (decisions log #2): editable thresholds and retry whitelist, documented defaults, "re-analyze with new config" action.

**Acceptance:** dashboard renders correctly against a corpus of 20+ analyzed sessions (use your real corpus); numbers reconcile with raw finding counts.

## Phase 8 — Hardening pass

- Performance: profile the 10k-step target (< 5s); fix hot spots in normalization/diffing.
- Bulk re-analysis flow for detector version bumps.
- Error handling: malformed JSONL, partial sessions, unknown tool names → degrade gracefully, never crash the pipeline; unknown tools classified `neutral` and counted so mapping gaps are visible.

## Phase 8b — Real-corpus validation (dogfooding pass)

This is where real sessions finally come in — as validation, not as test fixtures.

**Tasks:**
1. Run all detectors over your full personal session history (including the sessions from building this very feature).
2. Review every finding; label confirm / false-positive via the Phase 6 UI.
3. Triage outcomes:
   - **False positives** → each one becomes a new must-NOT-fire golden trace (reconstruct the pattern synthetically via the fixture-builder) + a suppression rule or threshold fix.
   - **Zero findings across the corpus** → diagnostic in itself: loosen thresholds experimentally (e.g., N=2) and re-run to see whether the detectors are too tight or your sessions are genuinely clean.
   - **Confirmed findings** → your first real labeled data, and your first landing-page anecdotes.

**Acceptance:** every finding on the real corpus has a label; false-positive rate per detector is computed and displayed on the detector-health view; any discovered false-positive pattern has a corresponding regression fixture.

---

## Intervention layer — phases I0–I6 (SPEC §10)

Same rules as phases 0–8b: implement → typecheck + tests passing → commit; one phase per session. Invariant tests I-1…I-6 land in I0 and run in every subsequent phase. Prefix `I` avoids collision with the observability phase numbers.

### Phase I0 — Schema + invariant tests

1. `InterventionEvent` store in both paths: Dexie (`src/lib/db/`) and Postgres (Drizzle schema), covered by the encrypted sync layer with the same batched-write pattern as Findings (decisions log #3).
2. Content-hash id generation per decisions log #6; DetectorRun linkage for auto events.
3. All six invariant tests from SPEC §10.3, red-green where implementable (I-5 determinism, I-3 re-run protection, I-4 encryption round-trip).

**Acceptance:** invariant tests pass; a hand-inserted event round-trips through encryption/sync; re-inserting the same auto event is a no-op.

### Phase I1 — Interrupt + rejection detectors

1. Fixture corpus: sanitized real traces containing known interrupts and tool rejections (Jacob provides; sanitize before committing to `tests/golden-traces/`). Marker matching is built from the corpus, not assumed strings.
2. Both detectors implemented via the existing `Detector` registry, running in the Web Worker.
3. Timeline rendering: intervention events appear in the session browser alongside Finding markers — one timeline, two visually distinct streams.

**Acceptance:** on a fixture with K known interrupts/rejections, exactly K events at correct indices; zero false positives on a clean fixture; invariants I-5/I-6 pass.

### Phase I2 — Joins, metrics, abandonment, summary card ★ reframe milestone

1. Query-time Finding↔intervention join (window W from DetectorConfig); per-Finding missed/responded, per-intervention responsive/proactive.
2. Latency, miss-rate, blind-spot-rate, takeover-ratio metrics.
3. Abandonment tagging (join-derived; regenerated when Findings re-run — see SPEC §10.4).
4. Session summary card: "3 findings, 2 caught, avg response 6 messages."

**★ This is the phase where the attention-routing reframe becomes demoable.** Everything before it is still "failure detection." The summary card plus the I2 metrics are the first artifacts that answer "when did your attention matter?" — treat the card's legibility as a first-class acceptance concern, not a UI afterthought.

**Acceptance:** correct latency on synthetic fixtures covering: Finding at session end, multiple Findings before one intervention, intervention before any Finding, W boundaries in both message-count and wall-clock dimensions.

### Phase I3 — Manual tagging UI + review disposition

1. Tag any message: select → type → optional note. Same interaction pattern as Finding labeling.
2. Confirm / retype / dismiss on auto events (`status` lifecycle); review-queue shell.
3. Dismissals stored, never deleted.

**Flywheel note:** the dispositions collected here are the labeled corpus for I4's precision gate *and* the long-term moat (classifier tuning is roadmap, but the data collection is not). Don't cut schema corners — a dismissal without its event's full evidence is worthless as training signal.

**Acceptance:** full status lifecycle tested; invariant I-3 verified with a re-detection test (re-run never clobbers status/notes).

### Phase I4 — Corrective re-prompt heuristic

1. Client-side lexical + structural scorer per SPEC §10.4 — no LLM calls (invariant I-1); weights and thresholds in DetectorConfig.
2. High-confidence events → timeline as `active`; mid-band → review queue via I3 UI. Evidence includes matched patterns + score breakdown (invariant I-6).
3. Hand-label ≥ 50 real user messages via I3 tagging (seed corpus: Jacob's own sessions).

**Acceptance:** precision ≥ 0.8 on the labeled set; recall measured and reported, not gated.

### Phase I5 — Manual takeover detection

Per SPEC §10.4: per-session write-hash map, mismatch on later reads → candidate scaled by diff magnitude. Glob-excluded artifacts (DetectorConfig), formatter-scale diffs → low confidence → review queue, concurrent sessions documented in-app as a v1 limitation.

**Acceptance:** detects a seeded takeover fixture; does not fire on a formatter-only fixture; limitation copy present in-app.

### Phase I6 — Positioning, copy, dashboard inversion

1. **Dashboard hierarchy inversion — mockup pass first, then build.** Today the dashboard leads with finding counts. Under the reframe, the headline is "where did your attention matter?" (miss rate + response latency trend over time — the longitudinal view only Chatdex has); per-detector finding counts become the drill-down. Sketch/agree on the hierarchy before writing copy.
2. Copy changes per `chatdex-intervention-update-v2.md` Part 1 (benefit line, pitch, repo description, roadmap vision line).
3. "How detection works" page gains the intervention detectors and their documented limits.

**Acceptance:** dashboard renders the attention-centric hierarchy against the real corpus; numbers reconcile with raw event counts; no UI or doc anywhere describes interventions as a fourth failure mode.

### Out of scope (roadmap; do not build)

- Opt-in LLM classification mode (separate spec amendment with privacy treatment)
- Cross-user / cross-domain aggregation and benchmarking
- Heuristic weight tuning loop on dismissal data (data is collected; the loop is later)
- Disposition carry-forward across detector version bumps
- Multi-session concurrent-repo takeover attribution

---

## Testing strategy summary

- **Golden traces are the contract.** Any detector change that alters golden-trace results requires either fixing the detector or consciously updating expectations + bumping the detector version.
- **Suppression rules get equal test weight to detection rules.** A detector that fires on legitimate behavior is worse than one that misses — false positives kill trust.
- Unit tests for normalization/signatures/classification; integration tests via golden traces; one performance test with the synthetic 10k-step session.

## Suggested prompts for Claude Code, per phase

- Phase 0: "Read CLAUDE.md and SPEC-agent-observability.md. Set up the golden-trace test harness per IMPLEMENTATION_PLAN.md Phase 0. I'll provide sanitized JSONL fixtures; start with the runner and expectations format."
- Phases 1–5: "Implement Phase N per IMPLEMENTATION_PLAN.md. Do not start the next phase. Run typecheck and the golden-trace suite before reporting done."
- After each phase: "Show me which golden traces pass/fail and any deviations from the spec you had to make."

Keep one phase per session where possible — it keeps Claude Code's context focused and gives you natural checkpoints (and clean per-phase traces to feed back into Chatdex, which is pleasingly recursive).

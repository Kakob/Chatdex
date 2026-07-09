# Chatdex Agent Observability — Implementation Plan

Companion to `SPEC-agent-observability.md`. Phases are ordered so that every phase ends with something runnable and testable. Work with Claude Code one phase at a time; don't start a phase until the previous phase's acceptance criteria pass.

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
3. Storage: IndexedDB stores for `Finding` and `DetectorRun`; extend the encrypted sync layer to cover both.
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

## Testing strategy summary

- **Golden traces are the contract.** Any detector change that alters golden-trace results requires either fixing the detector or consciously updating expectations + bumping the detector version.
- **Suppression rules get equal test weight to detection rules.** A detector that fires on legitimate behavior is worse than one that misses — false positives kill trust.
- Unit tests for normalization/signatures/classification; integration tests via golden traces; one performance test with the synthetic 10k-step session.

## Suggested prompts for Claude Code, per phase

- Phase 0: "Read CLAUDE.md and SPEC-agent-observability.md. Set up the golden-trace test harness per IMPLEMENTATION_PLAN.md Phase 0. I'll provide sanitized JSONL fixtures; start with the runner and expectations format."
- Phases 1–5: "Implement Phase N per IMPLEMENTATION_PLAN.md. Do not start the next phase. Run typecheck and the golden-trace suite before reporting done."
- After each phase: "Show me which golden traces pass/fail and any deviations from the spec you had to make."

Keep one phase per session where possible — it keeps Claude Code's context focused and gives you natural checkpoints (and clean per-phase traces to feed back into Chatdex, which is pleasingly recursive).

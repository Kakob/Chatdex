# Chatdex — Agent Observability Layer: Specification

**Status:** Draft v1 + intervention amendment (§10) · **Owner:** Jacob · **Last updated:** 2026-07-09

---

## 1. Context and scope

### What Chatdex is today

Chatdex ingests Claude Code session traces (JSONL), lets the user browse and search their conversations, and provides analytics over their corpus. All session data is local-first: stored in IndexedDB, optionally synced to Postgres as ciphertext encrypted client-side with AES-GCM (the master key is unlocked via WebAuthn+PRF, with a recovery-code fallback — this spec does not name or constrain the key-wrapping mechanism beyond "client-side only"). The server never sees plaintext.

### What this spec adds

An **agent observability layer**: a detection engine that runs over ingested sessions and surfaces *agent failure patterns* — places where the trajectory went wrong, independent of whether the final output looked fine. This turns Chatdex from a trace browser into a longitudinal agent evaluation instrument.

### Non-goals (v1)

- No server-side ML or embedding pipelines (violates the encryption model; see §7).
- No real-time/streaming detection during a live session. v1 analyzes completed or ingested sessions.
- No automated remediation. Chatdex diagnoses; it does not intervene.
- No support for non-Claude-Code trace formats (OpenAI, LangSmith, etc.). Format adapters are a later concern.

---

## 2. The three v1 detectors

All v1 detectors are **deterministic and rule-based**. This is deliberate: rules ship fast, are explainable to the user ("here is exactly why this fired"), and establish labeled ground truth for future ML tiers. Each detector's known blind spots are documented in §6 and shown in the UI, not hidden.

### 2.1 Loop detection

**Definition:** The agent repeats the same action or short action-sequence without intervening progress.

**Mechanism:**
1. Normalize each tool call into a **signature**: `tool_name + canonicalized_args`.
   - Canonicalization: resolve file paths to a normal form, strip whitespace, drop volatile fields (timestamps, request IDs, random ports).
2. Slide a window over the session's signature stream. Flag when:
   - The same signature repeats **N times within M steps** (defaults: N=3, M=10, configurable), OR
   - The same short sequence of signatures (length 2–4) repeats ≥2 times consecutively.
3. **Suppression rules** (to avoid false positives on legitimate repetition):
   - A whitelist of retry-shaped patterns (polling a build, re-running a watcher, retrying a network call with backoff).
   - Require **absence of intervening state change**: if a file edit or environment change occurred between repeats, the loop candidate is downgraded or dropped.

**Output:** A `LoopFinding` spanning the repeated steps, with the normalized signature, repeat count, and the suppression checks that were evaluated.

### 2.2 Verification-absence detection

**Definition:** The agent performs a state-changing action and moves on (or claims success) without verifying the result.

**Mechanism:**
1. Classify each tool call via a curated mapping into:
   - **State-changing:** file writes/edits, migrations, deploy/build commands, package installs, git commits.
   - **Verification-shaped:** test runs, read-backs of edited files, curl/health checks, linter/type-checker runs, build-success checks.
   - **Neutral:** everything else (reads, searches, navigation).
2. After each state-changing action, scan forward until the session moves to a new task (topic-shift heuristic: new user message, or explicit task transition in agent text) or terminates.
3. Flag if no verification-shaped action occurs in that span.
4. **Severity escalation:** if the agent's text asserts success ("tests should pass now", "this fixes the bug") with no verification action following, flag at **high severity**. Asserted-but-unverified is the most dangerous variant.

**Output:** A `VerificationAbsenceFinding` anchored on the state-changing step, with the scanned span, whether a success assertion was detected, and the classification of every tool call in the span (for explainability).

### 2.3 Silent reversion detection

**Definition:** A later edit restores a file region to a prior state without the agent acknowledging the reversal.

**Mechanism:**
1. Maintain a **per-file edit timeline**: every edit hunk applied to each file, in order.
2. Diff each new hunk against earlier hunks on the same file. Flag when a later edit restores a region to a previously seen state (textual hunk match after normalization).
3. "Silent" qualifier: check the agent's reasoning text around the reverting edit for acknowledgment language ("reverting", "undoing", "going back to"). If acknowledgment is present, downgrade to informational; if absent, flag as a **silent reversion**.
4. **Cross-reference with loop detection:** an edit→revert→edit cycle on one file is both a reversion and a loop candidate; the detectors share the normalization machinery and link their findings.

**Output:** A `ReversionFinding` with the file path, the two edit steps involved, the restored region, and the silent/acknowledged classification.

---

## 3. Data model

New entities, all stored under the same encryption regime as sessions (plaintext in IndexedDB locally, ciphertext in Postgres if synced).

```
Finding
├─ id: uuid
├─ session_id: fk → Session
├─ detector: enum { loop, verification_absence, silent_reversion }
├─ severity: enum { info, low, medium, high }
├─ step_range: { start_index, end_index }   // anchors into the session's step stream
├─ summary: string                           // one-line human-readable description
├─ evidence: json                            // detector-specific payload (signatures, spans, hunks)
├─ suppressions_evaluated: json              // which suppression rules ran and their outcomes
├─ detector_version: string                  // semver of the detector that produced this
├─ created_at: timestamp
└─ user_label: enum { unset, confirmed, false_positive } // ground-truth labeling, see §5

DetectorRun
├─ id: uuid
├─ session_id: fk → Session
├─ detector_versions: json                   // versions of each detector in this run
├─ config: json                              // thresholds used (N, M, whitelists)
├─ started_at / finished_at: timestamps
└─ findings_count: int
```

**Design rules:**
- Findings are **immutable per detector version**. Re-running a newer detector creates new findings rather than mutating old ones — this preserves the longitudinal record and makes detector improvements auditable.
- `evidence` must always contain enough to re-render the "why this fired" explanation without re-running the detector.
- Step indices anchor findings to the trace; the UI resolves them lazily against the stored session.

---

## 4. Detection pipeline

```
Ingest JSONL ──► Parse & normalize steps ──► Detector registry
                                              ├─ LoopDetector
                                              ├─ VerificationAbsenceDetector
                                              └─ ReversionDetector
                                                     │
                                              Findings + DetectorRun
                                                     │
                                              IndexedDB (plaintext, local)
                                                     │ (opt-in sync)
                                              Postgres (ciphertext)
```

**Execution requirements:**
- **Client-side only.** Detection runs in the browser against locally stored sessions. Nothing leaves the machine unencrypted.
- Runs in a **Web Worker** so a large session (10k+ steps) never blocks the UI. Target: full three-detector pass on a 10k-step session in < 5 seconds on a mid-range laptop.
- **Idempotent per (session, detector_version, config).** Re-running with unchanged inputs produces no duplicate findings.
- Triggered: (a) automatically on ingest of a new session, (b) manually via a "re-analyze" action, (c) in bulk when a detector version bumps ("re-analyze all sessions with the new detector").

**Detector interface (contract for all current and future detectors):**

```typescript
interface Detector {
  id: string;                 // "loop", "verification_absence", ...
  version: string;            // semver, bumped on any behavior change
  defaultConfig: DetectorConfig;
  run(session: NormalizedSession, config: DetectorConfig): Finding[];
}
```

Adding a detector must require zero changes outside registering it — the pipeline, storage, and UI are detector-agnostic and driven by the registry.

---

## 5. User-facing surface

### 5.1 Session view — findings overlay

- Findings render as **inline markers** in the existing session browser, anchored at their step ranges, color-coded by severity.
- Clicking a finding opens an **evidence panel**: the summary, the exact rule that fired, the suppression checks that ran, and the raw steps involved. Explainability is a product feature, not a debug view.
- Each finding has **Confirm / False positive** buttons. Labels are stored on the finding (`user_label`) and become the ground-truth dataset for the future ML tier. This is the cheapest, highest-leverage thing v1 can do for the roadmap.

### 5.2 Observability dashboard

Extends the existing analytics area:
- **Findings over time:** count by detector and severity, per week/month — the longitudinal view that is Chatdex's core differentiator vs. one-shot trace viewers.
- **Per-project breakdown** (derived from workspace paths in traces): which projects accumulate which failure shapes.
- **Detector health:** false-positive rate per detector from user labels, surfaced honestly.

### 5.3 Session report

A per-session summary block at the top of the session view: finding counts by severity, plus a "cleanest/messiest span" indicator. Keep it small; the inline markers carry the detail.

---

## 6. Known limits (documented, shown in UI)

| Detector | Blind spot | Roadmap answer |
|---|---|---|
| Loop | Semantic loops — same failing strategy, rephrased differently each time | Client-side embedding similarity over a sliding window |
| Verification-absence | Curated tool mapping has gaps for uncommon toolchains | Lightweight classifier trained on user-labeled segments |
| Silent reversion | Semantically equivalent but textually different reversions (function rewritten back to original behavior with different code) | AST-level or embedding-based comparison |

These limits appear in a "How detection works" page in-app. Honesty about heuristic ceilings is part of the positioning.

---

## 7. Architectural constraint: encryption shapes the roadmap

The local-first encryption model is a hard constraint, not a preference:

- Any future ML tier must either (a) ship as **client-side models** (e.g., small embedding models via WASM/WebGPU), or (b) run on **explicitly opt-in decrypted data**. Default remains: server sees ciphertext only.
- User labels (§5.1) sync under the same encryption as findings. If Chatdex ever wants aggregate cross-user pattern data, that is a separate, explicit, opt-in consent flow — out of scope for this spec.

---

## 8. Roadmap beyond v1 (for context, not implementation)

1. **Embedding-based semantic loop detection** (client-side model).
2. **Learned verification classifier** trained on accumulated user labels.
3. **AST-aware reversion detection.**
4. **Cross-session pattern aggregation:** "this failure shape recurs across your projects," computed client-side.

The through-line: rules first to establish explainable ground truth; ML only where the rules' failure modes are already understood and documented.

---

## 9. Success criteria for v1

- All three detectors run automatically on ingest and pass the golden-trace test suite (see IMPLEMENTATION_PLAN.md §Testing).
- A 10k-step session analyzes in < 5s without blocking the UI.
- Every finding renders a complete "why this fired" explanation from stored evidence alone.
- User labeling works end-to-end and labels persist under encryption.
- Dashboard shows findings-over-time for the user's real corpus.
- Zero plaintext session or finding data reaches the server.

---

## 10. Amendment (2026-07-09): Intervention detection & attention-routing

Source: `chatdex-intervention-update-v2.md` (Parts 2–3 merged here; Part 1 positioning stays in that doc until the copy phase ships). Implementation phases: `AGENT-OBSERVABILITY-IMPLEMENTATION_PLAN.md` phases I0–I6.

**Framing:** Findings describe agent behavior; **interventions** describe user behavior. The product insight is their relationship — each Finding is *missed* or *responded*, each intervention *responsive* or *proactive*, and the gap between Finding and intervention is measurable cost. Interventions are never a "fourth failure mode"; they are a second event stream.

### 10.1 Data model: `InterventionEvent`

```
InterventionEvent {
  id: string                    // deterministic content hash of
                                //   (session_id, message_index, type, detector_version, config_hash)
                                //   for source=auto; random for source=user.
                                //   Required for idempotent re-ingestion. config_hash is included
                                //   so two runs at the same version with different DetectorConfig
                                //   produce distinct events rather than silently overwriting.
                                //   Caveat: message_index participates in the hash, so a parser
                                //   change that shifts indices churns auto-event ids (accepted;
                                //   see invariant I-3).
  session_id: fk -> Session
  message_index: int            // position in the transcript
  timestamp: datetime           // from trace
  type: enum {
    hard_interrupt,             // user hit escape mid-generation
    tool_rejection,             // user denied a tool permission request
    corrective_reprompt,        // user message redirects/contradicts agent's prior action
    manual_takeover,            // user edited files outside the agent
    abandonment                 // session ends unresolved shortly after a Finding
  }
  source: enum { auto, user }
  status: enum { active, confirmed, dismissed }   // user's disposition of auto events;
                                                  //   user-created events start confirmed
  confidence: float | null      // detector confidence; null for source=user
  evidence: json                // detector-specific payload sufficient to re-render
                                //   the event without re-parsing the trace (same rule as Findings)
  detector_run_id: fk | null    // pins auto events to the DetectorRun that produced them;
                                //   null for source=user
  notes: text | null            // user-supplied context
}
```

No stored relationships between the streams (no `linked_failure_id`). The Finding↔intervention join is computed at query time by session + message position + timestamp, against Findings from a specified DetectorRun (default: latest). This keeps interventions valid across detector re-runs, since Findings are immutable per detector version.

### 10.2 Derived metrics (computed at query time, never stored)

- **Intervention rate**: interventions per session / per N agent messages
- **Response latency**: time and message count from Finding → first subsequent intervention
- **Miss rate**: Findings with no intervention within window W
- **Blind-spot rate**: interventions with no Finding within window W
- **Takeover ratio**: manual_takeover count / total interventions

**Window W** is a `DetectorConfig` value (default: 10 messages or 15 minutes, whichever first), so it is pinned in DetectorRun provenance and tunable without code changes.

### 10.3 Invariants (load-bearing — tests land in phase I0 and run in every subsequent phase)

- **I-1.** Intervention detection and analysis run entirely client-side. No code path sends decrypted session content to any third-party API. (Restates §4/§7; listed here because this amendment is where the temptation to violate them lives.)
- **I-2.** An InterventionEvent never mutates the Findings stream. Read-only, query-time joins only.
- **I-3.** Re-running detection never modifies `source=user` events, and never modifies `status`/`notes` on `source=auto` events. A detector version or config bump produces new auto events with new ids, which start `active`; prior dispositions remain stored on superseded rows (labeled data, never deleted) but do **not** carry forward — matching Findings behavior (`userLabel` resets on new DetectorRuns). Carry-forward by `(session_id, message_index, type)` is roadmap, not v1.
- **I-4.** Intervention events derived from trace content are encrypted client-side with the existing AES-GCM pipeline. No plaintext trace content in Postgres.
- **I-5.** Deterministic re-runs: identical trace + detector version + config → identical `source=auto` event set, ids included.
- **I-6.** Every `source=auto` event has non-null `evidence` and `detector_run_id`, and is re-renderable in the UI from `evidence` alone.

### 10.4 Intervention detectors (by phase; details and acceptance criteria in the implementation plan)

- **I1 — Hard interrupts + tool rejections** (deterministic, fixture-driven marker matching, confidence 1.0, runs in the existing Web Worker).
- **I2 — Finding↔intervention timing + abandonment** (pure query-time computation; classifies Findings missed/responded and interventions responsive/proactive; session summary card). Abandonment is the one intervention type derived from the join itself: valid only relative to the Findings DetectorRun it was computed against, regenerated when Findings re-run.
- **I3 — Manual tagging UI + review disposition** (confirm/retype/dismiss lifecycle; ships before the classifier so the review-queue UI exists and real tagging builds the labeled corpus).
- **I4 — Corrective re-prompts** (client-side lexical + structural heuristic classifier; weights/thresholds in DetectorConfig; precision ≥ 0.8 gate on a hand-labeled set of ≥ 50 real messages; recall reported, not gated). An opt-in LLM classification mode is explicitly out of scope and requires its own amendment (see §7).
- **I5 — Manual takeover detection** (per-session `file_path → hash(last agent write)` map; mismatch on later reads → candidate; glob-excluded artifacts, low confidence for formatter-scale diffs, concurrent sessions documented as a v1 limitation).
- **I6 — Positioning/copy updates** (last, so the product matches the claims when the words change).

### 10.5 User-facing surface additions

- One timeline, two visually distinct event streams: interventions render alongside Finding markers in the session browser; same tagging interaction pattern as Finding labeling.
- Review queue for mid-confidence I4/I5 candidates ("Chatdex thinks you intervened here — did you?"). Dismissals are stored, never deleted — they are the labeled-data flywheel.
- Session summary card ("3 findings, 2 caught, avg response 6 messages") — the first surface that speaks the attention-routing language.
- Dashboard: attention-centric headline (miss rate + response latency trend over time), with per-detector Finding counts as drill-down rather than headline. The known-limits table in §6 gains rows for the intervention detectors.

### 10.6 Success criteria for the amendment

- All six invariants (I-1…I-6) covered by tests that run in every phase.
- Golden-trace suite extended with intervention fixtures; all pass.
- I4 precision gate met on the hand-labeled corpus.
- Session summary card and dashboard attention metrics reconcile with raw event counts.
- Zero plaintext intervention data reaches the server.

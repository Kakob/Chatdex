# SPEC Amendment: Intervention Detection & Attention-Routing Reframe

> **Status**: Approved 2026-07-09. Parts 2–3 are merged into `SPEC-agent-observability.md` §10 and the phases into `AGENT-OBSERVABILITY-IMPLEMENTATION_PLAN.md` (phases I0–I6) — those copies are authoritative for implementation. Part 1 (positioning) remains authoritative here until phase I6 lands the copy changes in the product.
>
> **v2 changes**: LLM classification removed from the client path (privacy invariant violation); stale KDF reference removed; `linked_failure_id` FK dropped in favor of query-time joins; deterministic content-hash ids; phase numbering unified and reordered so tagging UI precedes the classifier; `status` field added for dismissals; evidence + DetectorRun provenance added, making interventions first-class alongside Findings; terminology aligned to Findings; window config routed through DetectorConfig.
>
> **v2.1 changes (2026-07-09)**: config hash added to the content-hash id; disposition-reset-on-version-bump decision documented (matches existing Findings behavior); abandonment's coupling to the Findings DetectorRun made explicit; `message_index` id-churn caveat noted.

---

## Part 1 — Positioning Update

### New framing

Chatdex is an **attention-routing instrument** for people who build with AI agents. It answers one question: *when does your attention actually matter?*

Finding detection is the mechanism. Intervention analysis is the product. The core insight Chatdex surfaces is the relationship between the two:

- **Finding with no intervention nearby** → the user missed it (or the detector is wrong — both are useful)
- **Intervention with no Finding nearby** → the user is steering proactively, or the detectors have a blind spot
- **Finding → intervention** → the system working as intended; the gap between them is measurable cost

### Copy changes

- Anywhere the app leads with "failure pattern detection," the benefit-level line is: **"Chatdex tells you when your agents actually need you."**
- One-sentence pitch (discovery calls / landing page): *"Everyone running coding agents feels the ambient 'is it fine? do I need to check?' anxiety. Chatdex reads your session traces and shows you exactly where your attention was needed — and where it wasn't."*
- GitHub repo description: *"Know when your coding agents need you. Failure detection + intervention analysis for Claude Code session traces."*
- Long-term vision line (roadmap/about only, not v1 claims): mapping the human/AI intervention boundary across domains.

### What NOT to change

- Do not remove or rename the three shipped detectors (loop, verification-absence, reversion). They are the substrate the intervention layer joins against.
- Do not describe interventions as a "fourth failure mode" anywhere in UI or docs. Findings describe agent behavior; interventions describe user behavior.

---

## Part 2 — Data Model

### Core principle

**Interventions are a separate event stream from Findings**, joined at query time by session + message position + timestamp. No stored relationships between the streams. Interventions follow the same explainability and provenance rules as Findings: every auto-detected event is re-renderable from its stored evidence and pinned to the DetectorRun that produced it.

### New entity: `InterventionEvent`

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
                                //   see the version-bump note under invariant 3).
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
                                //   the event without re-parsing the trace
                                //   (same rule as Findings)
  detector_run_id: fk | null    // pins auto events to the DetectorRun (versions + config)
                                //   that produced them; null for source=user
  notes: text | null            // user-supplied context
}
```

No `linked_failure_id`. The Finding↔intervention join is computed at query time, same as every other derived relationship (see metrics below). This keeps interventions valid across detector re-runs, since Findings are immutable per detector version and re-runs create new Finding rows under a new DetectorRun.

### Derived metrics (computed at query time, never stored)

All joins are against Findings from a specified DetectorRun (default: latest).

- **Intervention rate**: interventions per session / per N agent messages
- **Response latency**: time and message count from Finding → first subsequent intervention
- **Miss rate**: Findings with no intervention within window W
- **Blind-spot rate**: interventions with no Finding within window W
- **Takeover ratio**: manual_takeover count / total interventions

**Window W** is a `DetectorConfig` value (default: 10 messages or 15 minutes, whichever first) per the no-magic-numbers rule, so it is pinned in DetectorRun provenance and tunable without code changes.

### Invariants (load-bearing — tests required, landing in Phase 0)

1. Intervention detection and analysis run entirely client-side. No code path sends decrypted session content to any third-party API. (Restates CLAUDE.md invariants #1–2; listed here because this amendment is where the temptation to violate them lives.)
2. An InterventionEvent never mutates the Findings stream. Read-only, query-time joins only.
3. Re-running detection never modifies `source=user` events, and never modifies the `status` or `notes` fields of `source=auto` events. A re-run may add new auto events and supersede its own prior auto events (new DetectorRun), but a user's dismissal or confirmation is user data and survives all re-runs.
   **Version-bump note (decided 2026-07-09):** a detector version or config bump produces new auto events with new ids, which start `active`. Prior dispositions remain stored on the superseded rows (they are labeled data and are never deleted) but do **not** carry forward to the new rows. This matches the existing Findings behavior — `userLabel` resets to `unset` on new DetectorRuns, with no carry-forward. Carry-forward by `(session_id, message_index, type)` matching is roadmap, not v1.
4. Intervention events derived from trace content are encrypted client-side with the existing client-side AES-GCM encryption pipeline. No plaintext trace content in Postgres. (Key wrapping is whatever the pipeline currently does — this spec does not name or constrain the KDF/wrapping mechanism.)
5. Deterministic re-runs: identical trace + identical detector version + identical config → identical `source=auto` event set, ids included.
6. Every `source=auto` event has non-null `evidence` and `detector_run_id`, and is re-renderable in the UI from `evidence` alone.

---

## Part 3 — Detection Spec (by phase; numbering matches Part 5)

### Phase 1: Hard interrupts + tool rejections (deterministic, heuristic, client-side)

- **Hard interrupt**: scan user-role messages for the interrupt markers Claude Code writes into transcripts (`[Request interrupted by user]` variants). Marker strings vary by CC version — build the matcher from a fixture corpus of real traces, not assumptions. Evidence: the matched message excerpt + marker variant. Confidence: 1.0.
- **Tool rejection**: permission denials appear as denial-shaped tool results following a tool_use. Fixture-driven matching, same as above. Evidence: tool name + denial payload shape. Confidence: 1.0.
- Runs in the existing Web Worker alongside the three shipped detectors.
- **Acceptance criteria**: on a fixture trace with K known interrupts/rejections, detector emits exactly K events at correct message indices; zero false positives on a clean fixture; invariant tests 5–6 pass.

### Phase 2: Finding↔intervention timing + abandonment (pure computation)

- No new detection. Query-time join of Phase 1 events against Findings (latest DetectorRun by default).
- Per Finding: first intervention within window W → latency in messages and wall-clock time; classify each Finding as **missed / responded**, each intervention as **responsive / proactive**.
- **Abandonment**: session's last events include an unresolved Finding and the session ends within W with no success signal → emit abandonment event (auto, evidence = the trailing Finding reference + session-end timestamps). Abandonment is the one intervention type derived from the join itself: an abandonment event is only valid relative to the Findings DetectorRun it was computed against (pinned via its `detector_run_id`) and is regenerated whenever Findings re-run under a new DetectorRun.
- Session summary card: "3 findings, 2 caught, avg response 6 messages."
- **Acceptance criteria**: correct latency on synthetic fixtures covering: Finding at session end, multiple Findings before one intervention, intervention before any Finding, W boundary conditions in both message-count and wall-clock dimensions.

### Phase 3: Manual tagging UI + review disposition (moved before the classifier)

- Any message in the session browser can be tagged as an intervention: select message → type → optional note. Same interaction pattern as browsing Findings; one timeline, two visually distinct event streams.
- Auto events get confirm / retype / dismiss controls (`status` transitions). Dismissals are stored, never deleted — they are labeled data for tuning Phase 4.
- Ships before the classifier so (a) the review-queue UI exists when the classifier needs it, and (b) Jacob's own tagging on real sessions builds the labeled corpus Phase 4's precision gate requires.
- **Acceptance criteria**: full status lifecycle covered by tests; invariant 3 (re-runs never clobber status/notes) verified with a re-detection test.

### Phase 4: Corrective re-prompts (client-side heuristic classifier)

- **Definition**: a user message that contradicts, redirects, or overrides the agent's immediately preceding plan or action.
- **Implementation — client-side heuristics only** (invariant 1; there is no LLM detection infra and plaintext must not leave the client):
  - *Lexical*: leading imperative-contradiction patterns ("no," "stop," "wait," "don't," "undo," "revert," "that's wrong," "not that," "go back"), negation of the agent's prior verb phrase, short-message + imperative-mood structure.
  - *Structural*: adjacency to a Phase 1 event (message immediately following a hard interrupt or tool rejection is corrective with high prior); message length ratio vs. surrounding prompts; absence of a new task statement.
  - Score = weighted combination; weights and threshold live in DetectorConfig.
- Events at confidence ≥ high-threshold go on the timeline as `active`; mid-band candidates go to the review queue ("Chatdex thinks you intervened here — did you?") for confirm/dismiss via Phase 3 UI. Evidence: matched patterns + structural signals + score breakdown (re-renderable per invariant 6).
- **Acceptance criteria**: precision ≥ 0.8 on a hand-labeled set of ≥ 50 real user messages (seeded from Jacob's own sessions via Phase 3 tagging); recall measured and reported, not gated in v1.
- **Explicit non-goal / roadmap note**: an opt-in LLM classification mode (user knowingly sends selected message pairs to an API, with the privacy tradeoff stated in-product) is possible future work but requires its own spec amendment. It is not part of this update and must not be built as a side effect.

### Phase 5: Manual takeover detection (inferential — hardest, highest value)

- **Signal**: a later Read/tool result shows file content inconsistent with the agent's last known write to that path → out-of-band edit.
- Implementation: per-session map `file_path → hash(last agent-written content)`; on subsequent reads, compare; mismatch → candidate event, confidence scaled by diff magnitude. All client-side.
- **False-positive guards (explicit)**: generated/build artifacts excluded via glob config (DetectorConfig); small mechanical diffs (formatters, hooks) score low confidence and route to review queue; concurrent agent sessions on one repo are out of scope v1 and documented in-app as a limitation.
- Evidence: file path, both content hashes, diff summary stats (not raw diff content beyond what the trace already contains).
- **Acceptance criteria**: detects a seeded takeover fixture; does not fire on a formatter-only fixture; limitation copy present in-app.

### Phase 6: Positioning/copy updates (Part 1) — last, so the product matches the claims when the words change.

---

## Part 4 — Implementation Plan Summary

Each phase: implement → tests passing → commit. Phase 0 invariant tests run in every subsequent phase.

- **Phase 0** — Schema: `InterventionEvent` in both IndexedDB and Postgres paths, encryption coverage, content-hash id generation, DetectorRun linkage, all six invariant tests.
- **Phase 1** — Interrupt + rejection detectors (Web Worker), fixture corpus from real traces, timeline rendering of the second event stream.
- **Phase 2** — Query-time joins, latency/miss/blind-spot/takeover metrics, abandonment, session summary card.
- **Phase 3** — Manual tagging UI, confirm/retype/dismiss lifecycle, review queue shell.
- **Phase 4** — Corrective re-prompt heuristic detector + review-queue integration + labeled-set precision gate.
- **Phase 5** — Takeover detection with false-positive guards and documented limitations.
- **Phase 6** — Copy/positioning per Part 1.

### Out of scope for this amendment (roadmap; do not build)

- Opt-in LLM classification mode (requires separate spec amendment with privacy treatment)
- Cross-user / cross-domain aggregation and benchmarking
- Heuristic weight tuning loop on dismissal data (the data is collected; the loop is later)
- Multi-session concurrent-repo takeover attribution

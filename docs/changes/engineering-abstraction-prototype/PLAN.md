# Engineering abstraction prototype — "Refactor a guarantee, not a function"

Status: In progress (Checkpoint 0 done; Checkpoint 1 vertical slice in progress)
Primary capability: [Understanding Workspace](../../capabilities/understanding-workspace/PRD.md)
Related: [Change Workspace](../../capabilities/change-workspace/SPEC.md) (handoff/verification
vocabulary, unchanged), [Repository Integration](../../capabilities/repository-integration/SPEC.md)
(revision pinning, unchanged — no new GitHub calls), [Editable landscape](../editable-landscape/PLAN.md)
(concept/statement shapes reused).
Handoff: [CHATDEX_ENGINEERING_ABSTRACTION_PROTOTYPE_HANDOFF.md](./CHATDEX_ENGINEERING_ABSTRACTION_PROTOTYPE_HANDOFF.md)
Branch: `feature/engineering-abstraction-prototype`

## Problem

Chatdex can name the parts of a project (concepts) and what is believed about them (statements),
but it cannot say what *follows* from changing one of them. The prototype shows one consequential
change made at the level of meaning: an event queue's delivery guarantee moves from "remove on
dispatch" to "ack after processing", Chatdex derives the engineering obligations with an
explainable chain, the change is handed to an implementer outside Chatdex, and real test results at
real commits come back and are reconciled against the model.

## Reconnaissance (Checkpoint 0, 2026-11-12, `main` @ `5198800`)

Reuse points verified in source:

| Need | Existing piece | Use |
|---|---|---|
| Concept identity + containment | `LandscapeRegion` (`src/types/landscape.ts`) | Concept rows use this exact type |
| Statements (behavior, guarantee, limitation) | `UnderstandingObject` + `UnderstandingEvent` (`src/types/understanding.ts`) | Statement and history rows use these exact types; review state stays separate from evidence |
| Revision-pinned code locations | `CodeEvidence` (`repoKey`, `sha`, `path`, lines, `quoteHash`) in `src/types/evidence.ts` | Binding observations carry the same fields |
| Test evidence | `TestRuntimeEvidence` (`command`, `outcome`) | Imported test results map onto the same vocabulary |
| Handoff export | `src/lib/prepare/export.ts` (`renderPreparedChange{Markdown,Json}`) | Same deterministic, section-per-heading style; not called directly (it needs a `PreparedChange` in the synced DB) |
| Isolated unsynced store | `src/features/researchAtlas/storage.ts` (own Dexie DB `chatdex-research-atlas`) | Same pattern: own DB `chatdex-engineering-prototype` |

Baseline: recorded under Verification.

## Decisions

1. **Isolated, local-only store, not the main DB.** The handoff says to use synthetic data and never
   mutate personal projects. Writing a synthetic project into the main DB would put demo rows into
   the user's synced history (ciphertext, but still on their server and other devices). The
   prototype therefore uses its own Dexie database `chatdex-engineering-prototype`, never hooked
   into sync (CLAUDE.md invariant 1 untouched: nothing syncs). Rows reuse the `LandscapeRegion`,
   `UnderstandingObject`, and `UnderstandingEvent` types verbatim, so promoting the model into a real
   project later is a copy, not a translation. **Conflict noted with the handoff's suggested
   `/projects/:id/engineering` route:** the slice uses a standalone `/engineering` route labeled
   Experimental (same precedent as `/research`). Linking to a real project/Change Workspace is a
   follow-up, not part of this slice.
2. **No AI in the loop.** Relationships, rules, and the fixture are authored and labeled
   "Authored fixture"/"Rule pack". No provider call, no key needed. Nothing is presented as inferred.
3. **Obligations are derived, not stored.** `deriveImpact(model, change, rulePack)` is pure and
   deterministic. An obligation exists because a rule in the rule pack fires for the proposed
   contract values; its explanation is (contract change → rule → shortest relationship path from the
   contract's concept to the obligation's concept). Concepts reachable through relationships that no
   rule covers are reported **impact unknown**, never "no impact". An obligation whose concept is not
   reachable by any modeled relationship is flagged **model gap** (rule-only).
4. **Propagation direction per relation kind.** A change to X affects Y when `X requires Y`,
   `X constrains Y`, `X verified_by Y` (forward), or when `Y implements X`, `Y depends_on X`,
   `Y enables X`, `Y supports X` (reverse).
5. **Evidence comes only from an external, opt-in harness.** Chatdex runs nothing. A local script
   (`npm run queue:evidence`) runs the queue's tests and writes a JSON manifest pinned to a commit.
   The user imports the file. Dirty working trees produce manifests marked unpinned that are shown
   but never count as verification. Agent prose (notes) is labeled agent-reported and never changes a
   criterion's status.
6. **Bindings are path + symbol, observed per revision.** A binding names `path` and `symbol`;
   manifests observe every symbol (line range + SHA-256 of its text) at their commit. A binding the
   user confirmed at commit A is **stale** at commit B until re-confirmed, even when its text is
   unchanged; a symbol absent at B is **missing**. Nothing auto-refreshes.
7. **Accepting new understanding is explicit and partial.** Accept creates a new contract statement
   version and supersedes the old one (append-only events); every criterion without passing pinned
   evidence becomes an open question statement. Approving the proposal or importing evidence never
   accepts anything by itself.
8. **Failure scopes are separate contracts.** `worker_failure` (queue process survives) and
   `process_restart` (needs durable state) are distinct values with distinct obligations and
   criteria; an in-memory queue never satisfies `process_restart`.

## Shared contracts between workstreams

**Criterion IDs** (test names start with `[ID]`; the manifest maps tests by that prefix):

| ID | Criterion |
|---|---|
| EQ-C0 | First dispatch follows enqueue order; no global FIFO promise across retries |
| EQ-C1 | A completed (acknowledged) job is not dispatched again |
| EQ-C2 | A claimed but unacknowledged job can be reclaimed after its lease expires |
| EQ-C3 | A stale lease token cannot acknowledge a newer claim |
| EQ-C4 | Lease expiry can cause duplicate processing (documented, demonstrated) |
| EQ-C5 | An accepted job survives a worker failure before completion (queue process alive) |
| EQ-C6 | An accepted, unacknowledged job survives a queue process restart (durable) |
| EQ-C7 | Retries are bounded; exhausted jobs are dead-lettered, not silently dropped |

**Evidence manifest** `chatdex.engineering.evidence/v1` (written by
`examples/event-queue/scripts/capture-evidence.mjs`): `repository.remote`, `repository.root`,
`revision.{sha, dirty, dirtyScope, baseSha?}`, `changedPaths` (vs `baseSha`), `command`,
`environment`, `capturedAt`, `tests[] {id|null, name, file, status, durationMs, failureMessage?}`,
`symbols[] {path, symbol, startLine, endLine, sha256}`, `notes[]` (agent-reported, free text).
Symbols are top-level declarations (`createHarness`), class members (`EventQueue.claim`), and
criterion tests (`test:EQ-C5`).

## Plan

- **Checkpoint 1 — semantic slice (this session).**
  - A: `src/types/engineering.ts`, `src/lib/engineering/{model,impact,rules,fixture,bindings}.ts` + tests.
  - B: `examples/event-queue/` baseline: destructive `dequeue`, API-neutral harness, criterion tests
    (EQ-C5 fails at baseline by design), evidence capture script. Own vitest config, excluded from
    root `npm test`; `npm run queue:test`, `npm run queue:evidence`.
  - D: `src/lib/engineering/io/{manifest,handoff,verification}.ts` + tests.
  - C: `src/lib/engineering/storage.ts` (local-only DB), `src/pages/EngineeringPrototypePage.tsx`,
    `src/components/engineering/**`, `/engineering` route, page test.
- **Checkpoint 2 — real artifact loop.** Commit baseline; capture baseline evidence; approve and
  export the handoff; an implementer outside Chatdex works on a separate worktree from the baseline
  commit; import its manifest; compare before/after; accept.
- **Checkpoint 3 — trust.** Stale/missing binding, dirty and mismatched manifests, no automatic
  promotion, failure scopes kept apart, durable stage (EQ-C6) or explicitly out of scope; demo script.

## Exclusions

No changes to sync, crypto, detection, investigation, Change Workspace, GitHub integration, or the
main Dexie schema. No in-app command execution, GitHub writes, or LLM calls.

## Verification

Baseline (`5198800` + docs commit): recorded below when the run completes.

## Open acceptance checks

- [ ] Browser walkthrough of handoff §5 steps 1–10 on an isolated origin.
- [ ] Before → proposed → implemented → verified table from two real manifests.
- [ ] Reload reconstructs proposal, evidence, and accepted contract version.

## Limitations

Recorded as the slice lands.

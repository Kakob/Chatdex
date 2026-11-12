# Engineering abstraction prototype — "Refactor a guarantee, not a function"

Status: Implemented — acceptance pending (Checkpoints 0–2 done; Checkpoint 3 partial, see Open acceptance checks)
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

## What shipped

Experimental route **`/engineering`** (not in the sidebar; open the URL directly).

| Piece | Files |
|---|---|
| Types (reuse `LandscapeRegion` / `UnderstandingObject` / `UnderstandingEvent`) | `src/types/engineering.ts` |
| Contract vocabulary, criteria, rule pack `queue-delivery@1` | `src/lib/engineering/rules.ts` |
| Authored Event Queue model (11 concepts, 6 statements, 8 relationships, 11 bindings) | `src/lib/engineering/fixture.ts` |
| Pure impact derivation (propagation, unknown impact, model gaps) | `src/lib/engineering/impact.ts` |
| Binding status (unobserved / missing / observed / current / stale) | `src/lib/engineering/bindings.ts` |
| Manifest parse + import refusals; per-criterion verification; handoff `.md`/`.json` | `src/lib/engineering/io/` |
| Local-only DB `chatdex-engineering-prototype`; draft → approve → import → confirm → accept | `src/lib/engineering/storage.ts` |
| Workbench UI | `src/pages/EngineeringPrototypePage.tsx`, `src/components/engineering/` |
| Real queue, harness, criterion tests, evidence capture script, two real manifests | `examples/event-queue/` |

The real loop ran once, end to end, in this session:

1. Baseline queue committed at `f354cf7` (remove on dispatch). Pinned evidence captured from a clean
   tree: EQ-C0/C1 pass, **EQ-C5 fails** ("job was lost: removed on dispatch before the worker completed").
2. In Chatdex: contract edited to ack-after-processing / worker failure → 16 obligations, Producer /
   enqueue flagged *impact unknown*; approved against base `f354cf7`; handoff exported.
3. **Outside Chatdex**: a separate coding agent got only the exported handoff, worked in an isolated
   worktree from `f354cf7`, and committed `8f03376` (claim/ack/lease tokens/reapExpired/bounded
   attempts with dead letters; `dequeue()` removed; README documents duplicates and in-memory limits).
   It decided the producer unknown needs no code change and recorded that as an agent-reported note.
   Merged with `--no-ff` (`a59dbef`) so the evidenced sha stays in history.
4. Its pinned manifest (`base f354cf7`, 24 passed / 0 failed) imported as implementation evidence:
   EQ-C5 failed → passed → **supported**; EQ-C6 not required, not run, **unverified**.
5. Accepted explicitly: contract v2 current, v1 superseded, job-loss limitation resolved (because
   EQ-C5 is supported at `8f03376`), reload reconstructs everything.

### Guarantees at `8f03376` (from imported evidence only)

| Guarantee | Status | Evidence |
|---|---|---|
| Acked job is not dispatched again (EQ-C1) | Supported | test passed at `8f03376` |
| Unacked job reclaimable after lease expiry (EQ-C2) | Supported | test passed |
| Stale lease token cannot ack a newer claim (EQ-C3) | Supported | test passed |
| Duplicates possible after lease expiry (EQ-C4) | Supported (demonstrated, documented) | test passed |
| Job survives worker failure, queue process alive (EQ-C5) | Supported | failed at `f354cf7`, passed at `8f03376` |
| Bounded retries, dead-lettered not dropped (EQ-C7) | Supported | test passed |
| First-delivery order (EQ-C0); no FIFO across retries | Supported (first delivery only) | test passed |
| Job survives queue process restart (EQ-C6) | **Not verified — out of scope** | no durable stage built, no test |
| Exactly-once execution | **Not promised** | EQ-C4 shows duplicates |

### Demo script (repeatable)

```
git switch --detach f354cf7 && npm run queue:test   # 6 passed, 1 failed (EQ-C5): the legacy loss
git switch feature/engineering-abstraction-prototype && npm run queue:test   # 24 passed: ack after processing
npm run dev   # open http://localhost:4000/engineering
```
In the page: Import evidence manifest → `examples/event-queue/evidence/f354cf78ffad.json` → pick Ack
after processing + Worker failure → read obligations / Why / Impact unknown → Save as draft → Approve
change → Handoff .md (this is what an agent or a hand-coder implements) → Import as "Implementation of
the approved change" → `examples/event-queue/evidence/8f03376bb9d1.json` → read the before/after
table → Accept new understanding → reload. "Reset prototype" starts over. To produce new evidence,
commit on a branch from the base and run `npm run queue:evidence -- --base <base sha>`.

## Exclusions

No changes to sync, crypto, detection, investigation, Change Workspace, GitHub integration, or the
main Dexie schema. No in-app command execution, GitHub writes, or LLM calls.

## Verification

Baseline before any code (`2a7f4c2`, docs only): `npm run typecheck` clean; `npm test` 138 files /
1111 tests passed.

Queue baseline `f354cf7`: `npm run queue:test` → 6 passed, 1 failed (EQ-C5, by design:
"job was lost: removed on dispatch before the worker completed"). Pinned evidence
`examples/event-queue/evidence/f354cf78ffad.json` captured from a clean tree.

Implementation `8f03376` (external implementer): `npm run queue:test` 24 passed / 0 failed,
re-run independently after hand-back; EQ-C0/C1/C5 test bodies byte-identical to base; implementer's
mutation check (ack before handler → EQ-C5 fails) reported, not re-run here.

Branch after merge (2026-11-12): `npm run typecheck` clean, `npm run lint` clean, `npm run build`
succeeds, `npm test` 142 files / 1142 tests passed (baseline 138 / 1111), `npm run queue:test`
24 passed. New tests: `impact.test.ts` (derivation, paths,
unknown, scopes, incremental, model gap, determinism), `io/io.test.ts` (manifest refusals,
verification, binding states), `storage.test.ts` (isolation from main DB, approval gate, handoff
determinism, wrong-base/duplicate refusal, acceptance, reload), `EngineeringPrototypePage.test.tsx`
(steps 1–10 through the UI using both real manifests).

Browser (Chrome, dev server on `localhost:4001`, prototype DB only): steps 1–10 walked with the two
real manifests; found and fixed one bug jsdom could not show — relationship and concept titles
rendered black on the dark panel (panel base had no text color).

## Open acceptance checks

- [x] Before → proposed → implemented → verified table from two real manifests.
- [x] Reload reconstructs proposal, evidence, and accepted contract version.
- [x] Browser walkthrough of handoff §5 steps 1–10 (dark theme, desktop width).
- [ ] Your own walkthrough and judgment: does it feel like engineering at the level of meaning?
- [ ] Phone-width layout and light theme.
- [ ] Durable stage (EQ-C6) — or keep it explicitly out of scope.

## Limitations

- The model, rules, and bindings are authored for one synthetic project; nothing is inferred from
  code, and there is no UI for editing relationships, rules, or bindings (only the contract).
- One contract (delivery) and one rule pack. `ContractDefinition` is generic; the UI assumes delivery.
- Standalone route and own DB: not linked to a real project, a real Change Workspace, or the
  landscape. Promotion into the main DB is follow-up work.
- Bindings resolve symbols only through the capture script's TypeScript AST pass; Chatdex itself
  never reads the repository for this feature.
- Implementation runs are matched to criteria by test-name prefix `[EQ-Cn]`; a renamed test drops
  out of verification (shown as unmapped, never as passing).
- Resolving a limitation on acceptance relies on its authored `refutedBy` criterion.
- Approval freezes impact; later model edits do not re-derive an approved change.

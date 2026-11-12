# Chatdex — Engineering Above the Code
## Coding-agent handoff · Prototype 0: “Refactor a guarantee, not a function”

**Repository:** https://github.com/Kakob/Chatdex  
**Starting branch:** inspect `main`; make all work on a new feature branch  
**Status:** prototype specification, not a description of existing functionality  
**Primary objective:** deliver one truthful, end-to-end engineering interaction, not a broad new platform.

## 1. Mission

Build a prototype of **Chatdex as a persistent, navigable, editable abstraction layer above source code and other project artifacts**. The engineer should be able to navigate a system in terms of its components, behaviors, guarantees, constraints, states, and relationships; propose a change to one semantic contract; see which other contracts, code locations, and tests must change; hand implementation to a coding agent (or implement it by hand); and reconcile the result with pinned source and test evidence.

This is **not** a code-search tool, an AI-generated diagram, a chat wrapper, or a workflow where an LLM simply writes a plan. The model must retain stable meaning across code revisions. Source code is an inspectable implementation of the system—not the only representation of it.

**Make this one interaction convincing:** An engineer changes the event queue’s delivery behavior from “remove when dispatched” to “retain until acknowledged.” Chatdex shows exactly what that means for the state machine, worker protocol, retries, persistence, crash recovery, and tests, then connects the approved model-level change to real code and real verification.

## 2. Repository reality and boundaries

Before editing, read:
- `CLAUDE.md`
- `README.md`
- `docs/README.md`
- `docs/changes/README.md`
- `docs/changes/editable-landscape/PLAN.md`
- `docs/capabilities/change-workspace/SPEC.md`
- `docs/capabilities/repository-integration/SPEC.md`
- Relevant existing source and tests; do not assume a stale document is exact code truth.

Existing building blocks verified on `main`:
- React 19, TypeScript, Vite, Zustand, Dexie/IndexedDB, Vitest.
- Editable concepts are `LandscapeRegion` records, with hierarchy, description, kind, and revisions; intended/observed/uncertain statements are separate `UnderstandingObject` records.
- The Landscape navigates project → concept → statement → source; it is not currently a typed engineering dependency graph.
- Prepare Change / Change Workspace already holds intent, evidence, implementation attachments, verification, and promotion, and exports deterministic handoffs.
- Repository integration is read-only, supports revision-pinned source locations, and stores whole-file caches locally.

**Preserve existing product laws.** Do not silently change the shipped Change Workspace or GitHub read-only contracts; do not build in-app GitHub writes, unattended code execution, or browser-side command execution. Preserve local-first/ciphertext-only sync and existing AI disclosure, human review, and verification vocabulary. Do not modify crypto, detection, or investigation internals. Use isolated synthetic project data; never mutate personal projects or import real private chats. Where this prototype needs new workflow, create a clearly labeled experimental surface and an external, opt-in local agent/test harness.

## 3. The single demonstration

Use an actual small TypeScript queue in `examples/event-queue/` (or a comparably isolated path) with real tests. Begin with an intentionally limited implementation that accepts a job, dispatches it by destructive dequeue, and loses it when processing fails after removal. Make this behavior reproducible in a failing/diagnostic test (not a silently failing CI suite).

**Concept model:**

```
Event Queue
├── Producer / enqueue
├── Job lifecycle
│   ├── pending
│   ├── leased / in flight
│   └── acknowledged
├── Worker / claim / process / ack
├── Delivery guarantee
├── Retry + lease expiration
├── Storage + recovery
└── Verification / fault scenarios
```

Representative modeled relationships:
- `worker` **implements** `claim/ack protocol`
- `job lifecycle` **constrains** `claim/ack protocol`
- `lease expiration` **enables** `redelivery of unacknowledged jobs`
- `durable storage` **supports** `recovery after queue-process restart`
- `acknowledged delivery contract` **requires** lease/retry and, for process-restart recovery, durability
- `crash/restart test` **verifies behavior at a pinned revision** (only once actually run)

**The intended edit:**

> Change delivery semantics from *remove on dispatch* to *ack after successful processing*. Preserve accepted but unacknowledged work through the supported failure scenarios. Redelivery is allowed; exactly-once execution is not promised.

The UI should derive and present downstream *engineering obligations* from explicit relations/rules—e.g., add `claim`, `ack`, leased/in-flight state, lease timeout, retry, persistence, and fault tests—with a visible chain explaining **why** each obligation is present. Do not claim AI inferred the whole architecture when the relationships were actually authored as a fixture.

**Critical correctness distinction:** In-memory leasing survives an individual worker failure only while the queue process/state survives. It does **not** guarantee recovery after the whole queue process dies. A genuine process-restart delivery guarantee requires durable enqueue/state/ack transitions and a restart test. Keep these as distinct contracts. Never label an in-memory-only queue “durable at least once.” Duplicate delivery after ambiguous ACK is possible, so exactly-once effects are outside scope unless a specific idempotency mechanism is implemented and tested.

## 4. Semantic model (minimum viable shape)

**Reuse the existing conceptual identity instead of duplicating it:**
- `LandscapeRegion`: concept/subsystem identity and containment.
- `UnderstandingObject`: statements of behavior, guarantees, constraints, questions, decisions. Review state stays distinct from truth/evidence state.
- NEW `EngineeringRelationship`: typed directional edge between existing concept/statement IDs, with explanation, author/review status, and optional provenance. A small finite relation vocabulary is enough: `depends_on`, `implements`, `constrains`, `requires`, `verified_by`; add only what the real demo demands.
- NEW `EngineeringBinding`: connection from one concept/contract to **specific source/test locations**, including repository identity, resolved commit SHA, path, line range or symbol, optional content hash, observation status, and timestamp. Distinguish manually authored bindings from inspected evidence. A changed HEAD must not silently make a previous binding current.
- NEW `ChangeImpact` (can be derived rather than stored): change to a semantic contract → traversed relations + domain rules → affected contracts → implementation obligations → verification obligations, each with an explainable path. Mark incomplete mappings `unknown`, not “no impact.”
- NEW `EngineeringVerification`: criterion ID, test/observation, command, status, environment, revision, timestamp, and source of result (locally captured, agent-reported, human-observed). Passing tests support particular behavior; they do not prove the entire design.

Do not build a universal graph ontology or full AST/type-checker. Start with a small typed schema, pure deterministic projection/impact functions, and authored event-queue data. The fixture must be editable and persisted locally, not merely screenshots or hardcoded transitions.

Suggested feature boundary:

```
src/types/engineering.ts
src/lib/engineering/            # pure graph, impact, bindings, criteria, import/export
src/components/engineering/     # semantic contract/impact/code/evidence panels
src/pages/EngineeringPrototypePage.tsx
src/lib/db/                    # additive local-first storage, only if needed
examples/event-queue/          # real isolated TypeScript program + Vitest tests
```

Prefer integration in a dedicated route such as `/projects/:id/engineering` with an obvious **Experimental** label. Reuse project IDs, existing concepts, accepted understanding, and Prepare Change handoff primitives where practical. Avoid replacing or rewriting `/landscape` wholesale. If storage schema changes are required, use additive Dexie migrations and preserve existing data. Check sync contracts before adding a new synced entity; local-only prototype persistence is acceptable if explicitly labeled.

## 5. User journey (this is the product acceptance walkthrough)

1. Open a synthetic **Event Queue** project and navigate `Event Queue → Delivery Guarantee`. Show the current stated behavior (`remove on dispatch`), related concepts, bound source, and observed limitation.
2. Open a reproducible failure case: worker stops after receiving a job, before successful completion; the original queue has already forgotten the job. Show the exact test and revision/command used. Never present a prewritten explanation as a passing test.
3. Edit the **contract**, not a file: set delivery to `ack after processing` and choose the failure scope (worker failure versus full queue-process restart).
4. Show an **impact view** listing concrete obligations and their explicit dependency paths: lifecycle, worker API, lease expiry, redelivery, storage, recovery, tests, and any unresolved/unknown edge. Clicking an obligation descends to the current source/test binding.
5. Approve the semantic change and create or link a real **Change Workspace**: desired behavior, rationale, bounded implementation plan, acceptance criteria, affected semantic IDs, prior evidence, expected tests, and exact repository revision.
6. Export a deterministic **agent handoff** (`.md` and `.json`). No implementation should occur merely because the user edited a model contract.
7. The engineer deliberately uses a coding agent **outside Chatdex** (or chooses to code manually) on a branch/worktree. The agent changes the queue and runs tests. No in-app GitHub write path is necessary.
8. Bring back the branch/commit plus a structured result manifest with changed paths, test commands and outcomes, and remaining unknowns. Import/review results in Chatdex, associating them with model IDs and criteria.
9. Show **Before → Proposed → Implemented → Verified evidence** side by side. A passing worker-crash test may support worker-failure recovery; only a real process-restart/persistence test supports process-restart recovery. Stale bindings remain visibly stale until refreshed at the new SHA.
10. Explicitly accept/persist the new understanding, leaving unverified claims, pending changes, and limitations open. Reload and reconstruct the same state.

## 6. Queue implementation contract

Create a real, small queue with a documented interface along these lines (adapt names to clean TypeScript conventions):

```ts
interface Queue {
  enqueue(payload: unknown): Promise<string>;
  claim(workerId: string, leaseMs: number): Promise<ClaimedJob | null>;
  ack(jobId: string, leaseToken: string): Promise<void>;
  reapExpired(now?: number): Promise<number>;
}
```

Start with the legacy destructive `dequeue()` behavior as the reproducible baseline, then evolve to `claim`/`ack`. Use a controlled clock or deterministic lease timing in unit tests. Guard against a stale lease holder acknowledging a job that has already been re-claimed (lease tokens/fencing). Include explicit failure handling and bounded retry semantics. For durable phase, use an appropriate transactional storage adapter (e.g., SQLite if compatible with the repository environment) and test a fresh queue instance against the same persisted data after a simulated process restart. Prefer simple correct mechanics to distributed-system theater.

**Minimum verification scenarios:**
- FIFO/ordering assumptions are explicit (do not promise strict global FIFO across leases/retries).
- A successfully acknowledged job is not dispatched again in the supported model.
- A claimed but unacknowledged job can be reclaimed after lease expiration.
- A stale lease token cannot acknowledge a newer claim.
- An expired claim and retry can cause duplicate processing; document it rather than concealing it.
- At a durable stage: a durably enqueued, unacknowledged job survives process reconstruction/restart and is reclaimed. If the durable stage is not built, mark this criterion **not verified / out of scope**, and do not claim full process-crash at-least-once semantics.

## 7. Implementation steps and agent ownership

**Agent A — Semantic engine / contract logic** (owns `src/types/engineering.ts`, `src/lib/engineering/model*`, `impact*`, and unit tests). Inspect existing region/object types; implement typed relationships, deterministic impact traversal and rule explanations, stale/unknown handling, authored event-queue model fixture. Expose a clean API consumed by other agents. Deliver test-driven derivation for the remove-on-dispatch → ack-after-processing change. Do not implement UI.

**Agent B — Real queue / failure laboratory** (owns `examples/event-queue/**`). Build an isolated, runnable TypeScript queue and tests. Preserve a reproducible before-state, then implement claim/ack/lease/retry and a durability option with precise failure-scope labels. Produce a small `queue-evidence.json` with test IDs/commands/result summaries and revision metadata; never fabricate passing results. Do not change Chatdex UI.

**Agent C — Engineering workbench** (owns `src/pages/EngineeringPrototypePage.tsx`, `src/components/engineering/**`, route addition to `src/App.tsx`, relevant UI tests). Build a coherent click-through system view: contract inspector, typed relationships, impact obligations, bound files/tests, change proposal, before/after verification. Use Agent A's real model and no hardcoded “AI figured this out” claims. Keep layout usable without a spectacular graph canvas: focused concept navigation + relationship/impact panels is sufficient.

**Agent D — Handoff / evidence bridge** (owns `src/lib/engineering/io/**` and integration tests; coordinate with A to avoid competing type definitions). Connect model change to existing Change Workspace where appropriate; deterministically export a concise machine-readable change contract + human Markdown; accept a test/result manifest; validate IDs/SHAs/paths, refuse stale or mismatched evidence, and present reviewed outcomes without automatically promoting understanding. Do not add in-app repository writes or arbitrary shell execution.

If fewer agents are available, combine C+D. **Agent A defines the interfaces before others integrate.** Agents should work in isolated branches/worktrees, agree on shared types, and integrate in small reviewable steps. Each agent should read the repository instructions and the actual source they modify.

### Suggested checkpoints

- **Checkpoint 0 — Reconnaissance:** document exact reuse points, create a bounded `docs/changes/engineering-abstraction-prototype/PLAN.md`, record assumptions and conflicts with existing specs, baseline test results.
- **Checkpoint 1 — Interactive semantic prototype:** event-queue concept model, editable delivery contract, deterministic visible impact tree, persistence/reload, unit/UI tests. All consequences can initially be authored rules, explicitly labeled.
- **Checkpoint 2 — Real artifact loop:** revision-pinned source/test bindings, generated Change Workspace handoff, agent changes to real queue, import actual verification results, compare model and code.
- **Checkpoint 3 — Trust/completion:** test stale SHA, missing binding, incomplete verification, no automatic promotion, separate failure guarantees; complete docs and a repeatable demo script.

## 8. Acceptance criteria / definition of done

**Functional:**
- The user changes a modeled **system guarantee**, not just a text label, and sees nontrivial, explainable downstream obligations generated from typed relationships and explicit rules.
- Every obligation can be navigated back to its originating contract/dependency and (if bound) to an actual source or test location. Missing bindings say **unknown**.
- A real queue implementation and tests exist; at least one genuine behavior/fault test changes outcome when the implementation changes.
- The prepared change is deterministic, inspectable, human-approved, and associated with the chosen model version/source revision.
- The prototype can ingest real post-change test evidence at a specific revision; it does not treat agent prose as independent verification.
- The user sees what changed, what was tested, what is still unverified, and can navigate back to prior versions after reload.
- Model contracts and evidence are not silently rewritten by AI. No pre-existing private projects are altered.

**Quality:** run `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build`. Run the example queue’s documented tests. Record pass/fail counts and any baseline failures or environment blockers; never assert passes without running. Add tests for impact derivation, review gates, stale bindings, persistence, file/commit validation, and queue crash behavior.

**Evidence:** deliver a short screen-recordable walkthrough, exact commands to reproduce the legacy failure and new behavior, a screenshot or textual description of every important UI state, and a table of verified vs unverified guarantees. Show one bounded hand-coding entry point too, so the workflow serves engineers who prefer to implement a component personally.

## 9. Explicitly out of scope

Do **not** build a general-purpose AI coding agent, complete code-to-graph inference, universal program model, realtime multiplayer, auto-refresh across all repositories, automatic commits/PRs, production backend deployment, new authentication, complex distributed queues, or a flashy graph visualization in place of real interaction. No required LLM API key. No generated claim may become “verified” merely because an LLM proposed it.

A successful prototype need not automatically create all code from the semantic model. It **must** make manipulating the model an effective way to scope, inspect, implement, and verify a consequential change to a real program.

## 10. What to report back

Each agent should return: files changed; interfaces added; tests actually run and outcomes; exact feature/demo route; a runnable command sequence; artifacts and commit SHA; known limitations; and the next smallest improvement. The integration agent should summarize the before/after interaction and whether this genuinely felt like **engineering at the level of meaning** rather than a conventional AI assistant with a diagram attached.

**Kickoff directive:** Begin with repository inspection and Checkpoint 0, then implement Checkpoint 1 before expanding scope. Prioritize the first end-to-end vertical slice over breadth. Treat every untested behavior as unverified.

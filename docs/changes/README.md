# Changes: evolving capabilities

`docs/capabilities/` answers **what applies now and who owns it**.
`docs/changes/` answers **what we are changing, why, and how we will verify it**.
A capability is durable; a change has a beginning and an end. Folder names are not
requirements to create matching code modules.

## Change index

Delivery status and unchecked acceptance criteria are authoritative in each linked
plan; these summaries are navigation aids, not independent checklists.

| Change | Primary capability | Related capabilities | Summary |
|---|---|---|---|
| [Reliable sync and storage labels](./reliable-sync/PLAN.md) | none (shared infrastructure) | Sync, auth key lifetime (auth-architecture §4; CLAUDE.md inv. 1 preserved) | Implemented, acceptance pending — sync starts and unlocks automatically, catches up on changes made while locked, header sync menu, Backed up / Waiting / This device only labels on conversations and messages |
| [Understanding Landscape](./understanding-landscape/PLAN.md) | Understanding Workspace | Change Workspace (Prepare Change entry, inspections log), Sync (new `landscape_region` kind; CLAUDE.md inv. 1 preserved) | Implemented, acceptance pending — click-through project → region → finding → source landscape with Where-you-left-off lens, regions as synced organization records |
| [Editable landscape](./editable-landscape/PLAN.md) | Understanding Workspace | Understanding Landscape (regions become concepts), native chat (concept-scoped context, CLAUDE.md inv. 6), Prepare Change (preselect) | Implemented, acceptance pending — create/nest/move/describe concepts on the map with no conversation, user statements with history, concept-scoped AI discussion whose proposals land pending |
| [Research Atlas](./research-atlas/PLAN.md) | none (standalone feature) | none — separate unsynced IndexedDB database; OpenAlex receives search text only | Implemented, acceptance pending — `/research` directory of seeded researchers, projects and papers, OpenAlex import, local investigation notebook |
| [Experience inquiry](./experience-inquiry/PLAN.md) | Decision Investigation | Understanding Workspace | Local research slice; original handoff, source-preparation walkthrough, and remaining acceptance work in the linked plan |
| [Branch Binding](./branch-binding/PLAN.md) | Repository Integration | Intent Trace, Decision Recovery, Change Workspace | Implementation recorded; manual acceptance checks remain |
| [Decision review experience](./decision-review-experience/PLAN.md) | Decision Recovery | Repository Integration (snapshot context only) | Completed locally; verification and limitations in the linked plan/build log |
| [Experiment Lab](./experiment-lab/PLAN.md) | Experiment Lab (proposed) | Decision Authoring, Change Workspace, Private → Shared | Proposed — developing project idea collection, next moves, attempts and outcomes |
| [Decision Authoring & Evidence](./decision-authoring-evidence/PLAN.md) | Decision Authoring (proposed) | Decision Recovery, Intent Trace, Understanding Workspace, Repository Integration | Proposed — question-centered multi-file code exploration, mobile reading, AI-assisted interpretation, evidence and revision history |
| [Share Build Story](./share-build-story/PLAN.md) | Private → Shared (proposed) | Decision Authoring, Experiment Lab, Change Workspace | Proposed — reviewed hosted stories, exports and aggregate engagement |
| **[Model-native engineering platform — proposed next work](./model-native-engineering/PLAN.md)** | Repository Integration (proposed extension) | Understanding Workspace, Change Workspace, local workspace service | **Proposed, not implemented** — portable deterministic source graph; phone-to-laptop read/edit/reconcile/check/commit; five testable next tasks. Historical engineering prototype work remains separate. |
| [Engineering abstraction prototype](./engineering-abstraction-prototype/PLAN.md) | Understanding Workspace | Understanding Landscape (concept/statement shapes), Change Workspace (handoff/verification vocabulary), Repository Integration (pinned revisions); own local-only DB, nothing synced | Implemented, acceptance pending — experimental `/engineering`: edit an event-queue delivery guarantee, derive explainable obligations, hand off, import revision-pinned test evidence, compare before/after, accept a new contract version. [Visual Explorer 1.5](./engineering-abstraction-prototype/EXPLORER_ITERATION_1_5.md) adds a diagram-first mobile interface with an inspector and code/test tabs; acceptance pending. [Shared Coding 4](./engineering-abstraction-prototype/EXPLORER_CODING_WORKSPACE_4.md) adds human/agent staging, optional guarded local writes and a real queue backoff change. [Generic Model 3.5](./engineering-abstraction-prototype/EXPLORER_ITERATION_3_5.md) adds reusable model projection, indexed source bindings and potential impact preview. [Shared Model 3](./engineering-abstraction-prototype/EXPLORER_ITERATION_3.md) adds local proposed revisions and typed relationships. [Live Explorer 2](./engineering-abstraction-prototype/EXPLORER_ITERATION_2.md) adds live queue/todo runtimes and opt-in example projects. [Original handoff](./engineering-abstraction-prototype/CHATDEX_ENGINEERING_ABSTRACTION_PROTOTYPE_HANDOFF.md) |
| [Backend test harness](./backend-test-harness/PLAN.md) | none (shared infrastructure) | Sync, LLM relay, auth (architecture docs; CLAUDE.md inv. 1 and 6) | Completed 2026-09-09 — `buildApp` extraction, PGlite-backed backend vitest harness, route tests for the previously unguarded backend rows; mutation checks recorded in the plan |

## When to create a package

Use a change folder for work needing a durable plan: multiple steps, cross-capability
coordination, important design choices, or acceptance checks spanning sessions.
A small bug or copy edit can use an issue and commit alone. Both follow the same rule:
update the owning contract if behavior changes. A defect fix restoring an existing
contract usually needs no spec amendment.

Create a new capability only for a lasting responsibility with a distinct boundary.
A redesign of an existing page normally stays with its existing capability.
A cross-capability change has one primary owner and links to every affected contract;
it does not need a new permanent capability of its own.

## Files and authority

Start with `PLAN.md`. A per-change README is optional and normally unnecessary: the
plan already supplies the entry point. Add `BUILD-LOG.md` for work spanning milestones
when a separate chronological record helps. Add an assessment only when the analysis
is too substantial for the plan. Do not create empty template files to fill a checklist.

Capability specs own behavior and boundaries. Product PRDs own product-level needs;
architecture documents own shared system constraints. Change plans propose explicit
amendments, never silently override any of these documents. If a conflict appears,
name it and resolve it in the plan before implementing the conflicting behavior.

A draft is not shipped behavior. Record proposals in the change plan; amend the
capability spec as corresponding implementation lands. During staged delivery, label
implemented and outstanding portions explicitly. Approval alone is not implementation.

## Lifecycle

1. **Propose:** state the concrete problem, primary owner, affected spec sections,
   intended behavior, exclusions, and observable acceptance criteria.
2. **Agree:** record approved scope and unresolved choices. Use session authorization;
   this workflow does not impose an extra approval gate on already authorized work.
3. **Implement:** work in reviewable increments, referencing capability contracts.
   Record meaningful deviations and verification rather than duplicating Git diffs.
4. **Reconcile docs:** revise affected spec sections in the same change as behavior.
   Replace obsolete rules instead of appending contradictory rules. Link shared rules
   to their owner; keep consumer-specific obligations in consumer specs.
5. **Close:** record delivered behavior, validation, and remaining limitations. Keep
   status as `Implemented — acceptance pending` if required manual checks remain.
   Mark `Completed` only when required checks pass. Link follow-up work explicitly.
6. **Retain:** completed plans and logs remain historical at stable paths. New work gets
   a new package when warranted; do not reopen history to make it sound current.

Suggested statuses: Proposed, In progress, Implemented — acceptance pending,
Completed, Superseded. A superseded plan links its successor. Dates and commit hashes
in build logs describe past events; they are not current capability status.

## Lightweight PLAN.md template

```markdown
# Change title

Status: Proposed
Primary capability: [name](../../capabilities/example/SPEC.md)
Affected contracts: links to exact sections

## Problem
Concrete observed behavior and why it matters.

## Proposed changes
Behavior before/after, boundaries, and any contract amendments required.

## Scope and exclusions
What this work includes and deliberately defers.

## Implementation steps
Small ordered steps; omit for trivial work.

## Acceptance criteria
Observable outcomes, relevant checks, and preservation requirements.

## Documentation updates
Owning sections to revise when behavior lands; shared rules to link rather than copy.

## Outcome
Populate when delivered: what shipped, verification, limitations, and follow-up links.
```

## Migration from tracks (2026-09-08)

Former tracks became capabilities except Branch Binding, which is a shared bug-fix
package. Its implementation history and pending checks were preserved. Existing
capability-local delivery docs remain as historical records to avoid unnecessary
relocation and broken references; use this workflow for new bounded work.
Repository Integration now names the shared ownership boundary. Decision review is
recorded here under Decision Recovery, not as another capability.

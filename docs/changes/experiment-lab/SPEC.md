# Experiment Lab — proposed implementation contract

Status: Proposed — revised 2026-09-08. No behavior here is claimed as implemented.
Delivery: [PLAN.md](PLAN.md). Product requirements: [PRD.md](PRD.md).

## 1. Ownership and navigation

A proposed Experiment Lab capability owns project ideas, development state, next
moves, attempts, and outcomes. Proposed primary route: `/projects/:id/experiments`,
with idea detail at `/projects/:id/experiments/:ideaId` and attempt detail below it.
Add a project navigation entry. Prepare Change may link to the lab but keeps its
existing default route and lifecycle. Update last-project-section handling when
adding the route. Direct project navigation is a design default, not shipped behavior.

Search, category/state filters, ordering, and selected view live in query parameters.
Default to the full project collection in stable source order; user-selected recent
activity ordering is available. No automatic promise ranking. Keyboard-accessible
list/detail UI works on narrow screens without a canvas. Save errors preserve input.

## 2. Data model

Use versioned validated records, stable opaque IDs, ISO timestamps, project checks,
and Dexie transactions. Proposed tables are local-only initially; their exact migration
version is chosen against the live schema at implementation time.

| Record | Required meaning |
| --- | --- |
| CatalogTemplate | Stable ID/revision, original title/text/category/number, tiers, tags, source locator and related template IDs. Bundled immutable source. |
| ProjectIdea | Project ID, title/question, source template ID/revision or manual origin, source snapshot, state, notes, optional written assessment, selected next-move ID, linked questions/decisions/changes, timestamps. |
| NextMove | Idea ID, action, optional effort range/unit/uncertainty/rationale, origin, source reference when available, adoption/edit history. Several may coexist. |
| ExperimentAttempt | Idea/project IDs, frozen starting snapshot, state, parent attempt, next-step note, recorded times, outcome. |
| ExperimentEvent | Append-only idea/attempt event: state changes, notes, corrections, revisions, observations, finish and promotion. |
| ExperimentPromotion | Unique attempt ID, target prepared-change ID, frozen reviewed handoff, selected source/event IDs and time. |

Template population into a project is an explicit idempotent action keyed by
project/template ID. Seed the full bank into the Chatdex collection once; do not
silently populate every other project. Editing project ideas never mutates templates.
Adapting an idea into another project creates a new identity with an inspired-by
link and selected snapshot, without copying private attempts or history implicitly.

NextMove origin is user, Chatdex AI, or pasted/unknown; pasted text is not automatically
labeled user-authored or externally AI-authored. Optional attribution must not block
entry. Store original suggestion and subsequent human edits. An AI estimate is a
suggestion, not a measured duration. A source tier's estimate is a separate field.

## 3. State and development history

Proposed idea states: idea, exploring, planning, trying, reflecting, parked. They are
visible labels, freely changeable with timestamped events; no required progression.
Their exact vocabulary is a design default. A linked production change has its own
status, never inferred from the idea label. No 1–10 score or percent completion in v1.

Attempts use draft → trying ↔ paused → finished. A draft may finish as abandoned
without a fabricated start time. Starting requires a question and bounded action;
prediction is optional. Finishing requires observed result and learning or uncertainty,
with assessment interesting/negative/inconclusive and disposition keep-playing,
promote, park, or abandon. Abandonment requires a reason. More work creates a new
linked attempt. Scope revisions and corrected observations append history; retain
initial snapshots and original observations. State summary and event commit atomically.

Idea state is not automatically overwritten when one of several attempts changes.
Offer an explicit state update where useful. Notes alone are legitimate development.

## 4. Evidence and assistance

Reuse compatible existing source locators and bounded evidence quotes, including
repository identity/SHA when known. Local working trees are not immutable snapshots.
Observations identify human-observed, simulated, or imported basis; none automatically
means verified. Missing sources retain a locator and explicit availability state.
Use safe text rendering and http/https external links without automatic preview fetches.
No arbitrary artifact execution or binary uploads.

Explicit Suggest next moves/Estimate effort actions show the receiving provider and
selected context before disclosure, following the existing opt-in synthesis policy.
No provider request on browsing, selection, manual edits, paste, or state changes.
Suggestions retain model/provider, source/context references, and request time.
Accepting or editing a suggestion is distinct from its generation. Unknown estimates
and provider failures leave manual entry fully usable. Do not present suggested
tradeoffs as established observations.

## 5. Handoffs

Investigations may seed ideas with selected question/decision revision IDs, evidence,
and uncertainty snapshots. Manual/catalog origins remain equally supported. Select
one next move without automatically creating an attempt or Change Workspace.

A finished attempt may produce a reviewed Change Workspace draft containing desired
behavior, preserve/discard, rationale, risks, open questions, and unverified checks.
Require title and desired behavior; use existing creation validation. Store the draft,
promotion, and event atomically, with a unique attempt constraint so retries open the
same target. Preserve the complete handoff even where fields have no direct mapping.
Compatible evidence is copied; never fabricate transcript references for lab events.
A missing target is shown honestly rather than silently replaced. The attempt remains.

Idea-to-change links can also attach an existing change without pretending it came
from an attempt. No automatic Current Understanding promotion. Share Build Story
collects selected snapshots rather than acquiring access to the whole idea history.

## 6. Storage and lifecycle boundaries

Proposed v1 persistence is device-local with versioned JSON and readable Markdown
export, visibly labeled Saved on this device. This is an implementation default, not
a user requirement for permanent local-only storage. Preserve original template,
idea, move, attempt, revision and outcome provenance in export. Read-only catalog and
manual record operations work offline; AI assistance and remote sources may not.

Include dependent local records in the existing project erase/reset semantics.
Archiving/parking is not erasure. No new sync kinds initially. A synced prepared change
contains its handoff snapshot and labels a local attempt link unavailable elsewhere.
Later encrypted sync requires a separate client/backend/migration/conflict/deletion
plan; no plaintext private experiment records go to the sync backend.

## 7. Verification and exclusions

Test idempotent population and repeated source numbers; isolation between projects;
independent adaptation; immutable starting snapshots; state/event atomicity; next-move
origin and edit history; provider disclosure and failure; attempt transitions;
promotion retries; delete/reset; offline reload/export; safe rendering; and unchanged
Prepare Change behavior. Browsing must never call providers or execute repository work.

Runtime/worktree creation, automatic spec edits, recommendation learning, timers,
collaborative editing and arbitrary attachments remain outside this package.

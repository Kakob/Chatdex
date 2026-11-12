# Proposal: Explorer as the Chatdex project engineering workspace

**Status:** Product direction / design hypothesis; NOT implemented by the Explorer prototype.
**Branch for exploration:** feature/engineering-explorer-iteration-1
**Current experiment:** /engineering/explore (standalone, authored Event Queue)

## Product question

Should Investigate History (IH), Current Understanding (CU), and Prepare Change (PC) collapse into the same spatial/visual workspace?

**Proposed answer:** one persistent, navigable system model as the project home, with history, understanding, and change as three *lenses/actions over selected model entities*. Do NOT collapse their data semantics, provenance, review gates, or uncertainty into a single status.

Users stay oriented in one system. Selecting Worker, for example, continues to mean the *same identified component* when they switch from inspecting runtime behavior to reviewing its history, or planning a change.

This is more than rearranging pages; the model's stable entities, relationships, states, source bindings, and activities must form a coherent engineering surface.

## Current repository reality

- `src/components/layout/ProjectWorkspaceLayout.tsx` currently routes IH, CU, Intent Trace, Decisions, and PC as separate project workflow destinations.
- `src/pages/ProjectOverviewPage.tsx` presents a multi-stage project workflow; it is not the Explorer.
- `/engineering/explore` is a separate, authored, read-only synthetic queue model. Diagram identities and their source/test mappings are hardcoded in the Explorer page.
- `/engineering` is a separate local-only contract/impact/verification demo with its own Dexie database.
- No project-scoped Explorer route exists and neither Explorer route currently shares source-of-truth records with real project models. Do NOT represent these proposals as shipped behavior.

## First conceptual model

Project
- Stable named system objects (components, interfaces, states, guarantees, relationships)
- Source and test bindings (repo identity, commit, path/symbol; status of binding)
- Accepted understanding and open hypotheses (reviewed claims vs evidence)
- Historical events, investigations, conversations, design decisions and rationale
- Runtime observations (trace ID, event/time, model object mapping, environment, revision)
- Prepared changes (intended delta, affected IDs, tasks, verification, explicit approval)

**Every object should be inspectable, not just drawn.** The diagram is one *projection* of the model; alternative component/state/list/timeline views must preserve selection.

## One project, three lenses

With the Worker selected in the project canvas:

1. **History (Investigate History):** show when this worker/protocol was introduced, why it changed, relevant discussions, original decisions, links to commits and evidence, conflicts and unknowns. History answers how and why we arrived here; it does not claim a past statement remains true now.
2. **Understand (Current Understanding):** show current supported/intended/uncertain behaviors, relationships, source and tests, observed runtime state and explanations. Distinguish authored model, source inspection, runtime observations, test-pinned evidence, and speculation.
3. **Change (Prepare Change):** author a model-level behavioral or structural intent targeted at the selected node, preview downstream impact, inspect code/test obligations, choose hand-implementation or agent handoff, and verify/reconcile resulting source and behavior. A proposed change cannot automatically change accepted understanding.

These *lenses* may be a small tab/segmented control in the same inspector on mobile and a larger docked panel on desktop. Deep investigations and complex change reviews may still open focused views; keep navigation anchored to the same project/object.

## Design invariants

- A shared `projectId` + `selectedEntityId` is preserved across history, understand, change, and code views; do not maintain three unrelated copies of the component.
- Do not mistake code for implementation evidence without inspecting the chosen revision; source, tests, and runtime events have provenance.
- A component can be `modeled`, `observed`, `supported`, `unknown` or `proposed` in different senses; do not combine these into a single green checkmark.
- Model operations should eventually drive actual behavior or produce bounded implementation operations; changing documentation alone is not programming.
- Mobile experience keeps system topology visible while the inspector changes, with optional full-height code reading.
- Keep existing IH, CU, PC records and established review/AI-disclosure contracts. Prototype integration must not migrate or mutate personal project data without an explicit plan.

## Suggested delivery slices

**Slice A — improve the Explorer ergonomics:** visual diagram, inspector, mobile code wrapping, anchored selection (ongoing in iteration 1.5).

**Slice B — real execution:** controlled-clock queue commands generate actual state transitions and a trace linked to diagram nodes and source (iteration 2).

**Slice C — integrate project identity:** opt-in experimental `/projects/:id/engineering` surface backed by existing project identity; adapt model from existing project concepts and reviewed understanding, with source and relationships not fabricated. Start with read-only reuse and no migration or sync changes.

**Slice D — attach historical and change lenses:** context-dependent links into existing IH/CU/PC data first. Then native drawers for source-linked history/decision context and model-scoped proposals. Preserve original workflows for complicated investigation/review.

**Slice E — model-directed programming:** change a real behavior parameter, see a real execution difference, and trace the change into code/configuration. Progress to richer structural changes only after this passes.

The execution and project integration slices can be reordered after a browser review, but do not lose the essential test: **does selecting a system component give a coherent view of its history, current behavior, source and next possible changes?**

## Open product/design questions

- Is the first project home always a system canvas, or is there an alternative overview for repositories with no discovered model?
- Which representations should have first-class model semantics (services, state machines, data shapes, workflows, contracts)? Avoid prematurely forcing all systems into an event-queue ontology.
- How do users capture their own authored objects and bindings without requiring an opaque code-inference agent?
- Which model edits are executable by configuration versus requiring code transformations and review?
- How does the visual view disclose incomplete coverage and outdated source bindings?

These are hypotheses for the next iterations, not commitments to a general compiler or automatic code-to-model inference.

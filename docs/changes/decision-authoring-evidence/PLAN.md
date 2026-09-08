# Decision Authoring & Evidence

Status: Proposed — documentation prepared 2026-09-08; no implementation.
Primary capability: Decision Authoring (proposed); extraction remains Decision Recovery.
[PRD.md](PRD.md) defines the experience; [SPEC.md](SPEC.md) defines proposed behavior.
Related: [Experiment Lab](../experiment-lab/PLAN.md), [Share Build Story](../share-build-story/PLAN.md).

## Problem and agreed scope

AI-generated decisions are useful starting points, but users need to author statements,
select evidence from code/specs/chats, revise interpretations and preserve provenance.
Support question-led and source-led entry, connected chat/actions, scoped documentation
gaps, and unresolved inventories without forced implementation or specification edits.

Decisions version interpretations; subject code/document snapshots track actual system
changes separately. Optionality to branch remains, but refinement is the default.
Exact route/table names and synchronized revision conflict handling are implementation
proposals. User direction authorizes these documents, not feature deployment.

## Contract amendments when implementation lands

| Owner | Required reconciliation |
| --- | --- |
| [Decision Recovery §2.1, §2.3, §7, §10–12](../../capabilities/decision-recovery/SPEC.md) | Scope transcript requirement to recovery outputs; reference separate manual/code-only authoring contract. Retain immutable traces, derivations and pending AI law. Add revision projection and authoring entry points without redefining historical diffs. |
| [Understanding Workspace §7–11](../../capabilities/understanding-workspace/PRD.md) | Decision revision/current projection, annotations, human adoption and provenance integration. |
| [Intent Trace §9–12](../../capabilities/intent-trace/SPEC.md) | Source/question links and authoring handoff; no rewrite of trace evidence judgments. |
| [Change Workspace §7, §12, §14](../../capabilities/change-workspace/SPEC.md) | Carry exact authored revision and reviewed intent into existing preparation workflow. |
| [Repository Integration §3–4](../../capabilities/repository-integration/SPEC.md) | Reuse snapshot/read-only access unchanged. |
| New Decision Authoring capability | Own SPEC §§1–6 as slices land; distinguish implementation from proposal. |

Protected Decision Investigation is not the generic new investigation workspace.
Do not rename its tables or widen its AI boundary. Negative-space coverage must never
silently reuse legacy unsupported-autonomous labels as proof of authorship.

## Delivery

1. **DA-0: Baseline and adapters.** Trace existing decision storage, review, quote
   validation and sync. Define legacy baseline projection and fixtures for code/spec/
   chat with unavailable sources. Map exact amendment points before touching contracts.
2. **DA-1: Manual investigation.** Question/source entry, source panes, statement and
   evidence authoring, annotations, revisions and unresolved inventory. Implement
   synchronized records, ordering/conflict handling and erase/reset before rollout.
3. **DA-2: Grounded assistance.** Shared conversation/scoped actions, source disclosure,
   contextual preview, proposed revisions, provenance and coverage records. Preserve
   deterministic manual workflow and recovery/DI boundaries.
4. **DA-3: Follow-through.** Source-born question branches, later-document support,
   lab/Prepare Change handoffs and story collection hook. Missing companion features
   do not block standalone investigation; expose only implemented integrations.
5. **DA-4: Acceptance.** Automated checks plus the real GitHub investigation. Reconcile
   capability contracts and record results/limitations before marking completed.

## Acceptance

- [ ] Start from a question or selected code/spec/chat; preserve branching context.
- [ ] Author a code-only or unsupported decision without invented transcript evidence.
- [ ] Capture historical, observed-choice and proposed interpretations distinctly.
- [ ] Revise an AI suggestion with exact origin, evidence changes and adoption history.
- [ ] See a grounded explanation without having to read every file independently.
- [ ] Explain action and Continue in chat share a response with no duplicate call.
- [ ] Record searched-no-support with scope/failures; never infer who chose the behavior.
- [ ] Leave a choice unresolved without editing code or specification.
- [ ] Link a later observed spec revision without rewriting the earlier gap history.
- [ ] Sync conflicts, ordering, offline edits, deletion and legacy records behave honestly.
- [ ] Existing recovery and protected DI checks pass unchanged in meaning.

## Shared acceptance scenario

Investigate GitHub retrieval and evidence use. Ask AI for candidates grounded in chosen
sources, edit one interpretation after finding contrary code, add a manually defined
choice and record a scoped no-support search. Continue an Explain action in chat.
Leave an item unresolved, seed a lab idea from another, and prepare a change only for
a selected intervention. Collect the interpreted history into a private build story.
All example claims must come from inspected sources rather than this narrative.

## Outcome

Documentation only; all feature acceptance remains open. Run typecheck, lint, focused
behavior/boundary tests and full frontend/backend tests as implementation lands.
Documentation-revision verification is recorded after this editing pass.

### Documentation verification — 2026-09-08

Local Markdown targets and change-index entries checked; `git diff --check`,
`npm run typecheck`, `npm run lint`, and `npm run test:all` passed (973 frontend
tests and 6 backend tests). These checks validate the current repository after a
documentation-only edit; they do not satisfy the feature acceptance checklist above.

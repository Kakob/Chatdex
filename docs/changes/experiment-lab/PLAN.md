# Experiment Lab

Status: Proposed — revised 2026-09-08; documentation only.
Primary capability: Experiment Lab (proposed).
Requirements: [PRD.md](PRD.md). Contract proposal: [SPEC.md](SPEC.md).
Related packages: [Decision Authoring & Evidence](../decision-authoring-evidence/PLAN.md),
[Share Build Story](../share-build-story/PLAN.md).

## Problem and agreed direction

The user wants a browsable project idea bank that also shows development already
underway, including early thinking. The earlier draft's curated front door nested
under Prepare Change is replaced by a unified collection with a direct project entry.
Visible state distinguishes exploration, planning and trying. Next moves and rough
estimates support manual entry, paste, and explicit AI suggestions. Experiments are
optional companions to investigations and changes, not a compulsory funnel.

The state vocabulary, exact routes, and local-only first persistence are proposed
engineering defaults. Numerical progress scoring is undecided and omitted initially.
The full supplied bank is not yet a repository fixture or imported application data.

## Implementation sequence

1. **EL-0: Source reconciliation.** Preserve the complete supplied bank as a reviewed
   versioned fixture; account for every category, unnumbered entry, overlapping number,
   tier and contextual section. Produce counts and parsing exceptions. No silent merges.
2. **EL-1: Developing collection.** Add project records, idempotent population, direct
   navigation, search/filters, states, notes, manually entered/pasted next moves and
   estimates. Support adaptation into another project without copying private history.
3. **EL-2: Attempts and learning.** Add snapshots, observation history, pause/resume,
   outcomes, offline export, deletion integration and reviewed change promotion.
4. **EL-3: Assistance and bridges.** Explicit disclosed AI suggestions with origins;
   link investigation questions/revisions when available and expose story collection.
   These integrations must not block manual/catalog use of EL-1/2.
5. **EL-4: Acceptance and reconciliation.** Run focused checks and full repo checks,
   walk the scenario, publish the lasting capability contract and amend affected owners.

## Affected contracts

| Owner | Amendment when implemented |
| --- | --- |
| New Experiment Lab capability | Establish SPEC §§1–7; label delivered vs remaining slices. |
| [Change Workspace §6–7, §12, §14](../../capabilities/change-workspace/SPEC.md) | Experiment origin and frozen handoff; optional lab links; no lifecycle or verification shortcut. |
| [Understanding Workspace §9, §11, §15](../../capabilities/understanding-workspace/PRD.md) | Project navigation and source links; retain review rules and no automatic belief promotion. |
| [Repository Integration §3–4](../../capabilities/repository-integration/SPEC.md) | Reuse existing snapshot/read-only access unchanged. |

No executable agent work, repository writes or automatic specification changes.
No changes to Decision Investigation tables or its AI quarantine boundary.

## Acceptance

- [ ] Full bank reconciliation and repeated population preserve identities and user edits.
- [ ] Ideas, planning work and attempts share one collection with visible states.
- [ ] Notes count as development without forcing creation of an attempt.
- [ ] Typed/pasted/AI next moves and estimates preserve attribution and human edits.
- [ ] Original tier estimates remain distinct from current-next-move estimates.
- [ ] Two attempts retain independent results; source/idea edits do not rewrite them.
- [ ] Adapting an idea into another app preserves a link and isolates subsequent work.
- [ ] Offline reload/export and erase/reset work; unavailable sources are explicit.
- [ ] Reviewed promotion is idempotent and does not verify criteria automatically.
- [ ] Browsing/manual edits never call providers; assistance is disclosed and optional.
- [ ] Existing Prepare Change and protected investigation behavior remain intact.

## Shared walkthrough

Investigate how Chatdex retrieves GitHub code and turns it into evidence. Bring a
question about evidence freshness into the lab as a linked idea, while keeping the
original catalog visible. Record notes, two possible next moves and an estimate;
accept/edit an AI suggestion. Try an external mockup, pause/reload, record a negative
or inconclusive result, and choose a new move. Adapt the idea to a second project.
Prepare a change only when an intervention is chosen. Collect an unfinished result
into a private build story. None of these steps grants agent execution authority.

## Outcome and checks

Documentation revised only. Implementation acceptance remains open. Verification of
this documentation revision is recorded after checks; earlier draft verification is
historical and not evidence that the proposed features exist.

### Documentation verification — 2026-09-08

Local Markdown targets and change-index entries checked; `git diff --check`,
`npm run typecheck`, `npm run lint`, and `npm run test:all` passed (973 frontend
tests and 6 backend tests). These checks validate the current repository after a
documentation-only edit; they do not satisfy the feature acceptance checklist above.

# Acceptance checks

These are requirements for the implementation agent. They have not been run against an integrated landscape; that feature does not exist in this package.

## Functional path

1. Open All projects → Floviate → a region → a finding → its cited source.
2. Confirm the statement, review state, source attribution, and any unavailable-source state are intelligible.
3. Close source → finding → region → project → all projects. Confirm the expected selection and query/filter state are restored.
4. Exercise browser Back/Forward, breadcrumb jumps, direct links, and reload at each level. No navigation should create a workspace or change a review.
5. Search for a finding whose title is not currently displayed. Open it in context, inspect evidence, and return to the overview.
6. Create/rename/reorder a region and move a finding. Reload. Confirm membership persists and the underlying statement/status/evidence is unchanged.
7. Open a finding, leave, and resume it through Where you left off. The highlight explains the actual activity recorded.
8. Select eligible accepted/current findings and enter existing Prepare Change. Pending/rejected/historical objects do not bypass its guard. Creation occurs only through the intended explicit action.

## Scale fixtures

Use deterministic, explicitly labeled synthetic projects at approximately 25, 100, and 300 records. Keep fixtures out of the user's real database. Include accepted and pending current records, historical supersessions, open/resolved questions, contradiction events, multiple citations, missing sources, and records shared between regions. Keep important target records identical across sizes so the tasks are comparable.

At each size run these tasks:

| Task | Passing evidence |
| --- | --- |
| Locate a known decision | Search or region path reaches it without examining every record; log actual navigation steps. |
| Understand an unresolved issue | Inspector exposes the issue, known alternatives/evidence, and why it remains open; does not imply a resolution. |
| Identify relevant evidence | Reach the intended cited message/excerpt and its attribution; return to the same scene. |
| Reach every finding | Complete search/index or recursive navigation covers all distinct eligible IDs, including Uncategorized. |
| Maintain orientation | Region locations remain stable across filters/lenses and returning from details. |
| Keep rendering bounded | Instrument visible region/finding/edge counts and query/render times; aggregation actually reduces the displayed population. |

Use a small representative user walkthrough as well as automated checks. Record measured times/steps and observed failures; do not infer comprehension from a click count alone. Proposed interaction target: find a named decision and its source within one search and a few navigation actions. This is a target, not a measured result.

## Regressions and invariants

- Pending vs accepted, lifecycle state, and evidence-review eligibility remain distinct.
- Old conversation imported today is not labeled recent user work; separate clocks are tested.
- Multi-region membership never duplicates findings or inflates project totals.
- Invalid/deleted/foreign-project region or finding IDs fall back safely without leaking another project's data.
- Parent cycles are rejected; orphaned memberships are recoverable; deleting a region does not delete findings.
- Migration preserves old records; organization survives export/sync/restore under existing contracts. Local resume stays local unless intentionally specified otherwise.
- Two-device organization edits have documented merge/conflict behavior consistent with existing sync; do not claim conflict-free collaboration.
- Existing understanding Panel/Document/History map, source links, review actions, and Prepare Change remain usable.
- No automatic provider call occurs merely from viewing, navigating, or changing a lens.
- No fixture seeding, auto-acceptance, or hardcoded snapshot IDs ship as production behavior.
- Source-only, no-results, deleted-source, and evidence-unavailable-on-this-device states remain honest and navigable.

## Visual and accessibility checks

Capture integrated counterparts of all seven reference screenshots at 1440 × 1000 and inspect them side by side. Preserve the overall design while substituting real current records. Check a narrower desktop width and a phone width separately. Verify labels do not overlap or become tiny, selected finding stays identifiable, long titles wrap, and counts do not cover summaries.

Keyboard users can enter regions, select findings, operate Back, close inspectors, and inspect evidence. Announce route/selection changes, restore sensible focus, support reduced motion, and do not rely on color alone. Avoid hover-only access to essential information.

## Project checks and final report

Read actual package scripts. At the inspected baseline, `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build` exist. Run focused tests during development and the applicable required suite before reporting completion. Distinguish pre-existing failures from regressions.

Final report: implemented scope, files/components affected, tests actually run/results, measured scale behavior, screenshot comparisons, data migration behavior, and remaining limits. Do not deploy.

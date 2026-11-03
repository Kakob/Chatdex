# Decision review experience — build log

Delivery status: [PLAN.md](PLAN.md). Change contract: [SPEC.md](SPEC.md).

## 2026-09-08 — implementation

Inspected DecisionMatrix, DecisionTrace, recovery persistence, Accept/Reject and the
existing detail route. Objects without a newest trace already occur and need source
fallbacks. RecoveryRunSummary is reconstructed from traces, not a durable run report;
failed sessions and original run-wide warning totals cannot be recovered faithfully.
`setObjectReviewState` only updates reviewState and updatedAt; it creates no review
history event and does not accept pending events or record future endorsement.

Implemented compact paginated rows, deterministic local search, session/path groups,
query-state restoration, explicit filter reset, roving keyboard focus, and an evidence
pane. Quotes appear before explanations and expandable code/assumptions. Saved edit
anchors load only when code is expanded. Source links open separately to preserve
list position. Original classifications remain inspectable and filterable; qualified
help also appears in the existing full-detail route. Run and snapshot provenance
explicitly distinguish missing diagnostics from a clean run.

Affected implementation: `DecisionsPage`, `DecisionList`, `RecordedEdits`,
`reviewBrowser`, `EvidenceLists`, `BasisBadge`, and classification help in
`decisionMatrix`; review clarification in `DecisionDetailPage`. Added regression
coverage in `DecisionsPage.test.tsx` using sanitized local fixtures.

No schema, sync, extraction, repository binding, or provider behavior changed. No
real recovery was started and no real candidate review state was changed during QA.

## Verification

- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm run test:all`: 118 frontend files / 973 tests passed; 6 backend tests passed.
- `npm run build`: passed; Vite reports the existing large-bundle advisory.
- Final small navigation/accessibility refinements were followed by typecheck, lint,
  and all 5 tests in `DecisionsPage.test.tsx`, passing again.
- `git diff --check`: passed.

Regression fixtures verify that browsing leaves objects, events and traces equal to
pre-browse snapshots and calls no provider; explicit Accept changes the object while
leaving events/traces untouched. Coverage includes no-trace fallback, search and
filter clearing, grouping, keyboard focus/return, URL state restoration, 47-row
pagination, source targets, original classification and snapshot display, lazy edits,
and the existing disclosure-gated recovery flow.

Browser acceptance used the user's open Chrome localhost:4000 run (203 candidates,
one saved run) without pressing Recover, Accept or Reject. Checked the desktop
split view, selected an existing title-change candidate and read its user/agent
quotes; searched for Copied and inspected its tool quote, explanation and saved
Write hunk. Tab reached the evidence pane. Source opened in a separate tab while
search and selection remained intact. Reload restored the same Copied search,
selected candidate and explanation. No mobile-device browser pass was performed.

## Limitations and follow-up

The presentation makes evidence easier to inspect; it does not correct inaccurate
reconstructions or assign project relevance. Original classification fields remain.
Run-wide diagnostics were not reliably saved and are explicitly unavailable; trace
warning counts are not summed as a health report. Future complete run reports need
a separate persistence design. Search is literal, not semantic; no topic extraction
or automatic grouping beyond session/path is implemented. Reload restores query
state, not pixel scroll. No commit or deployment was made.

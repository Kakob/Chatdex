# Decision review experience — change specification

Owner: [Decision Recovery](../../capabilities/decision-recovery/SPEC.md).
Delivery status and acceptance: [PLAN.md](PLAN.md). Evidence: [BUILD-LOG.md](BUILD-LOG.md).

## Behavior

The Decisions route browses existing understanding objects and their newest saved
traces. It does not call a provider or regenerate data when opened, searched,
grouped, paged, or inspected. The explicit, disclosed Recover decisions flow remains.

- Two columns on desktop: compact candidate rows and a persistent evidence pane.
  On narrower screens the pane follows the list. Each pane scrolls independently.
- Forty rows per page. Search is case-insensitive substring matching over title,
  body, primary path, session name/ID, latest explanation, and decision-level quotes.
  Counts describe filtered candidates, excluding rejected objects as before.
- Group by session or primary path. Path normalization only replaces separators,
  repeated slashes, and a leading `./`; it does not infer repository roots or topics.
  Missing paths/sessions have explicit buckets. Group order follows first appearance
  in the existing chronological read model; within groups original order is retained.
- Session headings include date and ID to distinguish repeated names. All filters
  are explicit and clearable. Nothing is automatically ranked, hidden, or merged.
- Search, filters, grouping, selection, and page live in route query parameters.
  Selecting a row leaves list scroll intact. Source/full-detail links open another
  tab, preserving the review browser. Reload restores query state, not pixel scroll.
- Arrow keys move selection within a page; Home/End select its endpoints. Roving
  focus lets Tab move from the selected row to the evidence pane. Escape in the
  pane returns focus to the selected row when it is on the visible page.
- Selection is inspection only. No candidate is initially accepted or rejected.

## Evidence and review

Rows describe available user, agent, tool, and code evidence, without interpreting
its adequacy. Quote roles precede AI explanations and expandable code. Edit hunks
load read-only on expansion; missing local anchors have an explicit fallback.
Long hunks use a 3,000-character preview per side with a link to the original edit.

Original basis, made-by, unsupported-autonomous and direction-conflict values
remain inspectable. They are not recomputed or relabeled in storage. A user quote
does not prove that the user requested the exact implementation; code evidence
does not prove rationale, inheritance, or adoption. Investigation-derived records
are identified separately. Full detail retains existing advanced actions, with
qualified classification help and explicit review semantics.

Accept/Reject retain `setObjectReviewState`: update the object's review state and
updated timestamp. Reject excludes it from this list but preserves the object,
traces, and events. These actions neither review pending events nor record a
separate endorsement for future work. No new review history event is fabricated.

## Provenance and old data

Display recorded run ID, timestamp, provider/model, repository key and SHA from
the trace, separately from the current binding. `local` is a working-tree marker,
not an immutable SHA. Records without a trace fall back to existing source links.
No snapshot or rationale is inferred to fill a gap.

Run summaries are derived from surviving traces. Complete run-wide diagnostics,
including failed/zero-output sessions, are unavailable in saved data. Trace
warnings may be session-wide or duplicated; never sum them into a run-health total.
Live warnings from a new explicit run remain visible in the mounted page. Persisting
complete future run diagnostics is a separate storage change, not part of this one.

## Capability reconciliation when this ships

These amendments are applied alongside this implementation in the capability spec;
this file records the change rationale, while the capability spec owns the current contract.

| Decision Recovery section | Amendment |
| --- | --- |
| §2.2 | Keep mechanical constraints; clarify they constrain labels rather than prove semantic attribution. |
| §2.7 | Permit neutral evidence-presence cues, explicit filters, pagination, selection and focus accents; prohibit inferred importance/relevance ranking. |
| §6–7 | Keep persisted vocabulary, schema, immutable traces and sync unchanged. No migration. |
| §7.3 | Retain derivations; require qualified presentation and inspectable original values. |
| §10.2 | Replace card list with searchable paginated evidence browser and restorable query state. |
| §10.3 | Add in-place evidence pane; retain advanced detail route and clarify Accept/Reject effects. |
| §10.5 | Require honest provenance, missing-data fallbacks and run diagnostic limitations. |

Repository Integration and Understanding Workspace storage/review contracts do not
change. Decision Investigation remains quarantined: this UI only reads its existing
anchors and opens existing source routes, as the former detail view did.

## Exclusions

No model-based reassessment, automatic consolidation, new extraction, background
provider run, repository refresh/write, new review state, or reversible organization
system. Improved browsing does not repair inaccurate reconstructions; the user still
checks them against sources.

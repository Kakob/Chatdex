# Chatdex understanding landscape — coding-agent handoff

Prepared October 29, 2026. This is an implementation brief and visual reference package, not an implementation patch.

## Assignment

Implement a minimum viable, usable understanding landscape in the user's local Chatdex checkout. Preserve the appearance and spatial interaction of the supplied prototype. The user explicitly likes this UI and does not want it replaced with a card dashboard or an ordinary node-and-edge graph.

Read this brief, VISUAL-CONTRACT.md, and ACCEPTANCE.md. Open reference/index.html and reference/recent.html in a browser, then inspect the screenshots. Inspect the actual repository and its instructions before editing. Make the integrated feature work with real stored records. Do not deploy or change the review state of existing records as part of setup.

## What is in this package

- `reference/index.html`: exact runnable nested-landscape prototype, self-contained.
- `reference/recent.html`: exact runnable recent-work prototype, self-contained.
- `reference/lab.html`: earlier synthetic scale/interface experiment; secondary reference, not the visual design to copy.
- `reference/source/`: original atlas CSS, renderer, shell, snapshot data, and recent-work renderer. Use to port the visual design; do not ship its hardcoded project IDs/data.
- `screenshots/`: seven desktop screenshots rendered from those exact HTML files, not generated concept art.
- `visual-guide.html`: screenshot gallery with captions and links into the runnable prototype.
- `VISUAL-CONTRACT.md`: what must be preserved and which prototype limitations must be fixed.
- `ACCEPTANCE.md`: functional, scale, data-integrity, and visual checks.

Open the HTML directly, or run `python3 -m http.server 8765` from this package and visit `http://localhost:8765/visual-guide.html`. Original-source links target the user's Chatdex at localhost:4000; do not assume that port in production.

## User intent

The user wants to see what is actually known about their projects from the main screen, then click into progressively smaller parts without scroll-to-zoom. Meaning must be visible before entering a region. They want a manipulable landscape that eventually makes every finding reachable, even when only a subset is visible at once.

Navigation: all projects and inspectable connections → project → region/subregion → finding → supporting evidence. Back, breadcrumbs, and a project overview return must preserve context. A recent-work lens should help the user resume an actual task.

MVP lenses: Whole landscape and Where you left off. Later lenses can include what changed, open questions/blockers, goals, and cross-project connections. Do not implement all of those now. Reuse one data projection, renderer, and navigation model so later lenses are additions rather than independent systems.

## Repo baseline — verify locally

Repository: https://github.com/Kakob/Chatdex
Inspected branch: `feature/project-workspace-golden-path`
Inspected SHA: `76affe11f0d9c7a83c338688b290147696ddc84d`
At inspection this branch was 66 commits ahead of main. The local browser resembled this branch, but its exact checkout and uncommitted changes could not be verified.

1. Read AGENTS.md/CLAUDE.md and applicable capability contracts.
2. Check the current branch, HEAD, and worktree changes. Preserve unrelated edits; use an isolated branch/worktree if appropriate. Do not blindly reset to the inspected SHA.
3. Read `docs/assessments/living-project-map-exploration.md`. It is an exploration, not proof all proposed systems are implemented. Follow its small concept-index direction and document any implementation decisions that amend existing contracts.
4. The `feature/research-atlas-mvp` branch is a separate OpenAlex research-directory exploration, not the implementation of this landscape. Do not merge it merely because its name contains atlas.

## Existing code to reuse

All paths below are relative to the Chatdex repo and refer to the inspected SHA; recheck current versions.

| Area | Paths | Reuse / constraint |
| --- | --- | --- |
| Records | `src/types/understanding.ts` | Existing project, object, event, association IDs remain authoritative. Review state and lifecycle status are separate. |
| Current projection | `src/lib/understanding/currentUnderstanding.ts`, `overview.ts` | Reuse loading and rollups, but make population and pending-evidence policies explicit. |
| Entry surfaces | `src/pages/ProjectsPage.tsx`, `ProjectUnderstandingPage.tsx`, `src/components/layout/ProjectWorkspaceLayout.tsx` | Add landscape entry points within existing navigation. |
| History | `src/lib/understanding/map.ts`, `history.ts`, `src/components/understanding/ProjectMapView.tsx`, `HistoryDrawer.tsx` | Existing map is a supersession-chain timeline. Keep it available as a History map; it is not the desired spatial landscape. |
| Sources | `src/components/understanding/EvidenceLinks.tsx` | Existing links use conversation IDs and exact message anchors. Extend inspection without losing those locators. |
| Workspaces | `src/types/preparedChange.ts`, `src/pages/PrepareChangePage.tsx`, `src/lib/prepare/changes.ts`, `fromWorkspace.ts` | Reuse Prepare Change and its accepted/current selection guard. Do not create a second change-packet system. |
| Storage | `src/lib/db/schema.ts`, `src/lib/db/understanding.ts`, `src/lib/sync/serializer.ts`, `engine.ts` | Add durable organization through the existing persistence/sync model and compatibility tests. Schema was version 14; choose the next version from actual HEAD. |
| Resume | `src/lib/db/inspections.ts` | Existing local-only inspection-log pattern can inform resume state. Inspections are not endorsements. |
| Import | `src/lib/import.ts` | Existing-ID imports retain raw versions but skip normalized conversation/message updates. Important limitation for external-work freshness. |

Existing stack includes React 19, TypeScript, React Router, Dexie, Zustand, Vitest, Fuse.js, and TanStack Virtual. No graph database is needed for this slice. Prefer the SVG/DOM approach already demonstrated by the reference before adding a layout dependency.

## Implementation sequence

### 1. Thin organization and projection

Add stable, editable regions with project identity, optional parent region, title, ordering, and membership references. Findings can belong to more than one region without being copied. Count distinct records in project totals. Expose Uncategorized so every eligible record remains reachable.

Keep organization separate from a finding's semantic truth: moving it, renaming a region, or opening a source must not accept/reject/refine the finding. Use typed persistence rather than unstructured JSON hidden in scalar metadata. The repo exploration suggests feature/system understanding objects as concept identities; evaluate that approach against a dedicated organization record, and document the choice. If concepts are stored as understanding objects, explicitly prevent navigational containers from polluting claim counts, proposals, and agent context.

Implement a pure, testable projection that loads existing records and produces regions, preview statements, visible counts, and supported connections. Keep this independent of SVG rendering. Do not introduce another project identity or duplicate imported conversations.

Use a small common lens interface for selection/highlighting/preview content. Preserve spatial positions when switching lenses. Do not build a plugin framework for two views.

### 2. Integrated landscape and inspector

Port the visual language from reference/source/atlas.css and atlas.js into maintainable React components. Suggested responsibilities: LandscapeScene, RegionShape, FindingMarker, LandscapeBreadcrumbs, FindingInspector, SourceInspector, plus a projection service. Names are suggestions, not required architecture.

Add all-projects, project, and region scenes. Clicking enters; the Back control steps to the parent, while browser Back retraces history. Finding and source inspection preserve the map and selection. Include a clear return to all projects.

Use URL-backed state for project, region, selected finding/source, lens, query, and filters where appropriate. Validate stale IDs and parent paths. Persist user organization separately from transient navigation. Preserve the previous scene on closing the inspector or returning from a source.

Provide searching by title/body, status/type filters, and complete accessible results. Show a result's project/region path and reveal it in the map. A bounded scene may display a subset, but every result must be reachable. Do not retain the prototype's six-result truncation without paging or a complete results surface.

Regions show a useful title, one or two anchored statements, and clearly defined counts. Prefer explicit user-pinned representative statements; automatic fallbacks should be deterministic and factual. Do not silently generate assertions or priorities. Handle sparse and empty projects honestly.

Minimal editing: create/rename region, move a finding, reorder regions, optionally pin the representative statement. Use menus/buttons first; freeform dragging is optional and must have a keyboard alternative.

### 3. Where you left off

Keep the same region geometry, emphasizing the last visited location, recent actual in-app activity, and related active change workspaces. Include why an item is highlighted and a reliable resume action. Treat reading, editing, and source chronology as different signals.

Persist a local per-project resume bookmark with stable IDs and an explicit activity timestamp. Reuse inspection infrastructure where its kinds/locators fit; do not treat arbitrary table updatedAt values as user work. Do not seed fake visit history from the old prototype's curated recap.

The recent reference is a manually compiled conversation recap, not a live feed. Its suggested next moves are not user commitments. Production suggestions, if included, must remain labeled and separate from saved intent.

### 4. Existing workflow integration and validation

Allow accepted, current findings to preselect the existing Prepare Change form. Merely navigating must not create a workspace. In the inspected code `?understanding=` only preselects, while `?decision=` can create a replacement workspace in an effect; avoid accidental creation through a generic navigation link.

Show existing related workspaces in the inspector where IDs support the link. Preserve proposal review through existing controls and services. Existing Prepare Change already supports evidence, criteria, hypotheses, verification, learning, and promotion: extend the entry path, not the whole lifecycle.

Test with real sparse projects first, then isolated synthetic datasets at 25, 100, and 300 findings. Complete ACCEPTANCE.md and capture the corresponding integrated screenshots.

## Truth and freshness rules

- Pending, accepted/edited, and rejected review states must remain distinct from current/superseded/resolved lifecycle status. A current proposal is still pending. Do not map all questions to one status that hides their review state.
- CurrentUnderstanding currently excludes intent objects; the temporal map has different inclusion logic. Define a shared eligible-record policy for landscape/counts/search. Link to Intent Trace without silently changing its contract.
- Evidence presence is not proof of a claim. The current projection includes non-rejected pending events in its evidence union; distinguish proposed support from reviewed support. Ready Prepared Change collects accepted/edited event evidence. Preserve that guard.
- CurrentUnderstanding's item activity calculation starts with object.createdAt, which can make old history imported today look like recent work. Separate source occurredAt, recorded/processed time, and actual user interaction time. Do not invent historical approval times from updatedAt.
- The existing event model records contradictions but does not establish a complete paired-claim conflict lifecycle. Show actual contradiction events and their evidence. Do not invent conflict edges or mark disagreement resolved from an accepted event alone.
- Project-level prototype connections are shared-source relationships, sometimes based on pending or weak associations. Label and inspect those relationships; do not turn them into software dependencies.
- Show source date, coverage, and unavailable evidence honestly. Missing local evidence on another device is not no evidence and not verified support.
- Re-importing a growing session currently may leave normalized conversation data stale. For initial in-app resume, disclose this boundary. Before promising fresh external-work tracking, implement source-version-aware update behavior with import regressions. Do not solve freshness by sorting on import time.

## Real data and synthetic data

The reference snapshot was captured Oct 28, 2026 and may now be stale. The Oct 29 inspection observed seven projects; Chatdex had one understanding object, Floviate four, Precedent one, and Cortex none. Many objects/associations were pending. Slop Connoisseur was explicitly a built-in synthetic sample. These are observations, not seed instructions.

Region names, coordinates, terrain, and condensed summaries in the reference are design proposals. Stable app IDs in source links are historical locators, not IDs to hardcode. One personal question is intentionally redacted; keep it redacted in fixtures/screenshots and do not recover its wording for this handoff.

Read the current local database through existing app interfaces. Render real records dynamically. Do not auto-accept, fabricate population, or write snapshot/sample records into the user's database. If the user has sparse data, let them organize existing records and keep source-only regions clear.

## Scope limits

For this MVP defer automatic semantic clustering, autonomous reconciliation, inferred architecture/dependencies, graph-database migration, force-directed layouts, all seven proposed lenses, multiplayer, and a new decision revision framework. Keep existing temporal history and document views accessible.

## Deliver back

Provide a working integrated branch, concise change summary, tests and visual checks actually run, screenshots matching the reference states, migration/sync compatibility notes, and a short list of remaining limitations. Report failures or untested checks plainly. Do not claim the original prototype demonstrates production-scale usability; measure the integrated result.

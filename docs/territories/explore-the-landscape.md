# Territory: Explore the understanding landscape

How stored projects, understanding objects, and user-defined regions become a click-through map, and how a click becomes the next scene. Written 2026-10-29 alongside the implementation (branch `feature/understanding-landscape`); delivery status and open checks live in the [change plan](../changes/understanding-landscape/PLAN.md).

## The question

When I open `/landscape` and click my way down to a source, what is read, what decides what appears on screen, and what — if anything — gets written?

## User-visible behavior

```
/landscape                        all projects as contour islands + shared-source connections
  ↓ click island
?project=P                        that project's regions (or Uncategorized) as islands
  ↓ click region
?project=P&region=R               subregions + finding markers inside one big landform
  ↓ click marker
…&finding=F                       right-hand inspector: statement, review/lifecycle, evidence, history
  ↓ click evidence
…&source=C                        cited messages with speaker/time; "Back to finding"
```

Back steps one level, breadcrumbs jump to ancestors, Escape steps out, browser Back retraces. `lens=recent` ("Where you left off") keeps the same places but highlights what you last opened; clicking an island opens a resume panel instead of entering. `panel=list` and `panel=organize` open the complete list and the region editor. `q` and `filter` drive search and dimming. [CODE]

## Entry point

- Route: `src/App.tsx` — `landscape` → `LandscapePage`; `landscape/lab` → `LandscapeLabPage` only when `import.meta.env.DEV`. [CODE]
- Page: `src/pages/LandscapePage.tsx` — loads once, then derives everything from the URL.
- Links in: sidebar (`Sidebar.tsx`), Projects page button, project header "View on landscape" (`ProjectWorkspaceLayout.tsx`, via `landscapeHref()`).

## Control-flow path

```
LandscapePage
  loadLandscape()                                   lib/landscape/load.ts
    Dexie: understandingProjects, understandingObjects, understandingEvents,
           projectAssociations, landscapeRegions, conversations (names only),
           inspections (landscape:* rows), preparedChanges
    ↓
  assembleLandscape(input)                          lib/landscape/projection.ts  (pure)
    eligible-record policy → findings Map
    region tree per project (+ virtual Uncategorized, + virtual "No project")
    distinct counts, previews, shared-source connections
  assembleResume(landscape, inspections, changes)   lib/landscape/resume.ts      (pure)
    ↓
LandscapeView
  parseParams(searchParams) → resolveView(landscape, params)   lib/landscape/route.ts
    validates ids; drops unknown/foreign ones; reveals a finding in a region
    that holds it directly; corrected → navigate(replace)
  lens = wholeLens | recentLens(resume)             lib/landscape/lens.ts
  matcher = makeMatcher(q, filter)                  lib/landscape/search.ts
    ↓
  AllProjectsScene | ProjectScene | RegionScene     components/landscape/LandscapeScene.tsx
    layoutPlaces() / contourRings() / wrapLines()   lib/landscape/geometry.ts
  Inspector → FindingPanel | SourcePanel | ConnectionPanel |
              ResumePanel | ListPanel | OrganizePanel   components/landscape/LandscapeInspector.tsx
```

Every link inside the page is produced by `toHref()`, which returns a *relative* `?query` (or `.`), so the same page works at `/landscape` and at the lab route. [CODE]

## Data model

| Thing | Where | Persistence |
|---|---|---|
| Region | `LandscapeRegion` in `src/types/landscape.ts` — projectId, parentRegionId, title, summary, order, `memberObjectIds`, `pinnedObjectIds` | Dexie v16 `landscapeRegions`; syncs as ciphertext, kind `landscape_region`, parentId = project |
| Visit | `inspections` row, `targetKey` `landscape:region:R` / `landscape:finding:R:F` / `landscape:source:R:F:C`, explicit `at` | LOCAL-ONLY (never hooked into sync) |
| Finding, evidence, history | existing understanding objects/events | read-only here |

Regions are organization, not claims: nothing in `src/lib/db/landscape.ts` reads or writes understanding objects or events except to check a finding's project before placing it. [CODE, TEST `db/landscape.test.ts`]

## Rules the projection enforces

- **Eligibility:** drop rejected objects, intents, objects under rejected/missing projects; keep every lifecycle status. [CODE, TEST]
- **Review vs lifecycle:** `tone` is historical / open (current question) / pending / reviewed; pills always show review state and status separately. [CODE, TEST]
- **Evidence support:** `reviewed` only when an accepted/edited event cites the conversation *and* the object is accepted/edited; otherwise `proposed`. A conversation missing locally has `conversationName: null` → "not on this device". [CODE, TEST]
- **Counts:** distinct ids; a finding in two regions counts once; foreign/duplicate/rejected member ids are ignored but left in the record. [CODE, TEST]
- **Tree safety:** a region whose parent is missing or cyclic is lifted to top level. Writes refuse cycles and cross-project parents (`organize.ts::wouldCreateCycle`). [CODE, TEST]
- **Statements:** pins first, then the region's own current findings, accepted before pending, in stable order. [CODE, TEST]
- **Clocks:** `sourceAt` = latest event `occurredAt`; `recordedAt` = object `createdAt`; user activity only from visit rows. [CODE, TEST]

## Rendering and bounds

- The SVG `viewBox` equals the map pane's pixel size (`usePaneSize`, a callback ref so it follows the pane across scene remounts). Labels keep their font size; the grid reflows instead. [CODE]
- `layoutPlaces()` picks the roundest grid for the rectangle and adds an id-hashed jitter, so positions depend only on pane size and stable order — not on filters or lens. [CODE, TEST]
- Island text is stacked from the centre (`IslandLabels`); statements are dropped, never squeezed, when they don't fit. [CODE]
- Scene budgets: ≈230×140 px per place, ≤ 9 per region scene, ≤ 8 regions per project scene (`sceneModel.ts`); the remainder becomes an overflow place linking to the complete list. The selected finding is always kept on screen. [CODE]
- Connection labels: nearest-first search across/along the edge for open terrain not covering islands or other labels; the quadratic curve is bent through the chosen spot. At most 8 edges drawn; all are in the list panel. [CODE]
- Instrumentation: `data-visible-places|findings|edges` on the SVG; `data-render-ms` and `data-projection-ms` on `.ldx`. [CODE]

## Writes and side effects

| Action | Writes |
|---|---|
| Viewing, navigating, switching lens, searching | one local-only `inspections` row per arrival at a region/finding/source (none in the lab) |
| Organize panel / membership / pin | `landscapeRegions` row(s) → sync queue |
| "Prepare a change" links | none — `?understanding=` only preselects in Prepare Change |

No provider call happens anywhere in this territory. [CODE]

## Tests

`src/lib/landscape/{projection,route,organize,resume,scale}.test.ts`, `src/lib/db/landscape.test.ts` (incl. v15 → v16 migration and serializer round-trip). `scale.test.ts` runs the 25/100/300 synthetic fixtures from `lib/landscape/synthetic.ts`.

## Fog

- Two-device edits to one region resolve last-writer-wins on the whole row; concurrent membership changes can be lost. [DOC — change plan]
- Phone-width breakpoints and screen-reader behavior are implemented but unverified. [UNKNOWN]
- Positions are stable at a given pane size, not across sizes (opening the inspector reflows). [CODE]

# Understanding Landscape MVP

Status: Implemented — acceptance pending
Primary capability: [Understanding Workspace](../../capabilities/understanding-workspace/PRD.md)
Affected contracts: Understanding Workspace PRD §13 (graph exploration — amended), §12 panel
(unchanged; linked), Change Workspace SPEC §7.2 (inspections log — new landscape target keys,
still local-only), sync kinds (new `landscape_region`; CLAUDE.md invariant 1 preserved).

Code walkthrough: [territories/explore-the-landscape.md](../../territories/explore-the-landscape.md).
Handoff and visual reference: [START-HERE.md](./START-HERE.md), [VISUAL-CONTRACT.md](./VISUAL-CONTRACT.md),
[ACCEPTANCE.md](./ACCEPTANCE.md), [reference/lab.html](./reference/lab.html) (synthetic).

The design snapshot (`screenshots/`, `visual-guide.html`, `reference/index.html`,
`reference/recent.html`, `reference/source/`) captures real Chatdex records, so it is kept
local-only (listed in `.git/info/exclude`) and is not in the public repository. Links to
those files in this package resolve only on the machine that holds the snapshot.

## Problem

Users could not see what is known about their projects from one place, or click from a
project into progressively smaller parts down to a finding and its evidence. The existing
Map is a supersession-chain timeline, not a spatial landscape.

## What shipped

- **Route `/landscape`** (sidebar "Landscape", Projects page button, "View on landscape" in the
  project workspace header). All projects → project → region → subregion → finding → source,
  click-to-enter, no wheel zoom. Back steps to the parent, breadcrumbs jump to ancestors,
  browser Back/Forward retrace, Escape steps out, mini overview returns to all projects.
- **Visual language ported from `reference/source/atlas.css` / `atlas.js`**: warm terrain, dot
  grid, `blob()` contour rings, serif headings, muted stable project colors, labeled dashed
  shared-source connections, warm-white right inspector with the map still visible. CSS is
  scoped under `.ldx`; the landscape stays light in dark mode by design.
- **One projection, one renderer, two lenses.** `src/lib/landscape/projection.ts` (pure) feeds
  `LandscapeScene.tsx`; lenses (`lens.ts`) only decorate places, never move them.
- **Whole landscape** and **Where you left off** lenses. Recent lens shows the last place you
  opened, why it is highlighted, active change workspaces, and a Resume action to the exact
  region/finding/source.
- **Search and filters** (Everything / Pending review / Open questions / Superseded & resolved)
  over title, body, type, project, region, and source names. Results are complete and paged
  (no six-result cap), show the project/region path, and reveal the finding in context.
  **Complete list** panel lists every finding of the current scene with paging.
- **Minimal organization**: Organize panel (create, rename, describe, reorder ↑/↓, re-parent,
  delete regions) and, in the finding inspector, membership checkboxes and "Pin as summary".
  Menus/buttons only; no dragging.
- **Inspectors**: finding (review state and lifecycle as separate pills, source vs recorded dates,
  evidence with reviewed/proposed support, full event history incl. contradictions, regions,
  related active workspaces, Prepare Change entry); source (exact cited messages with speaker and
  time, assistant-explanation caveat, citation note, unavailable-on-this-device state, link to the
  original); connection (shared conversations, pending-association flag, "not a dependency").
- **Prepare Change entry** via the existing preselect-only `?understanding=` param, offered only
  for accepted/edited current findings. Navigation never creates a workspace.
- **Dev-only synthetic lab** `/landscape/lab?size=25|100|300` (in-memory fixtures, read-only,
  registered only when `import.meta.env.DEV`; verified absent from the production bundle).

## Decisions

1. **Dedicated organization record, not understanding objects.** `LandscapeRegion`
   (`src/types/landscape.ts`): project id, optional parent, title, optional summary, order,
   `memberObjectIds`, `pinnedObjectIds`. Regions assert nothing, so they cannot pollute claim
   counts, proposals, or agent context, and moving/pinning cannot touch a finding's text,
   review state, lifecycle, or evidence (tested). Feature/system understanding objects as
   concept identities (living-project-map-exploration) were rejected for this slice for exactly
   that pollution risk.
   *Extended 2026-11-03 by [editable-landscape](../editable-landscape/PLAN.md):* regions are
   shown as concepts and gain description, kind, and revision history; statements about a
   concept are separate user-origin objects, so this decision stands.
2. **Storage.** Dexie v16 adds `landscapeRegions` (additive). Syncs as ciphertext, kind
   `landscape_region`, parentId = project id; title/summary/membership stay inside the
   ciphertext. Backend kind enum and Drizzle type updated; no SQL migration needed
   (`kind` is varchar(32)). **Two-device edits:** last-writer-wins per region row, the
   engine's existing record semantics — concurrent membership edits to the same region on two
   devices can drop one side's change. Not conflict-free.
3. **Resume state reuses the LOCAL-ONLY `inspections` log** (`kind` node/evidence, target keys
   `landscape:region:…`, `landscape:finding:…`, `landscape:source:…`) with an explicit `at`.
   Never synced, never sent to a provider. Workspace-scoped consumers filter by `workspaceId`,
   which landscape rows never set.
4. **Eligible-record policy** (projection header): rejected objects and intents excluded
   (Intent Trace keeps its own contract), objects under rejected projects excluded, every
   lifecycle status included, unassigned objects shown in a virtual "No project" place.
   Counts match the Projects page (`understanding/overview.ts`), guarded by a parity test:
   distinct *current* findings (pending included), "to review" = pending findings + pending
   changes to findings, open = current questions. Superseded/resolved findings stay on the map
   and are counted separately. The Projects page overview now leaves intents out, as its own
   header and the per-project panel already did (2026-10-29).
5. **Evidence support.** "Reviewed" only when an accepted/edited event cites the conversation
   *and* the object itself is accepted/edited. (Found in live testing: a pending AI object's
   `introduced` event is stored as accepted, which would otherwise have read as reviewed.)
6. **Three clocks kept apart:** reading (visit log), editing (Prepared Change `updatedAt`), source
   (event `occurredAt`). `object.createdAt` is shown only as "Recorded in Chatdex", never as work.
7. **Representative statements:** user pins first, else a deterministic fallback of the region's
   own current findings (accepted before pending). No generated text.
8. **Layout:** deterministic grid with id-hashed jitter, keyed by stable order; SVG viewBox equals
   the pane's pixel size, so labels keep their size and the arrangement reflows instead of
   shrinking. Scene budgets come from available space (≈230×140 px per place, max 9 per region,
   8 regions per project scene); the rest is reached through an overflow place and the
   complete list. Connection labels are placed nearest-first in open terrain and the curve
   bends through them.
9. **Reference hover bug fixed:** atlas.css set `fill-opacity: .95` on hover, flooding the island.

## Verification (2026-10-29)

Automated (all passing): `npm run typecheck`, `npm run lint`, `npm test` (131 files / 1075 tests),
`cd backend && npm test` (53) and `npm run typecheck`, `npm run build`.
New tests: `src/lib/landscape/{projection,route,organize,resume,scale}.test.ts`,
`src/lib/db/landscape.test.ts` (organization never alters the finding, cycle/cross-project
refusal, delete keeps findings and lifts subregions, reorder, serializer round-trip,
v15 → v16 migration preserves records), schema-version guards bumped to 16.

Scale (synthetic fixtures, Node/jsdom; projection averaged over 20 runs):

| Records | Projection | Search | Regions | Largest region population | Visible budget |
|---|---|---|---|---|---|
| 25 | 0.19 ms | 0.05 ms | 22 | 4 | ≤ 9 |
| 100 | 0.38 ms | 0.09 ms | 24 | 10 | ≤ 9 (+ overflow) |
| 300 | 0.68 ms | 0.26 ms | 24 | 27 | ≤ 9 (+ overflow) |

Every distinct eligible id is reachable through regions + Uncategorized at each size; the target
decision is found in one search and revealed in its region; the unresolved target question shows
its contradiction and no resolution; the target source resolves to its message anchor.

Browser (Chrome, dev server, 1440 px wide, viewport height 778 — not the reference 1000):
- Lab at 100/300: all-projects, project, region, finding inspector, source inspector, search
  (44 matches paged 12 → +24), recent lens dimming, overflow place. Visible counts read from
  `data-visible-*` on the SVG (e.g. region scene 6 places / 4 findings after budget).
- Real records, read-only: All projects (8 places, 3 shared-source connections) → Floviate →
  Uncategorized → "Now tab" finding (Pending review · Current, proposed support) → source
  (exact user message, Oct 3) → Escape back through finding → region with focus returned to
  the marker → browser Back to the finding. Recent lens showed the recorded visit, the sample's
  workspace edit, and source dates separately; Resume landed on the exact source.
- Prepare Change from the sample: preselect link carried the 4 accepted current findings and
  excluded the pending one; Prepare Change opened with them checked; workspace count stayed 1.
- Narrow pane (container forced to 640 px): reflowed to three columns, no horizontal overflow,
  labels kept their size.

Side effects of testing on real data: local-only `inspections` rows for the landscape visits
made above. No understanding records, reviews, regions, or workspaces were created or changed.

## Open acceptance checks

- [ ] ACCEPTANCE functional step 6 in a browser on real data: create/rename/reorder a region,
      move a finding, reload, confirm statement/status/evidence unchanged (covered by unit
      tests; not exercised in the browser to avoid writing synced records without approval).
- [ ] Phone width and the ≤1050 / ≤720 px CSS breakpoints (window resize had no effect in the
      test browser).
- [ ] Integrated screenshots at 1440 × 1000 side by side with `screenshots/`. Real-data captures
      were not committed: the real terrain shows a personal question that the package asks to
      keep redacted.
- [ ] Two-device organization edit, confirming last-writer-wins as documented.
- [ ] Representative user walkthrough with timings (only automated step counts so far).
- [ ] Screen-reader pass (live-region announcements and focus are implemented, not audited).

## Limitations

- Islands reflow when the inspector opens or the pane narrows; positions are stable across
  filters, lenses, and reloads at a given pane size, not across pane sizes.
- More than ~12 projects make the all-projects islands small (titles truncate, never shrink).
- Search is substring AND over terms; no ranking or fuzzy matching.
- Re-importing a growing conversation may not refresh its stored messages (`import.ts`), so source
  dates can lag external work; the resume panel discloses this. Freshness is not solved here.
- Contradictions are shown as recorded events; no paired-claim conflict lifecycle exists.
- Connections are shared-source co-association only; no other relationships are inferred.
- Visit rows are written once per arrival; React StrictMode doubles them in development
  (deduplicated in the lens).
- Deferred per brief: semantic clustering, inferred architecture/dependencies, force layouts,
  further lenses, drag-to-organize, multiplayer.

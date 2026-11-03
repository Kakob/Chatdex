# Visual contract — preserve the landscape

The supplied atlas and recent-work pages are the primary visual reference. The user says: “I want to keep it like that.” The existing dark Chatdex Map is a reuse/integration reference, not the desired appearance.

## Preserve

- A spacious, light, warm green terrain with subtle dot grid and contour lines.
- Organic, nested landforms with multiple outline rings. Projects/regions feel like places to enter rather than cards in a dashboard.
- Muted project colors that stay stable across levels and lenses.
- Serif project/region headings and readable sans-serif controls and metadata.
- Real information directly on the terrain: project/topic names, short meaningful statements, and visible status/count context. Avoid giant unlabeled dots.
- Sparse, labeled connections with an inspector explaining their basis. A line must have a meaning.
- The fixed navigational shell: title/context, Back, breadcrumbs, search/filters, a large map surface, and a small overview return.
- Click-to-enter transitions, not wheel-dependent zoom. Preserve orientation when inspecting or stepping out.
- A warm white right-hand detail panel with the landscape still visible. Finding text, evidence links, status, and history appear here. Source inspection returns to the finding.
- Where-you-left-off regions show the thread title and activity basis before the user clicks.
- Restrained motion, reduced-motion support, keyboard focus, and legible status text in addition to color.

## Reference states

| Screenshot | State | Preserve / inspect |
| --- | --- | --- |
| 01-projects.png | Seven project islands and source overlaps | Information-rich project labels, contours, sparse edges, whole-project orientation. |
| 02-project-landscape.png | Floviate regions | Nested regions, useful summaries, breadcrumbs, mini overview. |
| 03-region-findings.png | Daily rhythm | Findings as labeled places inside a region, not a card stack. |
| 04-finding-inspector.png | Now-tab proposal | Selected marker, persistent map, readable side inspector, pending label. |
| 05-source-inspector.png | Precedent cited explanation | Quote attribution and evidence limits, return to finding, original-source link. |
| 06-recent-work.png | Recent work overview | Thread descriptions visible on the landscape. |
| 07-resume-inspector.png | Chatdex recent thread | Context, possible next move, basis, and route into understanding. |

All screenshots are fresh renders of the preserved prototype files at a 1440 × 1000 viewport (full-page captures), not screenshots of an integrated Chatdex feature. Prototype content was previously curated; dates and claims must not be mistaken for live state.

## Useful implementation values from atlas.css

- Page background #f7f8f3; panel #fffef9; primary ink #243c34; border #dbe3d7.
- Primary green #326c56; pending marker near #bf984b; open question #8976aa; reviewed #60917c.
- Map background is a soft radial gradient: #f8faef → #edf3e5 → #e6eddc.
- Main heading uses ui-serif/Georgia at about 34px; region headings are serif; controls about 12px at desktop.
- Stage radius 16px; inspector roughly 390px at 1440px viewport, 440px on wider layouts.
- Contours are SVG paths from blob()/contours() in atlas.js. The recent-work version uses nested ellipses.

Use the original CSS as the definitive token reference. Adapt dimensions for real data and accessibility; do not redesign the visual language to suit a component library.

## Fix these prototype limitations during integration

- Layout coordinates and counts are hardcoded. Use deterministic, stable layout keyed by persistent IDs. Do not reshuffle regions on every filter, refresh, or lens change.
- findingMap() and regionPositions() support only a few items. Do not scale them by placing all 300 findings on one screen. Add subregions, bounded subsets, and complete results navigation.
- The prototype search displays only six result links; production must let every match be reached.
- Prototype query/filter state is in memory. Make back/reload/deep-link behavior reliable.
- The prototype changes map viewBox and can shrink text with an inspector open. Maintain readable labels at smaller map widths; adjust layout rather than simply shrinking every text label.
- Recent-work coordinates differ from atlas coordinates. Production should retain one stable mental map across lenses, while preserving the style shown here.
- Some original source text is absent. Preserve honest empty states; never invent a quote to make the inspector look complete.
- Organization and review are read-only in this reference. Add editing as light contextual controls; do not crowd the terrain with forms.
- Narrow screens should show one focused scene with a full-width inspector/sheet and obvious Back. The existing responsive reference is a starting point, not proof the seven-project layout is readable at phone width.

The fallback for dense content should remain a landscape with controlled depth and a searchable index. Do not substitute a wall of cards as the default experience.

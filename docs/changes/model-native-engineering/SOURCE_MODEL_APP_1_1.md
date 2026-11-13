# Task 1.1 — connect the deterministic analyzer to Chatdex projects

**Status:** Implemented on feature branch; **manual mobile acceptance pending**  
**Active branch:** [`feature/engineering`](https://github.com/Kakob/Chatdex/tree/feature/engineering)  
**Implementation history:** originally built on `feature/engineering-core-app-surface-1-1`, on top of `feature/engineering-core-analyzer-1`; both histories are included in the consolidated branch.  
**Scope:** Read-only navigation of *actual source-derived structural entities* from a bound GitHub repository **or shipped Todo List / Event Queue source without a repository binding**. This is a UI/data integration follow-up to Task 1, **not** Task 2's phone-to-laptop service or Task 4's editing/reconciliation.

## Why this change exists

Task 1 built `analyzeTypeScript()`, but the application had no route, source-selection action or UI that called it. A green analyzer library was invisible to engineers. This iteration connects it to the existing project workflow with no project-specific graph fixture.

## Open it in the app

1. Check out this branch, install dependencies and run the existing Chatdex web app.
2. Open **Projects**, then a project. **Todo List and Event Queue engineering examples need no repository binding**: their implementation and tests are bundled with Chatdex. For other projects, bind a GitHub repository from the project overview (read-only).
3. Use **Explore source-derived model** in the project header or from the existing engineering model. The direct project route is `/projects/:id/engineering/source`.
4. For GitHub-bound projects, optionally set a folder prefix such as `src/lib/engineering/` or select an individual source file by repo-relative path. For bundled examples the shipped file set is already selected.
5. Press **Analyze repository source** for a bound GitHub project, or **Analyze bundled source** for either unbound built-in example. Both feed the **same portable TypeScript analyzer** and show discovered modules, symbols, code excerpts and supported structural relationships. GitHub analysis resolves an immutable SHA and uses `RepoSource` / `ensureIndexed`; bundled analysis uses actual build-time `?raw` source text with **no claimed Git revision**.
6. Use **Filter source entities** to locate an operation, or expand the file groups. The inspector shows the exact analyzed source text; GitHub results display their pinned commit, while bundled examples are explicitly labeled as unpinned shipped snapshots.

For private repositories, configure the existing device-local GitHub credential with read access. The browser makes read-only GitHub API requests to the same hardened client used by Intent Trace and Change Workspace. No LLM call is made and no source data is uploaded to Chatdex's sync backend.

## Implementation

- `src/lib/engineering/core/fromBundled.ts` and `src/lib/engineering/bundledSources.ts`: choose shipped, real implementation/test files for either built-in example, without a GitHub binding, fake SHA or special-cased graph output.
- `src/lib/engineering/core/fromRepository.ts`: accepts an arbitrary `RepoSource` with a pinned revision, safe optional prefix and bounded file selection. Uses `ensureIndexed()`, its policy gates and the existing local-only `repoFiles` cache, then dynamically loads the portable analyzer. Reports candidate/eligible/selected/analyzed counts and skipped/truncated input.
- `src/pages/SourceDerivedProjectPage.tsx`: explicit source-analysis action, coverage/diagnostics, nested module/symbol navigation, relevant code excerpts and navigable relationships. No static app-specific source map.
- `src/App.tsx`: registered project source-model route.
- `src/components/layout/ProjectWorkspaceLayout.tsx`: project header entry point.
- `src/pages/EngineeringProjectPage.tsx`: direct source analysis entry from existing example and generic engineering views.
- Tests: `src/lib/engineering/core/fromRepository.test.ts` and `src/pages/SourceDerivedProjectPage.test.tsx`.
- CI: `.github/workflows/engineering-core-app-surface.yml`.

## Raw visual source graph (now advanced, not the mobile default)

The source-analysis result now opens with **Visual source model**, an interactive graph **derived entirely from the analyzer's current source entities and typed relationship edges**. The earlier source list and code inspector remain below it as alternate navigation.

- **System map** (default) groups actual declarations inside their source modules. It draws selected-entity links initially to avoid a confusing wall of arrows; **Show all links** reveals every relationship represented in the displayed subset.
- **Connections** draws a one-hop neighborhood for the selected entity, with incoming nodes to the left, the selection in the center and outgoing nodes to the right. Selecting a neighbor immediately refocuses the graph.
- Relationship filters show **calls**, **references**, **imports**, **exports**, and **contains** as colored, directed links. Source containment is also visible as file-group membership.
- Tap a graph node to select its exact analyzer entity. The existing source inspector and relationship list update to the selected declaration. Source-list selection likewise updates graph highlighting.
- The canvas is two-directionally scrollable on a phone with explicit **zoom in**, **zoom out** and **reset zoom** controls.
- The overview draws at most 180 entities; a neighborhood draws at most 14 neighbors. The UI explicitly reports nodes/edges outside these visual limits; it does not fabricate missing implementation relationships.

**Important boundary:** These are *static TypeScript structure and supported source references*, not execution traces, Daniel Jackson software concepts, or behavioral verification. A visually connected pair is an analyzer-reported relationship at the analyzed snapshot; lack of an arrow may reflect incomplete analysis input, filtering or visualization limits. Nothing in this view writes to the repository or laptop.

**Tests:** `src/lib/engineering/core/graphLayout.test.ts` verifies deterministic, source-faithful layout and visual truncation; `src/components/engineering/SourceGraphCanvas.test.tsx` verifies real node/edge SVG output, filtering, taps, switching views and zoom. `src/pages/SourceDerivedProjectPage.test.tsx` verifies graph-to-code-inspector selection. The unified engineering CI runs these with existing Todo and Event Queue tests.

**Manual acceptance to check on iPhone:** Analyze the unbound Todo List; scroll to **Visual source model**; choose a source entity (such as `todoTransition`), switch to **Connections**, and tap a related node. The inspector below should show that selected entity's real code. Repeat on Event Queue and on a small GitHub-bound folder.

## Operation-focused mobile redesign and reload recovery (November 12)

After real iPhone dogfooding, the all-entities graph proved visually overwhelming and not informative about system behavior. The analysis also vanished after a page reload because it existed only in component state. The current behavior is:

- **Operation lens first:** The default visual experience selects an actual function or method and shows *called by → selected operation → direct calls* as a compact, one-operation-at-a-time map, with no pan/zoom or dozens of repeated properties. A searchable row lists non-test implementation operations. The call edges are analyzer facts, not observed execution order.
- **More useful source evidence:** The selected operation shows declared parameters and return types, referenced data types, literal switch/case and if/loop conditions, and source-level calls appearing in switch cases. It can point to test files mentioning a function name, explicitly **not** proof of coverage or correctness.
- **Code inspection nearby:** The real source inspector appears immediately after the operation view on mobile; the exhaustive source list is secondary. The earlier raw symbol graph is available under **Raw source relationship map (advanced)**, not shown by default.
- **Local snapshot persistence:** After successful analysis, one bounded result per project, its exact analyzed source text, and the last selected symbol are saved in the existing **local-only** engineering Dexie database (additive version 4). On page reload, Chatdex restores the result without another GitHub/LLM request or full parse. A **Forget saved analysis** action deletes that project's cached result.
- **Truthful freshness:** The last analysis of a GitHub-bound repository stays linked to the original commit SHA. If the bound repository or ref changes, an incompatible saved result isn't reused. For a bundled example, if a new development build changes the raw source text, the old analysis is restored as **historical/stale**, with a warning and a reanalysis control; it does not silently masquerade as the new code.
- **Persistence limitations:** Storage is per browser/device and can be lost if site data is cleared or the browser refuses storage; failures display an explicit warning. The analysis is not synced and is not a live model of the laptop's working tree.

**Why reloads may still happen:** Chatdex is often opened on an iPhone through Vite's **development** server. Vite hot updates and full page reloads can occur when frontend source files change or are pulled into the laptop working tree. The analysis page itself does not request recurring navigation or reloads, but we have **not verified the precise trigger on the user's machine**. Persistence addresses losing analysis, not eliminating Vite's development reloads. To evaluate a more stable snapshot without HMR, one can serve a built version using the existing `npm run build` and `npm run preview -- --host 0.0.0.0` commands (on an unused port); that preview does not update until rebuilt.

**Still missing:** Persistent, authored *software concepts* in Jackson's sense; verified behavioral contracts; execution traces; model-to-code edits; code-to-concept reconciliation; and phone-to-laptop guarded writes. Static call structure and branch recognition are a better starting point for investigation, but not yet a complete semantics-level engineering abstraction.

**Test contracts:** `operationLens.test.ts` checks real Todo dispatch cases, call structure and Event Queue operations; `sourceAnalysisCache.test.ts` checks restored snapshots, selections, local version boundaries and stale build snapshots; `SourceDerivedProjectPage.test.tsx` simulates a full reload and checks that operation selection persists. Existing source and CI tests must remain green.

## Explicit bounds

- **Source provenance:** GitHub results are revision-pinned snapshots, while built-in examples are source text bundled into the current web app build; **neither** represents a live local working tree. Reading the laptop's files from an iPhone is still Task 2.
- **Read-only:** You can inspect the derived graph and code but cannot edit/write code from it here. Guarded model-directed edits/reconciliation are Task 4.
- **Partial input:** Each explicit run selects at most **40 TypeScript files**, with a **3 MiB** analysis budget plus existing per-file limits. The view warns about file-cap, policy and repository-tree omissions. Narrow to a subsystem. A missing edge may be caused by missing input, not absence in the full codebase.
- **Analysis is not semantic understanding:** Modules, supported declarations and references are compiler-derived facts at a source revision. The view does not automatically generate Daniel Jackson software concepts, verify behavior or reconcile authored concepts.
- **No background synchronization:** The graph is rebuilt only when explicitly running analysis again. A new commit does not automatically change the graph.
- **Existing authored views remain unchanged:** The Event Queue and Todo List authored Explorers stay separate. The source-derived view now analyzes their actual bundled code without any repository binding. The file manifest selects example input; the analyzer does not use authored model entities or relations.
- **No new back-end service:** GitHub reading continues through the browser and existing local cache.

## Validation and acceptance

GitHub Actions on this branch runs typecheck, lint, analyzer and repository-indexer tests, new page/adapter integration tests, existing engineering project routing tests, Event Queue tests and the production Vite build.

The tests confirm that analysis is explicit rather than triggered on page mount; no repository binding produces an actionable message; a generated symbol leads to exact source; incomplete input is labeled; no made-up source is returned on reader failure; and the same source reader/cache is reused.

**Manual phone acceptance is pending:** on the user's iPhone, analyze the unbound Todo List and Event Queue examples, inspect source-derived methods, and also analyze a small folder of a real repository-bound project. Do not claim this test has occurred merely because jsdom and GitHub CI passed.

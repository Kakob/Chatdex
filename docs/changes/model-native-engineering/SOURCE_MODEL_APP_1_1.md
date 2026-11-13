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
3. Use the **Analyze source (new)** link in the project header, or **Analyze real repository source** from the existing engineering model. The direct project route is `/projects/:id/engineering/source`.
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

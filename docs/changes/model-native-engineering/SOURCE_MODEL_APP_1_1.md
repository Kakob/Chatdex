# Task 1.1 — connect the deterministic analyzer to Chatdex projects

**Status:** Implemented on feature branch; **manual mobile acceptance pending**  
**Active branch:** [`feature/engineering`](https://github.com/Kakob/Chatdex/tree/feature/engineering)  
**Implementation history:** originally built on `feature/engineering-core-app-surface-1-1`, on top of `feature/engineering-core-analyzer-1`; both histories are included in the consolidated branch.  
**Scope:** Read-only navigation of *actual source-derived structural entities* from an existing project's GitHub binding. This is a UI/data integration follow-up to Task 1, **not** Task 2's phone-to-laptop service or Task 4's editing/reconciliation.

## Why this change exists

Task 1 built `analyzeTypeScript()`, but the application had no route, source-selection action or UI that called it. A green analyzer library was invisible to engineers. This iteration connects it to the existing project workflow with no project-specific graph fixture.

## Open it in the app

1. Check out this branch, install dependencies and run the existing Chatdex web app.
2. Open **Projects**, then a project. Bind a GitHub repository from its overview if none is configured. The binding is **read-only**.
3. Use the **Analyze source (new)** link in the project header, or **Analyze real repository source** from the existing engineering model. The direct project route is `/projects/:id/engineering/source`.
4. Optionally set a folder prefix such as `src/lib/engineering/` or select an individual source file by repo-relative path. Leaving it blank selects the first supported files from the repository.
5. Press **Analyze repository source**. Chatdex resolves the bound ref to a Git SHA, reads a limited set of TypeScript files through its existing `RepoSource` / `ensureIndexed` infrastructure, builds a derived graph, and shows modules, symbols, code excerpts and supported structural relationships.
6. Use **Filter source entities** to locate an operation, or expand the file groups. The inspector always displays source text from the exact analyzed commit.

For private repositories, configure the existing device-local GitHub credential with read access. The browser makes read-only GitHub API requests to the same hardened client used by Intent Trace and Change Workspace. No LLM call is made and no source data is uploaded to Chatdex's sync backend.

## Implementation

- `src/lib/engineering/core/fromRepository.ts`: accepts an arbitrary `RepoSource` with a pinned revision, safe optional prefix and bounded file selection. Uses `ensureIndexed()`, its policy gates and the existing local-only `repoFiles` cache, then dynamically loads the portable analyzer. Reports candidate/eligible/selected/analyzed counts and skipped/truncated input.
- `src/pages/SourceDerivedProjectPage.tsx`: explicit source-analysis action, coverage/diagnostics, nested module/symbol navigation, relevant code excerpts and navigable relationships. No static app-specific source map.
- `src/App.tsx`: registered project source-model route.
- `src/components/layout/ProjectWorkspaceLayout.tsx`: project header entry point.
- `src/pages/EngineeringProjectPage.tsx`: direct source analysis entry from existing example and generic engineering views.
- Tests: `src/lib/engineering/core/fromRepository.test.ts` and `src/pages/SourceDerivedProjectPage.test.tsx`.
- CI: `.github/workflows/engineering-core-app-surface.yml`.

## Explicit bounds

- **GitHub snapshot, not the laptop working tree:** The source is fetched at a resolved commit, not a live local folder or working tree. Reading laptop code from an iPhone is still Task 2.
- **Read-only:** You can inspect the derived graph and code but cannot edit/write code from it here. Guarded model-directed edits/reconciliation are Task 4.
- **Partial input:** Each explicit run selects at most **40 TypeScript files**, with a **3 MiB** analysis budget plus existing per-file limits. The view warns about file-cap, policy and repository-tree omissions. Narrow to a subsystem. A missing edge may be caused by missing input, not absence in the full codebase.
- **Analysis is not semantic understanding:** Modules, supported declarations and references are compiler-derived facts at a source revision. The view does not automatically generate Daniel Jackson software concepts, verify behavior or reconcile authored concepts.
- **No background synchronization:** The graph is rebuilt only when explicitly running analysis again. A new commit does not automatically change the graph.
- **No changes to authored examples:** Existing engineered Event Queue and Todo List views remain separate. The derived view is available to normal projects, with no new project-specific adapters.
- **No new back-end service:** GitHub reading continues through the browser and existing local cache.

## Validation and acceptance

GitHub Actions on this branch runs typecheck, lint, analyzer and repository-indexer tests, new page/adapter integration tests, existing engineering project routing tests, Event Queue tests and the production Vite build.

The tests confirm that analysis is explicit rather than triggered on page mount; no repository binding produces an actionable message; a generated symbol leads to exact source; incomplete input is labeled; no made-up source is returned on reader failure; and the same source reader/cache is reused.

**Manual phone acceptance is pending:** open a real repository-bound project on the user's iPhone, analyze a small folder, browse a class method and inspect its code. Do not claim this test has occurred merely because jsdom and GitHub CI passed.

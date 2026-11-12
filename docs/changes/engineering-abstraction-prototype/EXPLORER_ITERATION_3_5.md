# Engineering Explorer — Iteration 3.5: reusable model, source bindings, impact projection

**Branch:** `feature/engineering-general-model-3-5` (from `feature/engineering-model-iteration-3`)  
**Route:** `/projects/:id/engineering`, plus the original standalone queue demo  
**Scope:** shared engineering model and inspection, repository-cache integration, read-only change impact  
**Status:** committed; GitHub checks and real-phone acceptance to determine verification

## Architectural decision

An engineering **project** is not synonymous with a Git repository. A project can model the Event Queue or Todo List as a *scope of the Chatdex repository*, or describe a system that is not yet implemented. Native project identities and authored concepts remain in the existing Chatdex tables.

The durable engineering contract is **identities + typed relationships + source bindings + proposed changes**, not any specific diagram layout, runtime adapter, GitHub repository or file extension.

The Event Queue and Todo List keep their different executable UI controls, but they now share the same model projection and source binding lookup. A third ordinary Chatdex project can navigate its existing concepts with the generic Explorer, without a bespoke React page, model storage implementation or inspector.

## What changed

### 1. One project-agnostic graph projection

`src/lib/engineering/modelGraph.ts` derives:

- Hierarchy, parents, children, nesting depth, and stable entity identity from existing `LandscapeRegion` records.
- Typed relationships, source/target IDs, and proposed-only labels from shared `ProjectEngineeringModel` records.
- Dangling-edge diagnostics instead of fabricating missing nodes.
- A bounded, directed graph traversal of **potentially affected** entities and related source files, including useful directly connected references.

The impact result is always `potential-only`. It is **not** a sound dependency closure, a compiler, a test result or an implementation plan. The traversal is limited to a small hop count and reported source bindings may themselves be stale or authored.

### 2. General model storage, not two hard-coded databases

`src/lib/engineering/modelStore.ts` now loads **any existing Chatdex project**, including projects with no Event Queue/Todo List adapter. Its model kind is `null` where no example runtime applies.

New generic APIs permit manually authoring typed relationships and linking source files to existing model entities. These perform same-project endpoint checks and source-path safety checks.

The Dexie database `chatdex-engineering-model-v1` has an additive **version 2** with a `sourceBindings` table. Existing transitions and append-only proposal events survive the upgrade. It remains local-only; the canonical project concepts still use Chatdex's normal local-first/syncable tables. Do not suggest local engineering proposals are synced.

Explicit **Projects → Add engineering examples** installs missing bindings idempotently for already installed example projects; opening a project never silently installs fixtures or rewrites project data.

### 3. Existing repository reader is the code source

`src/lib/engineering/sourceCatalog.ts` introduces explicit `EngineeringSourceBinding` records:

- `projectId`, `targetId`, `role` (implementation/test/documentation)
- `repoKey`, repository-relative `path`, optional `sha`
- `sourceKind` (`bundled` or `indexed`)
- authored symbol/text anchor (`needle`), origin and label

`resolveSourceBinding()` reads `indexed` bindings using **the existing `getRepoFile(repoKey, sha, path)` service**. That cache is populated by the existing indexer and its GitHub/local-directory `RepoSource` adapters, including its size, path, sensitivity and read-only safeguards.

A demo binding with source bundled by Vite remains explicitly **unpinned**; we never fabricate a commit SHA or give it a misleading immutable GitHub link. Indexed bindings require a real snapshot identity. A pinned GitHub link is shown only when the binding has a 40-character commit hash and a valid GitHub repository key.

The reusable `BoundSourceInspector` displays real snippets in the existing wrapped mobile code viewer. It reports not-indexed files, missing authored anchors and missing bindings instead of inventing source evidence. Both example pages have dropped their duplicate code/test-path and needle maps. The few synthetic bundled source files are centralized in `bundledSources.ts`.

Existing Iteration-2 example projects without newly installed binding records still have a **known-demo fallback** from the shared fixture catalog, so their code viewer doesn't stop working on the phone until you explicitly upgrade.

### 4. One generic project Explorer

`src/pages/GenericEngineeringExplorerPage.tsx` renders an ordinary Chatdex project's authored concepts in a compact hierarchical structure/inspector interface.

Every project workspace now links to **Open engineering model** at `/projects/:id/engineering`; the special Event Queue and Todo List routes still activate their real queue/reducer controls, while any other project receives the generic Explorer with model review, code/test inspection when bound, proposal history, and potential impact. A project with no authored concepts gets an honest empty state.

This **does not** mean Chatdex automatically extracts a full architecture from arbitrary code. A generic project needs concepts and bindings, or a future source analyzer. No new language parser or repository reader is introduced here.

### 5. Shared impact preview

`ModelImpactPreview.tsx` is used by the same ModelInspector for both demo programs and the generic third project. It identifies directly connected entities, bounded relationship traversal, and related source paths as **candidates to investigate**. It does not write code, approve proposed changes or treat a diagram edge as a verified dependency.

## Explicit non-goals / next milestones

- **No code writing or repository mutation.** Read-only source inspection and authored model proposals only.
- **No new Git repositories** for Queue or Todo; both remain scopes of `Kakob/Chatdex`.
- **No automatic symbol parser in 3.5.** The existing repo reader is reused as the source boundary. The next Iteration 3.6 can add a deterministic TypeScript symbol/route/import extractor over indexed files.
- **No automatic runtime adapters for arbitrary projects.** Only the two examples have live execution.
- **No claim that the hardcoded diagram geometry is fully generic.** The queue keeps its compact custom geometry and Todo keeps its task controls. The generic Explorer reuses model projection and inspector but presents larger systems as a hierarchical list rather than a bespoke canvas. Alternative model views can build on this shared projection later.
- **No automatic acceptance/sync for proposed models.** A preview is not implemented or verified behavior.

## Validation / acceptance

    git fetch origin
    git switch --track origin/feature/engineering-general-model-3-5
    npm install
    npm run dev -- --host 0.0.0.0

On your phone, navigate to Projects → Add engineering examples **again** (idempotent: fills missing local bindings without recreating your projects). Then:

1. **Event Queue:** open its engineering model; inspect Worker → Code and Retry → Tests. You should see the same actual checked-in TypeScript as before, wrapped for mobile, now found via shared bindings. Run enqueue/claim/fail/expire/retry and ensure the diagram still follows actual queue state.
2. **Todo List:** add/toggle tasks. Select Active → Code, then Tests. Verify that model proposal overlay, revision history and inspector expansion still work and task behavior is unchanged.
3. **Generic project:** open any ordinary project with authored concepts at `/projects/<id>/engineering`. Inspect its hierarchy and edit a model proposal. Code and Tests should *explicitly say no binding* unless manually attached to indexed source; they must not invent links.
4. **Change preview:** from Understand → Shared model, expand Potential impact preview. It should name bounded connected concepts, relationships and actual bound paths, explicitly labeled unverified candidates.
5. **Mobile:** preserve orientation and readable wrapped source; expand inspector for long source, return to diagram/list.

Automated checks cover typecheck, lint, model graph tests for **three** project shapes, source resolution from the existing indexed file cache, generic Explorer interaction, existing queue/todo UI and the actual event queue test suite. See `.github/workflows/engineering-general-model-3-5.yml`.

The repository has had an unrelated pre-existing full-suite failure in `src/lib/investigation/constraints.test.ts` (invalid span [0,20) for length 9) in earlier branches. This iteration's focused checks don't claim that failure is fixed.

## Definition of success

1. Queue and Todo code/tests are found through the **same source binding layer**.
2. Project hierarchy, typed relationships, current/proposed names and impact candidates come from **the same pure projection**.
3. A third ordinary project with existing concepts can use the generic Explorer and indexed source cache without a custom renderer, storage backend or source reader.
4. The app never presents a proposed model or an unverified source binding as a code change or established runtime fact.

**Follow-on:** Iteration 3.6 should build deterministic structural extraction *above* the existing reader and write reviewable source facts into the same model, preserving project/repository scope and exact file revision. Iteration 3.7 can provide hierarchical model change preparation with inspectable obligations before any write path is considered.

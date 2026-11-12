# Explorer iteration 3 — shared, persistent engineering model proposals

**Branch:** `feature/engineering-model-iteration-3` (based on `feature/engineering-live-projects`)
**Scope:** shared typed model, editable design proposals, append-only revisions, diagram overlays for Event Queue + Todo List
**Status:** implemented, CI and iPhone/browser acceptance pending
**Non-goal:** modifying actual runtime behavior or compiling model edits into source code (planned for iterations 5/6)

## Why

The two original Explorers drew manually authored diagrams and ran genuine example programs. They did not yet have a shared, editable model: titles/descriptions were split between native Chatdex project concepts and page-specific code, and relationships were authored in code only. New model edits also must not masquerade as implemented behavior.

This iteration tests an intermediate programming primitive: **a project-associated engineering model that can be changed and versioned without modifying the program.**

## Data model / ownership

**Native Chatdex projects/concepts remain canonical.**
- `UnderstandingProject` records own project identity.
- `LandscapeRegion` records own existing component/state identity, description, kind, and containment.
- Neither is overwritten by an engineering proposal; native editing and synced history remain separate.

**New local-only engineering-model database `chatdex-engineering-model-v1`:**
- `transitions`: typed, directional authored relationships (`flow`, `state_transition`, `depends_on`, `verified_by`). Stable IDs and project-bound endpoint IDs. These are small real records, not a second copy of a project concept.
- `proposals`: append-only events per concept/transition with an explicit baseline, proposed name/description, timestamp, revision sequence, and action (`propose` or `withdraw`).

The database is not part of the regular sync adapter. Proposals and transitions are local to this browser/device; they are not accepted understanding claims, Git commits, runtime configuration, or verified behavior. Normal project concepts already created in the prior iteration are stored in Chatdex's usual local-first/syncable table. This intentional mixed persistence is an experimental boundary, not complete cross-device collaboration.

**Example-specific adapters:** `modelCatalog.ts` supplies initial authored relationships for each example. It uses a single shared relationship type and storage API, and references the already-existing project concepts via their stable IDs. The Event Queue has 9 authored transitions and Todo List has 6. They are explicitly installed when the user clicks **Projects → Add engineering examples**; installing again only repairs missing records, keeping existing edits.

**Model projection:** `loadEngineeringModel(projectId)` composes the native project concepts, local authored transitions, and most recent proposal event. It exposes `current`, `proposed`, `stale`, and full `revisions` per element. It does not rewrite the original data.

## User interaction

On either sample project's engineering route:
1. Tap a component/state in the diagram.
2. Under the **Understand** inspector, open **Shared model**.
3. See the **current project definition**, then select **Propose model edit**.
4. Change its name/description, and **Save model proposal**.
5. The diagram displays the proposed name with an amber dashed visual distinction. The proposal panel explicitly says **Not implemented or verified**. The source code and running app are unchanged.
6. Use **Connected transitions** to inspect/edit an authored edge with the same proposal and history behavior.
7. Open **Model revision history** to inspect earlier proposals, including withdrawals.
8. Select **Withdraw draft** to remove the proposed overlay without deleting history.
9. Reload; local proposed edits and revisions should reappear.

**Stale baseline rule:** the first proposal records the exact existing project/model wording. If the canonical project concept changes independently, the proposal appears stale; it cannot be revised until withdrawn and created anew. Withdrawing does not modify the canonical concept.

**No automatic source editing:** any displayed proposed name is a design overlay only; running EventQueue and the todo reducer continue using their current code and existing behavior.

## Files

- `src/lib/engineering/modelCatalog.ts`: shared typed relationship vocabulary and per-example authored edges.
- `src/lib/engineering/modelStore.ts`: local-only Dexie storage, projection, proposal/withdraw and stale logic.
- `src/components/engineering/ModelInspector.tsx`: shared inspector UI + loading hook.
- `src/components/engineering/SystemDiagram.tsx`: proposed-only overlays and amber dashed cues.
- `src/pages/EngineeringExplorerPage.tsx` and `TodoExplorerPage.tsx`: same model inspector in both executable projects.
- `src/pages/ProjectsPage.tsx`: explicit installation of missing transition records.
- `src/lib/engineering/modelStore.test.ts`, `src/components/engineering/ModelInspector.test.tsx`: tests for isolation, stable IDs, persistence, revision history, stale baselines, transition editing.
- `.github/workflows/engineering-model-iteration-3.yml`: focused tests, typecheck, lint, real queue tests and production build.

## Acceptance checks

Install or refresh example projects explicitly, then open their engineering models:

    git fetch origin
    git switch --track origin/feature/engineering-model-iteration-3
    npm install
    npm run dev -- --host 0.0.0.0

On your phone, use the computer's local-network address and Vite's port. Open **Projects → Add engineering examples** again, even if the two projects already exist from Iteration 2; that action idempotently installs the newly added relationship records without overwriting your existing projects or concepts. Then open either example's **Open engineering model** route.

**Todo List:** select Active → Understand → Shared model → Propose model edit. Rename to "Ready to work" and save. The diagram shows the proposed name, but a task can still be checked complete/reopened through the real reducer. Open Code and Tests: they remain unchanged. Reload and check the proposal/history. Withdraw and verify the overlay disappears but the history persists.

**Event Queue:** select Leased → Shared model; propose a new descriptive name. Inspect a connected transition such as Pending → leased, propose a changed transition description, and verify the queue's real claim/ack/lease behavior is unchanged. Reload and inspect history.

**Correctness:** change a canonical LandscapeRegion title outside the proposal editor while a draft is open; the draft must show a stale warning and refuse an update rather than silently overwriting the canonical record.

**Phone ergonomics:** keep the diagram available while inspecting definitions, and use Expand inspector for long text. Confirm source wrapping remains enabled by default in Code/Tests.

## Automated verification

    npm run typecheck
    npm run lint
    npm test -- src/lib/engineering/modelStore.test.ts src/components/engineering/ModelInspector.test.tsx src/lib/engineering/liveQueue.test.ts src/lib/engineering/todoModel.test.ts src/lib/engineering/demoProjects.test.ts src/pages/EngineeringExplorerPage.test.tsx src/pages/TodoExplorerPage.test.tsx src/pages/EngineeringProjectPage.test.tsx
    npm run queue:test
    npm run build

GitHub Actions checks are configured for this branch. Real-device acceptance and screenshots are not performed from this chat.

A full root `npm test` on the parent iteration-2 branch had one independently documented pre-existing failure (`src/lib/investigation/constraints.test.ts`, invalid transcript span). The focused model iteration checks do not claim that unrelated investigation failure has been fixed.

## Boundaries and next iteration

- This iteration edits existing node and transition definitions only. **It does not yet add/remove/reparent states or transitions through the canvas**; that's Iteration 4.
- The current diagram positioning and test/source bindings remain authored layout adapters; the relationship *records* are now shared.
- No provenance inferred from a repository, no automatic code transformation, no branch/Git writes, no LLM calls, no program recompilation.
- Persisted design proposals are not yet approved as implementation. The review history is for design experimentation.
- Proposal drafts are local-only, unlike normal native Chatdex projects and concepts. Cross-device proposal sync is explicitly out of scope.
- The next iterations can build drag/zoom-independent visual operations (create state, create transition) on top of these model objects, then connect validated model changes to real runtime configuration and code changes.

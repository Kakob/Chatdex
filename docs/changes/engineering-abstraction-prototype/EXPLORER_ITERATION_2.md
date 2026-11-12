# Iteration 2 — live engineering models + native project examples

**Branch:** `feature/engineering-live-projects`
**Based on:** `feature/engineering-explorer-iteration-1`
**Status:** implemented in branch; GitHub CI and phone acceptance determine verification status
**Scopes:** Event Queue runtime, Todo List runtime, opt-in Chatdex project integration.

## Design objective

The prior Explorer was an authored visual explanation, not an operational program. This iteration tests whether the same visual system can show **actual state transitions from actual code** while retaining a usable small-screen inspector.

The second Todo List project is a generalization check: the programming experience should work beyond an event queue, rather than baking one domain into the whole product.

## Installation / projects

In Chatdex, open **Projects → Add engineering examples**. The explicit action creates two normally navigable UnderstandingProject records:

1. **Event Queue · engineering example** — `sample-engineering-event-queue-v1`.
2. **Todo List · engineering example** — `sample-engineering-todo-list-v1`.

The same opt-in action creates authored LandscapeRegion concepts under those projects (10 for Event Queue, 7 for Todo List), with stable IDs and parent/child containment. No conversation is imported; no fabricated user history, current-understanding claims or test evidence are generated. The operation is idempotent, preserving existing project and concept edits; it only creates records missing from the two known examples.

**Privacy/sync boundary:** These native projects and concepts are written to Chatdex's normal local-first tables, not the prototype's separate IndexedDB. They may sync under the user's existing sync configuration. **Nothing is created on application startup.** Installation requires clicking the action. Other projects are left untouched.

The project workspace header links these examples to **Open engineering model**. Their own URL is `/projects/:id/engineering` (outside the taller project-workflow layout to maximize phone screen area). Existing Investigate History, Current Understanding, and Prepare Change routes remain available as separate linked workflows—not yet three internal lenses sharing a selected model entity.

A non-example project entering the experimental URL receives an explicit "no executable adapter yet" message. The system does not invent diagrams for arbitrary projects.

## Event Queue: real execution

The demo uses the existing actual TypeScript queue through `examples/event-queue/src/harness.ts`:

- **+ Job:** calls `enqueue()`; uses `inspect()` to show pending.
- **Claim:** calls `claim()`; show real lease state, attempts, expiry and job count.
- **Fail worker:** discards the simulated worker's claim handle *without acknowledging*. This is not a killed OS process. The real queue still holds the leased job.
- **Advance clock:** advances the harness's manual clock by more than the lease, calling `reapExpired()` via the harness; state becomes pending or dead-lettered when attempts are exhausted.
- **Complete:** calls the real `ack()` with the actual lease token. The job disappears from the queue, and the UI records an acknowledged outcome.
- **Reset:** creates a fresh in-memory queue session, without deleting persistent project data.

The control panel reads observed `JobSnapshot` values from real queue methods. Events capture the actual before/after states, timestamps, related components and explanatory edges. The diagram shows current counts; event highlights are driven by the latest executed action.

**Verification distinction:** queue events are real observations in the current browser session, but not revision-pinned test manifests. The layout, arrow connections, source-entry bindings, and short explanations are still authored. Green highlights do not mean a theorem is proven.

The prior explanatory paths remain accessible under **Guided explanation** and are explicitly labeled illustrative. **Live queue** is the new default.

The example is **in-memory**, not durable across app reload or queue-process restarts. Exactly-once processing is not guaranteed; repeated processing after lease expiry remains possible.

## Todo List: second executable program

A separate, small, pure TypeScript `todoModel.ts` handles `addTask`, `toggleTask`, `renameTask`, `removeTask`, `clearCompleted`, and `todoTransition`.

The Todo Explorer offers:

- A clickable, authored conceptual flow (task input → list → active/completed → remove and tests).
- A live task field, completion controls, delete and clear completed actions.
- Selection-linked **Understand / Code / Tests** inspector showing the actual implementation source (bundled with the build) and Vitest test source, wrapped for mobile.
- Short runtime explanations following reducer actions.

Task state is deliberately session-local and resets on reload. No background synchronization, personal task data, notifications, or persistent task database is implied.

## Connected to normal Chatdex projects but not yet a universal project model

- Project identity and concept hierarchy use existing normal Chatdex tables.
- Selection in the Explorer maps to stable example concept IDs. Concept titles can be reused from the project; the rest of the diagram and code bindings are still an authored example adapter.
- Direct links to History / Current Understanding / Prepare Change keep the existing workflows reachable, but do not currently preserve selected subcomponent across those routes.
- Neither example automatically harvests source code or derives a graph from arbitrary repositories.
- No change to sync/crypto schemas, backend, permissions, agent execution, AI providers, or existing personal projects.

## Files

- `src/lib/engineering/demoProjects.ts`: explicit idempotent native project + concept installation.
- `src/lib/engineering/liveQueue.ts`: adapter around real queue and controlled-clock harness.
- `src/components/engineering/QueueLiveLab.tsx`: observed runtime controls and trace.
- `src/lib/engineering/todoModel.ts`: actual reducer-driven Todo List program.
- `src/pages/TodoExplorerPage.tsx`: visual, clickable second project.
- `src/pages/EngineeringProjectPage.tsx`: project routing, loading, unknown-adapter message.
- `src/components/engineering/SourceExcerpt.tsx`: reusable wrapped source reader.
- `src/pages/EngineeringExplorerPage.tsx`, `SystemDiagram.tsx`: real runtime highlighting + optional project model titles/counts.
- `src/pages/ProjectsPage.tsx`, `ProjectWorkspaceLayout.tsx`, `src/App.tsx`: opt-in installation and project navigation.
- Tests for live queue, todo model, project idempotency and both visual workspaces.
- `.github/workflows/engineering-live-projects.yml`: CI for typecheck, lint, focused tests and build.

## Try on your phone

From the repository:

    git fetch origin
    git switch feature/engineering-live-projects
    npm install
    npm run dev -- --host 0.0.0.0

Open Chatdex on the same Wi-Fi using your computer's local IP and Vite port.

1. **Projects → Add engineering examples**. This will create native sample projects only after you click.
2. Open **Event Queue · engineering example** → **Open engineering model**.
3. Add a job → claim → fail worker → observe it is still leased → advance clock → observe pending → claim again → complete. Verify each step changes real job counts and the diagram.
4. To inspect Retry, tap the diagram's Retry button and open Code; find `reapExpired()` and its tests.
5. Back to Projects → **Todo List · engineering example** → **Open engineering model**. Add, complete, reopen and remove tasks; inspect implementation and tests without horizontal scrolling.
6. In either project, navigate to History, Understanding, and Prepare Change. They should be existing project destinations (not misleading fabricated history).
7. Test iPhone portrait, landscape, dark/light mode and desktop. Expand the inspector for longer source reading.

## Verification commands

    npm run typecheck
    npm run lint
    npm test -- src/lib/engineering/liveQueue.test.ts src/lib/engineering/todoModel.test.ts src/lib/engineering/demoProjects.test.ts src/pages/EngineeringExplorerPage.test.tsx src/pages/TodoExplorerPage.test.tsx
    npm run build

Source was committed using the connected GitHub repository. Live browser interaction on the user's local machine cannot be verified through this chat; do not claim iPhone screenshot coverage. GitHub Actions run logs can verify automated checks.

## Next hypotheses

1. Preserve selected entity identity across History / Understanding / Change project lenses instead of merely linking between routes.
2. Store code bindings/provenance as project records rather than the authored demo adapter; reconcile with pinned commits and real tests.
3. Allow a model-level change that alters real runtime behavior (lease/retry parameters and task transition policies) with visible before/after execution.
4. Make task state persistent only in a deliberately designed/sandboxed example store; do not mix sample tasks with real user project data.

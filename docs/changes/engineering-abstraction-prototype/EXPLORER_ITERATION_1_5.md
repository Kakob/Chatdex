# Explorer iteration 1.5 — visual, inspectable system

**Branch:** feature/engineering-explorer-iteration-1 (continues on the existing branch)
**Route:** /engineering/explore
**Status:** implementation and UI-test changes committed; real-device acceptance pending
**Scope:** visualization/navigation only; runtime execution belongs to iteration 2

## Why this iteration exists

The first Explorer had the right pieces—components, source excerpts, and scenarios—but stacked them in a long scrolling page. On a phone, understanding one part required scrolling away from all the others. It felt like reading documents rather than exploring software.

The new acceptance goal is: **without scrolling the whole page, see the system parts, tap one, follow a success/failure path, and inspect source or tests for it**.

## Interaction design

### Persistent diagram

A manually authored, three-row, touch-friendly systems diagram:

- System flow: Producer → Queue → Worker.
- Job lifecycle: Pending → Leased → Completed (acknowledged).
- Recovery/evidence: Tests; Retry; Dead letter.

Connectors illustrate enqueue, storing, dispatch/claim, acknowledgment, expiry, requeue, and dead-lettering. Completed is an *outcome*, not a stored JobState—the queue deletes an acknowledged job. This explanatory diagram is not a complete control-flow graph.

Each node is a real HTML button, rather than an SVG hit target, with accessible name, keyboard focus, visible selection state, and 44px minimum touch height. Connector SVG is noninteractive.

### One inspector

Tapping a node changes one inspector instead of stacking multiple page panels:

- Understand — distinct explanatory content for each part.
- Code — real, read-only TypeScript excerpt and full-file toggle; link to GitHub.
- Tests — real test source plus the related criterion.

The selected tab persists when the user changes nodes. This ensures the code/test content stays directly connected to selection. No large forms, global evidence imports, or duplicated navigation list on this route.

All nine model records and their source/test entry points are authored in the page in this slice. We can later promote their stable identities and bindings into the shared engineering model.

### Scenario highlights the same diagram

Choose Successful job or Worker crashes. Previous/Next highlights relevant nodes and explanatory connectors, selects the focused node, and shows one brief explanation. Manual node selection does not silently change the scenario step. Violet marks selection; green marks the illustrated scenario path.

**These are authored walkthrough steps, not runtime observations or code execution.** The runtime model comes next, after this layout is reviewed.

### Mobile and desktop

The Explorer fills the available viewport inside Chatdex's existing 56px app header and the route padding. On mobile, a compact diagram remains above a tabbed, internally scrollable inspector. On desktop, diagram/scenario and inspector are side by side.

The page should not require long vertical scrolling to alternate between diagram and code. Code wraps long lines within the available inspector width by default (with an optional unwrapped mode); line numbers remain in a fixed gutter. The optional unwrapped view scrolls horizontally *inside its own preview*. Very short viewports or landscape orientation may still cause some page scrolling because of minimum-size constraints; these need actual device review.

A small-screen Expand inspector button hides the diagram temporarily so that long code/tests can use the remaining workspace height; Show diagram restores the split view. The Understand tab's Inspect implementation action also opens the expanded reader. There is no drag-to-resize sheet yet; we can evaluate that gesture after a phone review.

### Evidence boundaries

Real code is bundled from the current app build using Vite raw text imports; it is not loaded from GitHub dynamically or pinned to imported verification SHAs. The diagram and mappings are authored, not inferred. This route does not run the queue, modify source, edit project data, or execute code. The original /engineering workbench remains available for contract change and evidence workflows.

## Changed files

- src/components/engineering/SystemDiagram.tsx — tappable diagram nodes, arrows, highlights.
- src/pages/EngineeringExplorerPage.tsx — responsive workspace, inspector and scenario controls.
- src/pages/EngineeringExplorerPage.test.tsx — diagram navigation, code and test views, source wrapping, scenario highlights.
- docs/changes/engineering-abstraction-prototype/EXPLORER_ITERATION_1_5.md — this document.

## Browser review checklist

Run:

    git fetch origin
    git switch feature/engineering-explorer-iteration-1
    git pull --ff-only
    npm install
    npm run dev -- --host 0.0.0.0

Open /engineering/explore on the phone (computer and phone on the same Wi-Fi; use the host's network IP and the port Vite prints).

1. On iPhone portrait, can you see the diagram and inspector tabs at once without scrolling the whole page?
2. Tap Producer, Queue, Worker, Pending, Leased, Completed, Retry, Dead letter, Tests. Does every node show distinct meaning?
3. Open Code. Keep it open while selecting different parts. Does the actual source and highlighted symbol change? Source lines now **wrap by default** within the inspector, preserving indentation and a fixed line-number gutter. The **Wrap lines** toggle restores the original horizontal source layout if desired. Verify that neither Code nor Tests requires sideways scrolling on your iPhone while wrapping is enabled.
4. Open Tests, then select other parts. Do criterion and test excerpts change?
5. Run the illustrated Worker crashes path. Does worker failure → lease expiry → pending again highlight the correct elements and arrows?
6. Switch to Successful job. Does the scenario reset?
7. Check mobile widths 320/375/390/428px, short heights 568–667px, light/dark, and desktop.
8. Is code reading comfortable? Do we need inspector resizing or a different diagram proportion? Are any connectors misleading?

## Code verification

Recommended:

    npm run typecheck
    npm run lint
    npm test -- src/pages/EngineeringExplorerPage.test.tsx
    npm run build

These commands and a browser screenshot walkthrough have not been run in this chat environment. GitHub connector writes are available but a local clone and its dependency tree are unavailable here. Do not treat this as verified on-device until checked.

## Direction for real Chatdex projects

The Explorer could become the project home, with Investigate History, Current Understanding and Prepare Change as different **lenses on a persistent system model**, not separately invented diagrams or one blended evidence status. This is a **proposal, not implemented by the standalone synthetic Explorer**. See [Explorer as Project Workspace](./EXPLORER_PROJECT_WORKSPACE_PROPOSAL.md) for object identity, provenance/review boundaries, and incremental integration steps.

## Next milestone

Iteration 2 should run the **real** event-queue harness and controlled clock in the browser, show actual events and states on this diagram, and link transitions to implementation. Do not add a separate simulator page or more long forms. Keep observed execution distinct from the illustrated walkthrough.

After execution works, try model-level controls that change real queue behavior (lease duration, retry limit) before attempting generalized structural programming.

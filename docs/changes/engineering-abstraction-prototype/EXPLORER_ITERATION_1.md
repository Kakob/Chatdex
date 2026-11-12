# Engineering explorer — iteration 1: explore before changing

## Superseded by visual iteration

See [Explorer iteration 1.5](./EXPLORER_ITERATION_1_5.md) for the current diagram-first mobile experience, updated walkthrough, source inspector, and acceptance checks. The original long-page layout described below is retained as historical context.


Branch: feature/engineering-explorer-iteration-1 (based on feature/engineering-abstraction-prototype).
Route: /engineering/explore, linked from the original /engineering workbench.
Status: first browser-review candidate; automated and browser checks pending.

## Hypothesis

A new programmer should be able to:
1. Find the meaningful parts of this program.
2. Follow what happens when a job succeeds or a worker fails.
3. Inspect the actual source corresponding to each part.
4. Move among these views without losing their place.

The prior prototype asked users to choose queue guarantees before exploring their consequences. It displayed code locations but not source contents.

## What was implemented

- Separate, read-only route with a clickable producer → queue/storage → worker overview.
- Seven distinct concept views, each connected to an authored source-code entry point.
- Two illustrative walkthroughs (successful job, worker fails and is retried). Scenario steps select the associated concept.
- Inline, read-only source excerpts from the repository's actual TypeScript source, bundled with Vite's raw imports; full-file toggle and line numbers.
- Link to the relevant code file on GitHub.
- UI tests covering source navigation and behavior walkthrough.

## Truth boundaries

- The behavior walkthrough is AUTHORED, not code execution or observed runtime behavior.
- Source shown is bundled in the current app build; it is NOT revision-pinned evidence or a live editor.
- Bindings are authored, not AI- or AST-inferred.
- This route does not write project data, run arbitrary code, or alter the original contract-change prototype.
- Actual test evidence and semantic change approval remain on the original /engineering route.

## Browser acceptance checks

Run these commands in the repository:

    git switch feature/engineering-explorer-iteration-1
    npm install
    npm run dev

Open http://localhost:4000/engineering/explore.

1. Can you understand the system overview without event-queue experience?
2. Click Producer, Worker, Storage, Lifecycle, and Recovery. Does each select distinct meaning AND relevant code?
3. Click Worker crashes and step through failure → expiry → retry. Is this easier to understand than guarantee forms?
4. Click the supporting test. Do you understand what its assertions are checking?
5. Toggle full-file source view. Is it sufficiently inspectable?
6. What remains like documentation rather than a new programming environment?

## Candidate next iteration

If this exploration is intelligible, build live controlled-clock queue execution, with actual state and test results connected to source and model. If the navigation is still unconvincing, improve the spatial/zoom interaction and code viewer before adding execution. Do not expand forms or automate coding yet.

## Verification limits

The page, route, tests, and source links were committed, but full typecheck/lint/unit tests and a real browser walkthrough have not been run in this environment because there is no local repository checkout and the remote is inaccessible to the execution container. Run them locally before calling this verified.

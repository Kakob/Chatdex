# Event queue (synthetic fixture)

A small in-memory TypeScript job queue used as the subject of the Chatdex engineering
abstraction prototype ([plan](../../docs/changes/engineering-abstraction-prototype/PLAN.md)).
It is not part of the Chatdex app. It contains no personal data.

## Delivery semantics at this revision: remove on dispatch

`EventQueue.dequeue()` removes the oldest pending job and returns it. Once it returns, the
queue no longer has any record of the job. `workOnce()` dequeues and then runs the handler.
If the handler throws (a worker that fails before finishing), the job is already gone and
nothing can deliver it again. An accepted job can therefore be lost.

The queue has no claim, acknowledgement, lease, retry, dead-letter, or durable storage. It
lives in process memory only.

## Layout

| Path | Contents |
|---|---|
| `src/queue.ts` | `EventQueue`, `Job`, `Clock`, `JobState` |
| `src/worker.ts` | `workOnce(queue, handler)` and `WorkResult` |
| `src/harness.ts` | `createHarness()`, `ManualClock`. Criterion tests use only this, so they keep working when the queue moves to claim/ack |
| `test/delivery.test.ts` | Criterion tests. Each title starts with `[EQ-Cn]` (IDs are defined in the plan) |
| `test/queue.test.ts` | Ordinary unit tests for the baseline |
| `scripts/capture-evidence.mjs` | Writes the evidence manifest |

## Running the tests

From the repository root:

```
npm run queue:test
```

At this revision `[EQ-C5] an accepted job survives a worker failure before completion`
fails with `job was lost: removed on dispatch before the worker completed`. **This is
intentional.** The test reproduces the defect and is not skipped or marked as expected to
fail. All other tests pass.

This suite has its own `vitest.config.ts` (node environment, no root setup files). It is not
part of the root `npm test`, so its failing criterion does not break the app's suite.

## Capturing evidence

```
npm run queue:evidence -- [--base <sha>] [--out <path>] [--note "<text>"]...
```

The script runs the suite with vitest's JSON reporter (a failing test is recorded, not an
error), pins the result to `git rev-parse HEAD`, and hashes the code. The default output is
`examples/event-queue/evidence/<sha12>[-dirty].json`.

Manifest (`chatdex.engineering.evidence/v1`):

| Field | Meaning |
|---|---|
| `repository.remote`, `repository.root` | `origin` as `https://github.com/<owner>/<repo>`, and `examples/event-queue` |
| `revision.sha`, `.branch` | The commit the tests ran against |
| `revision.dirty`, `.dirtyScope` | Uncommitted changes under `examples/event-queue`. A dirty manifest is not pinned to its commit, so Chatdex never counts it as verification |
| `revision.baseSha`, `changedPaths` | With `--base`: the full base sha and the files changed under the example from base to HEAD |
| `uncommittedPaths` | Files under the example that differ from HEAD (empty when clean) |
| `command`, `environment`, `capturedAt` | How, where, and when the tests ran |
| `tests[]` | `{ id, name, file, status, durationMs, failureMessage? }`. `id` is the `[EQ-…]` prefix or `null` |
| `symbols[]` | `{ path, symbol, startLine, endLine, sha256 }` for top-level declarations (`createHarness`), class members (`EventQueue.dequeue`), and criterion tests (`test:EQ-C5`). The hash covers the declaration text from its first token to its end, not leading comments |
| `notes[]` | Free text from `--note`, labeled `agent-reported`. Notes never change a criterion's status |

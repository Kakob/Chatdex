# Event queue (synthetic fixture)

A small in-memory TypeScript job queue used as the subject of the Chatdex engineering
abstraction prototype ([plan](../../docs/changes/engineering-abstraction-prototype/PLAN.md)).
It is not part of the Chatdex app. It contains no personal data.

## Delivery semantics: ack after processing (at least once, in memory)

Workers no longer take jobs out of the queue. `EventQueue.claim(workerId, leaseMs)` leases
the oldest pending job to a worker and returns it with a fresh `leaseToken` and its
`attempt` number. The job stays in the queue, in the `leased` state, until that worker calls
`ack(jobId, leaseToken)`. Acknowledgement is the only operation that removes a job.
`workOnce()` claims, runs the handler, and acks only if the handler succeeded.

Job states: `pending` → `leased` → removed on ack, or back to `pending` when the lease
expires, or `dead_lettered` once every allowed attempt has expired.

- **Worker failure.** A worker that throws or stops before acking leaves the job leased.
  When the lease expires (`reapExpired()`, which `claim()` also runs first) the job returns
  to `pending` and is delivered again. Failures are retried only through lease expiry; there
  is no explicit negative ack, so a failed job waits out its lease.
- **Fencing.** Every claim gets a new token. `ack()` rejects with `AckRejectedError`
  (`reason`: `unknown_job`, `not_leased`, `stale_token`, or `lease_expired`) unless the
  caller holds the job's current, unexpired lease, so a slow worker whose lease was reclaimed
  cannot complete the newer claim.
- **Bounded retries.** Each claim is one attempt. When the lease of the last allowed attempt
  (`maxAttempts`, default 5) expires, the job moves to `dead_lettered`. It is never dropped
  silently: `deadLetters()` and `inspect(jobId)` report it, and it is never claimed again.

### Caveats

- **Duplicates are possible; exactly-once is not promised.** A worker can finish its work and
  then fail, or run past its lease, before its ack lands. The job is then delivered and
  processed again (criterion EQ-C4 demonstrates this). `workOnce()` reports such a late
  worker as `lease_lost`. Handlers should be idempotent.
- **In memory only.** Jobs and leases live in the queue process's memory. They survive a
  *worker* failure only while the queue process keeps running. If the queue process
  restarts, every pending, leased, and dead-lettered job is lost. There is no durable
  storage and no restart recovery. "Accepted" means `enqueue()` resolved, i.e. the job is
  pending in this process's memory.
- **No strict FIFO across retries.** First delivery follows enqueue order. A job returning
  from an expired lease is claimable again from its original position, so delivery order
  across retries is not a global FIFO.

## Layout

| Path | Contents |
|---|---|
| `src/queue.ts` | `EventQueue` (`enqueue`, `claim`, `ack`, `reapExpired`, `inspect`, `deadLetters`, `size`), `Job`, `ClaimedJob`, `JobState`, `AckRejectedError`, `Clock` |
| `src/worker.ts` | `workOnce(queue, handler, { workerId, leaseMs })` and `WorkResult` |
| `src/harness.ts` | `createHarness()`, `ManualClock`. Deterministic time; `advance()` moves the clock and then expires leases |
| `test/delivery.test.ts` | Criterion tests. Each title starts with `[EQ-Cn]` (IDs are defined in the plan) |
| `test/queue.test.ts` | Ordinary unit tests for the queue and `workOnce` |
| `scripts/capture-evidence.mjs` | Writes the evidence manifest |

## Running the tests

From the repository root:

```
npm run queue:test
```

All tests pass, including the criterion tests EQ-C0, EQ-C1, EQ-C2, EQ-C3, EQ-C4, EQ-C5,
and EQ-C7. At the baseline revision (`f354cf7`, remove on dispatch) `[EQ-C5] an accepted job
survives a worker failure before completion` failed with `job was lost: removed on dispatch
before the worker completed`; it now passes because jobs are removed only on ack. The test
itself is unchanged.

This suite has its own `vitest.config.ts` (node environment, no root setup files). It is not
part of the root `npm test`, so this example never affects the app's suite.

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
| `symbols[]` | `{ path, symbol, startLine, endLine, sha256 }` for top-level declarations (`createHarness`), class members (`EventQueue.claim`), and criterion tests (`test:EQ-C5`). The hash covers the declaration text from its first token to its end, not leading comments |
| `notes[]` | Free text from `--note`, labeled `agent-reported`. Notes never change a criterion's status |

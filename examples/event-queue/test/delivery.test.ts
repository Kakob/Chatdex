/**
 * Delivery criteria for the event queue. Each test name starts with the
 * criterion ID it evidences. Tests use only the harness and the queue's
 * public API, never queue internals.
 *
 * EQ-C0, EQ-C1 and EQ-C5 predate the move from dequeue to claim/ack and are
 * unchanged by it. EQ-C5 failed at the baseline revision (remove on
 * dispatch); it passes once jobs are removed only on acknowledgement.
 */
import { describe, expect, it } from 'vitest';
import { createHarness } from '../src/harness.ts';
import type { Job } from '../src/queue.ts';
import type { WorkResult } from '../src/worker.ts';

describe('event queue delivery', () => {
  it('[EQ-C0] dispatches jobs in enqueue order on first delivery', async () => {
    const h = createHarness();
    await h.enqueue('a');
    await h.enqueue('b');
    await h.enqueue('c');

    const seen: unknown[] = [];
    for (let i = 0; i < 3; i += 1) {
      const result = await h.workOnce((job) => {
        seen.push(job.payload);
      });
      expect(result.status).toBe('completed');
    }

    expect(seen).toEqual(['a', 'b', 'c']);
  });

  it('[EQ-C1] does not dispatch a completed job again', async () => {
    const h = createHarness();
    await h.enqueue({ order: 1 });

    const first = await h.workOnce(() => {});
    expect(first.status).toBe('completed');

    await h.advance(h.leaseMs + 1);
    const second = await h.workOnce(() => {
      throw new Error('a completed job was dispatched again');
    });
    expect(second).toEqual({ status: 'idle' });
  });

  it('[EQ-C5] an accepted job survives a worker failure before completion', async () => {
    const h = createHarness();
    await h.enqueue({ order: 42 });

    const crashed = await h.workOnce(() => {
      throw new Error('worker failed before completing the job');
    });
    expect(crashed.status).toBe('failed');

    await h.advance(h.leaseMs + 1);

    const processed: Job[] = [];
    const retry = await h.workOnce((job) => {
      processed.push(job);
    });

    expect(
      processed.map((job) => job.payload),
      'job was lost: removed on dispatch before the worker completed',
    ).toEqual([{ order: 42 }]);
    expect(retry.status).toBe('completed');
  });

  it('[EQ-C2] a claimed but unacknowledged job can be reclaimed after its lease expires', async () => {
    const h = createHarness();
    const id = await h.enqueue('x');

    const first = await h.claim('worker-a');
    expect(first).toMatchObject({ id, attempt: 1, workerId: 'worker-a' });

    // While the lease is live the job is owned by worker-a: nobody else gets it.
    await h.advance(h.leaseMs - 1);
    expect(await h.claim('worker-b')).toBeNull();
    expect(h.queue.inspect(id)?.state).toBe('leased');

    // worker-a never acks. Once the lease runs out the job is claimable again.
    await h.advance(2);
    expect(h.queue.inspect(id)?.state).toBe('pending');
    const second = await h.claim('worker-b');
    expect(second).toMatchObject({ id, payload: 'x', attempt: 2, workerId: 'worker-b' });
    expect(second?.leaseToken).not.toBe(first?.leaseToken);
  });

  it('[EQ-C3] a stale lease token cannot acknowledge a newer claim', async () => {
    const h = createHarness();
    const id = await h.enqueue('x');

    const stale = await h.claim('worker-a');
    await h.advance(h.leaseMs + 1);
    const current = await h.claim('worker-b');
    expect(stale && current).toBeTruthy();
    if (!stale || !current) return;

    // The slow original worker tries to ack after its lease was reclaimed.
    await expect(h.ack(stale)).rejects.toMatchObject({ name: 'AckRejectedError', reason: 'stale_token' });
    await expect(h.queue.ack(id, 'made-up-token')).rejects.toMatchObject({ reason: 'stale_token' });

    // The rejected ack did not complete the newer claim: it is still leased to worker-b.
    expect(h.queue.inspect(id)).toMatchObject({ state: 'leased', lease: { workerId: 'worker-b' } });
    expect(await h.claim('worker-c')).toBeNull();

    // The current holder's ack is accepted and removes the job for good.
    await h.ack(current);
    expect(h.queue.inspect(id)).toBeNull();
    await h.advance(h.leaseMs + 1);
    expect(await h.claim('worker-c')).toBeNull();
    // A replay of the stale token after completion is rejected too.
    await expect(h.ack(stale)).rejects.toMatchObject({ reason: 'unknown_job' });
  });

  it('[EQ-C4] lease expiry can cause duplicate processing (documented, demonstrated)', async () => {
    // Documented behavior, not a defect: delivery is at least once. A worker
    // that finishes after its lease expired has done the work, but its ack is
    // rejected and another worker processes the same job again.
    const h = createHarness();
    await h.enqueue({ order: 7 });

    const processedBy: string[] = [];
    let other: WorkResult | undefined;
    const slow = await h.workOnce(async (job) => {
      processedBy.push(`slow:${String((job.payload as { order: number }).order)}`);
      // Worker is still busy when its lease runs out; another worker reclaims the job.
      await h.advance(h.leaseMs + 1);
      other = await h.workOnce((again) => {
        processedBy.push(`fast:${String((again.payload as { order: number }).order)}`);
      }, 'worker-fast');
    }, 'worker-slow');

    expect(processedBy).toEqual(['slow:7', 'fast:7']);
    expect(other?.status).toBe('completed');
    expect(slow.status).toBe('lease_lost');

    // Processed twice, completed once: nothing is left to deliver.
    await h.advance(h.leaseMs + 1);
    expect(await h.workOnce(() => {})).toEqual({ status: 'idle' });
  });

  it('[EQ-C7] retries are bounded; exhausted jobs are dead-lettered, not silently dropped', async () => {
    const h = createHarness({ maxAttempts: 3 });
    const id = await h.enqueue({ poison: true });

    const attempts: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      const result = await h.workOnce((job) => {
        attempts.push(job.attempt);
        throw new Error('always fails');
      });
      expect(result.status).toBe('failed');
      await h.advance(h.leaseMs + 1);
    }

    expect(attempts).toEqual([1, 2, 3]);
    // Not redelivered a fourth time...
    expect(await h.workOnce(() => {
      throw new Error('dead-lettered job was dispatched again');
    })).toEqual({ status: 'idle' });
    // ...and not dropped: it is held in the dead-letter state for inspection.
    expect(h.queue.deadLetters()).toEqual([
      { id, payload: { poison: true }, enqueuedAt: 0, state: 'dead_lettered', attempts: 3 },
    ]);
    expect(h.queue.inspect(id)?.state).toBe('dead_lettered');
    expect(h.queue.size()).toBe(0);
  });
});

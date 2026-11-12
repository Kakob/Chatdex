/**
 * Delivery criteria for the event queue. Each test name starts with the
 * criterion ID it evidences. Tests use only the harness, never queue
 * internals, so they stay valid across the move from dequeue to claim/ack.
 *
 * EQ-C5 fails at the baseline revision on purpose: it reproduces the job
 * loss caused by removing a job on dispatch.
 */
import { describe, expect, it } from 'vitest';
import { createHarness } from '../src/harness.ts';
import type { Job } from '../src/queue.ts';

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
});

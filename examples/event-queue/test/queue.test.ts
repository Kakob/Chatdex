import { describe, expect, it } from 'vitest';
import { AckRejectedError, EventQueue } from '../src/queue.ts';
import { ManualClock } from '../src/harness.ts';
import { workOnce } from '../src/worker.ts';

describe('EventQueue', () => {
  it('enqueue returns a deterministic job id', async () => {
    const queue = new EventQueue({ clock: new ManualClock() });
    expect(await queue.enqueue('x')).toBe('job-1');
    expect(await queue.enqueue('y')).toBe('job-2');
  });

  it('uses the supplied id factory, lease token factory, and clock', async () => {
    const clock = new ManualClock(5);
    const queue = new EventQueue({ clock, idFactory: () => 'fixed', leaseTokenFactory: () => 'tok' });
    await queue.enqueue('x');
    expect(await queue.claim('w', 100)).toEqual({
      id: 'fixed',
      payload: 'x',
      enqueuedAt: 5,
      leaseToken: 'tok',
      attempt: 1,
      workerId: 'w',
      leaseExpiresAt: 105,
    });
  });

  it('claim leases the job instead of removing it', async () => {
    const queue = new EventQueue({ clock: new ManualClock() });
    const id = await queue.enqueue('x');
    const job = await queue.claim('w', 100);
    expect(job?.payload).toBe('x');
    expect(queue.size()).toBe(1);
    expect(queue.inspect(id)).toEqual({
      id,
      payload: 'x',
      enqueuedAt: 0,
      state: 'leased',
      attempts: 1,
      lease: { workerId: 'w', expiresAt: 100 },
    });
    expect(await queue.claim('w', 100)).toBeNull();
  });

  it('claim on an empty queue returns null', async () => {
    const queue = new EventQueue();
    expect(await queue.claim('w', 100)).toBeNull();
  });

  it('claim rejects an empty worker id or a non-positive lease', async () => {
    const queue = new EventQueue();
    await expect(queue.claim('', 100)).rejects.toThrow(/workerId/);
    await expect(queue.claim('w', 0)).rejects.toThrow(/leaseMs/);
    await expect(queue.claim('w', Number.NaN)).rejects.toThrow(/leaseMs/);
  });

  it('ack with the current token removes the job', async () => {
    const queue = new EventQueue({ clock: new ManualClock() });
    await queue.enqueue('x');
    const job = await queue.claim('w', 100);
    if (!job) throw new Error('expected a job');
    await queue.ack(job.id, job.leaseToken);
    expect(queue.size()).toBe(0);
    expect(queue.inspect(job.id)).toBeNull();
  });

  it('ack rejects unknown, pending, and already-acked jobs', async () => {
    const queue = new EventQueue({ clock: new ManualClock() });
    await expect(queue.ack('nope', 't')).rejects.toBeInstanceOf(AckRejectedError);
    await expect(queue.ack('nope', 't')).rejects.toMatchObject({ reason: 'unknown_job', jobId: 'nope' });

    const id = await queue.enqueue('x');
    await expect(queue.ack(id, 't')).rejects.toMatchObject({ reason: 'not_leased' });

    const job = await queue.claim('w', 100);
    if (!job) throw new Error('expected a job');
    await queue.ack(id, job.leaseToken);
    await expect(queue.ack(id, job.leaseToken)).rejects.toMatchObject({ reason: 'unknown_job' });
  });

  it('ack rejects an expired lease even before it is reaped', async () => {
    const clock = new ManualClock();
    const queue = new EventQueue({ clock });
    await queue.enqueue('x');
    const job = await queue.claim('w', 100);
    if (!job) throw new Error('expected a job');
    clock.advance(100);
    await expect(queue.ack(job.id, job.leaseToken)).rejects.toMatchObject({ reason: 'lease_expired' });
    expect(queue.inspect(job.id)?.state).toBe('leased');
  });

  it('reapExpired returns expired leases to pending and counts them', async () => {
    const clock = new ManualClock();
    const queue = new EventQueue({ clock });
    await queue.enqueue('a');
    await queue.enqueue('b');
    await queue.claim('w', 100);
    await queue.claim('w', 200);
    expect(await queue.reapExpired(99)).toBe(0);
    expect(await queue.reapExpired(100)).toBe(1);
    expect(queue.inspect('job-1')?.state).toBe('pending');
    expect(queue.inspect('job-2')?.state).toBe('leased');
    clock.advance(500);
    expect(await queue.reapExpired()).toBe(1);
  });

  it('claim reaps expired leases itself, without a separate reaper', async () => {
    const clock = new ManualClock();
    const queue = new EventQueue({ clock });
    await queue.enqueue('x');
    const first = await queue.claim('a', 100);
    clock.advance(100);
    const second = await queue.claim('b', 100);
    expect(second).toMatchObject({ id: first?.id, attempt: 2, workerId: 'b' });
  });

  it('a redelivered job keeps its original position (no strict FIFO across retries)', async () => {
    const clock = new ManualClock();
    const queue = new EventQueue({ clock });
    await queue.enqueue('a');
    await queue.claim('w', 100);
    await queue.enqueue('b');
    clock.advance(100);
    expect((await queue.claim('w', 100))?.payload).toBe('a');
    expect((await queue.claim('w', 100))?.payload).toBe('b');
  });

  it('dead-letters a job when its last allowed lease expires', async () => {
    const clock = new ManualClock();
    const queue = new EventQueue({ clock, maxAttempts: 2 });
    const id = await queue.enqueue('x');
    for (let i = 0; i < 2; i += 1) {
      expect(await queue.claim('w', 100)).not.toBeNull();
      clock.advance(100);
    }
    expect(await queue.claim('w', 100)).toBeNull();
    expect(queue.deadLetters().map((job) => [job.id, job.attempts])).toEqual([[id, 2]]);
    await expect(queue.ack(id, 'lease-2')).rejects.toMatchObject({ reason: 'not_leased' });
  });

  it('rejects an invalid maxAttempts', () => {
    expect(() => new EventQueue({ maxAttempts: 0 })).toThrow(/maxAttempts/);
    expect(() => new EventQueue({ maxAttempts: 1.5 })).toThrow(/maxAttempts/);
  });

  it('delays retries exponentially without changing job identity or ack semantics', async () => {
    const clock = new ManualClock();
    const queue = new EventQueue({ clock, maxAttempts: 4, retryBackoffMs: 1_000 });
    const id = await queue.enqueue({ task: 'image' });
    const first = await queue.claim('worker-a', 100);
    expect(first?.attempt).toBe(1);
    clock.advance(100);
    expect(await queue.reapExpired()).toBe(1);
    expect(queue.inspect(id)).toMatchObject({ id, state: 'pending', attempts: 1, availableAt: 1_100 });
    expect(await queue.claim('worker-b', 100)).toBeNull();
    clock.advance(999);
    expect(await queue.claim('worker-b', 100)).toBeNull();
    clock.advance(1);
    const second = await queue.claim('worker-b', 100);
    expect(second).toMatchObject({ id, attempt: 2 });
    clock.advance(100);
    await queue.reapExpired();
    expect(queue.inspect(id)).toMatchObject({ state: 'pending', attempts: 2, availableAt: 3_200 });
    clock.advance(1_999);
    expect(await queue.claim('worker-c', 100)).toBeNull();
    clock.advance(1);
    const third = await queue.claim('worker-c', 100);
    expect(third?.attempt).toBe(3);
    if (third) await queue.ack(third.id, third.leaseToken);
    expect(queue.inspect(id)).toBeNull();
  });

  it('preserves immediate retry by default and rejects invalid backoff values', async () => {
    const clock = new ManualClock();
    const queue = new EventQueue({ clock });
    const id = await queue.enqueue('legacy');
    expect(await queue.claim('a', 100)).not.toBeNull();
    clock.advance(100);
    await queue.reapExpired();
    const next = await queue.claim('b', 100);
    expect(next).toMatchObject({ id, attempt: 2 });
    for (const invalid of [-1, 0.5, Number.POSITIVE_INFINITY, Number.NaN]) {
      expect(() => new EventQueue({ retryBackoffMs: invalid })).toThrow(/retryBackoffMs/);
    }
  });

});

describe('workOnce', () => {
  it('acks on success', async () => {
    const queue = new EventQueue({ clock: new ManualClock() });
    const id = await queue.enqueue('x');
    expect(await workOnce(queue, () => {})).toEqual({ status: 'completed', jobId: id });
    expect(queue.size()).toBe(0);
  });

  it('does not ack when the handler throws', async () => {
    const queue = new EventQueue({ clock: new ManualClock() });
    const id = await queue.enqueue('x');
    const result = await workOnce(queue, () => {
      throw new Error('boom');
    });
    expect(result).toEqual({ status: 'failed', jobId: id, error: 'boom' });
    expect(queue.inspect(id)?.state).toBe('leased');
  });

  it('passes worker id and lease length to claim', async () => {
    const queue = new EventQueue({ clock: new ManualClock() });
    const id = await queue.enqueue('x');
    await workOnce(
      queue,
      () => {
        throw new Error('hold the lease');
      },
      { workerId: 'w-9', leaseMs: 42 },
    );
    expect(queue.inspect(id)?.lease).toEqual({ workerId: 'w-9', expiresAt: 42 });
  });

  it('returns idle on an empty queue', async () => {
    expect(await workOnce(new EventQueue(), () => {})).toEqual({ status: 'idle' });
  });
});

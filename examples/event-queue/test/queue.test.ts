import { describe, expect, it } from 'vitest';
import { EventQueue } from '../src/queue.ts';
import { ManualClock } from '../src/harness.ts';

describe('EventQueue (baseline)', () => {
  it('enqueue returns a deterministic job id', async () => {
    const queue = new EventQueue({ clock: new ManualClock() });
    expect(await queue.enqueue('x')).toBe('job-1');
    expect(await queue.enqueue('y')).toBe('job-2');
  });

  it('uses the supplied id factory and clock', async () => {
    const clock = new ManualClock(5);
    const queue = new EventQueue({ clock, idFactory: () => 'fixed' });
    await queue.enqueue('x');
    expect(await queue.dequeue()).toEqual({ id: 'fixed', payload: 'x', enqueuedAt: 5 });
  });

  it('dequeue removes the job from the queue', async () => {
    const queue = new EventQueue({ clock: new ManualClock() });
    await queue.enqueue('x');
    expect(queue.size()).toBe(1);
    const job = await queue.dequeue();
    expect(job?.payload).toBe('x');
    expect(queue.size()).toBe(0);
    expect(await queue.dequeue()).toBeNull();
  });

  it('dequeue on an empty queue returns null', async () => {
    const queue = new EventQueue();
    expect(await queue.dequeue()).toBeNull();
  });
});

/**
 * API-neutral test harness for the event queue.
 *
 * Scenario tests drive the queue only through this harness, so the same
 * tests keep working unchanged when the queue's internals move from
 * destructive `dequeue()` to claim/ack. Only this file (and the queue and
 * worker) should need to change when the implementation changes.
 */
import { EventQueue, type Clock } from './queue.ts';
import { workOnce, type JobHandler, type WorkResult } from './worker.ts';

/** A clock that only moves when told to. Starts at 0. */
export class ManualClock implements Clock {
  private current: number;

  constructor(start = 0) {
    this.current = start;
  }

  now(): number {
    return this.current;
  }

  advance(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) throw new Error(`cannot advance clock by ${ms}`);
    this.current += ms;
  }
}

export interface HarnessOptions {
  /** Lease length a worker would hold a job for. Unused until leases exist. */
  leaseMs?: number;
}

export interface Harness {
  queue: EventQueue;
  clock: ManualClock;
  leaseMs: number;
  enqueue(payload: unknown): Promise<string>;
  workOnce(handler: JobHandler): Promise<WorkResult>;
  /** Move time forward. */
  advance(ms: number): Promise<void>;
}

export const DEFAULT_LEASE_MS = 30_000;

export function createHarness(opts: HarnessOptions = {}): Harness {
  const clock = new ManualClock(0);
  const queue = new EventQueue({ clock });
  const leaseMs = opts.leaseMs ?? DEFAULT_LEASE_MS;

  return {
    queue,
    clock,
    leaseMs,
    enqueue: (payload) => queue.enqueue(payload),
    workOnce: (handler) => workOnce(queue, handler),
    advance: async (ms) => {
      clock.advance(ms);
      // Baseline: there are no leases, so advancing time only moves the clock.
      // Implementer: once claim/ack exists, also run lease expiry here (for
      // example `await queue.reapExpired(clock.now())`) so scenario tests that
      // advance past `leaseMs` see expired claims become claimable again.
    },
  };
}

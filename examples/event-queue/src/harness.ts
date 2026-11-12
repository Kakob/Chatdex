/**
 * Test harness for the event queue.
 *
 * Scenario tests drive the queue through this harness. Time is a manual
 * clock, and `advance()` runs lease expiry, so lease timing in tests is
 * deterministic.
 */
import { EventQueue, type ClaimedJob, type Clock } from './queue.ts';
import { DEFAULT_LEASE_MS, workOnce, type JobHandler, type WorkResult } from './worker.ts';

export { DEFAULT_LEASE_MS };

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
  /** Lease length workers hold a job for. Default `DEFAULT_LEASE_MS`. */
  leaseMs?: number;
  /** Claims allowed per job before it is dead-lettered. Default: the queue's default. */
  maxAttempts?: number;
  /** Optional exponential retry delay, default 0ms. */
  retryBackoffMs?: number;
}

export interface Harness {
  queue: EventQueue;
  clock: ManualClock;
  leaseMs: number;
  enqueue(payload: unknown): Promise<string>;
  /** Claim, run `handler`, ack on success. */
  workOnce(handler: JobHandler, workerId?: string): Promise<WorkResult>;
  /** Claim a job with the harness lease length, without processing it. */
  claim(workerId: string): Promise<ClaimedJob | null>;
  /** Ack a claim with the token it was issued. */
  ack(job: ClaimedJob): Promise<void>;
  /** Move time forward, then expire any leases that ran out. */
  advance(ms: number): Promise<void>;
}

export function createHarness(opts: HarnessOptions = {}): Harness {
  const clock = new ManualClock(0);
  const queue = new EventQueue({ clock, maxAttempts: opts.maxAttempts, retryBackoffMs: opts.retryBackoffMs });
  const leaseMs = opts.leaseMs ?? DEFAULT_LEASE_MS;

  return {
    queue,
    clock,
    leaseMs,
    enqueue: (payload) => queue.enqueue(payload),
    workOnce: (handler, workerId) => workOnce(queue, handler, { workerId, leaseMs }),
    claim: (workerId) => queue.claim(workerId, leaseMs),
    ack: (job) => queue.ack(job.id, job.leaseToken),
    advance: async (ms) => {
      clock.advance(ms);
      await queue.reapExpired(clock.now());
    },
  };
}

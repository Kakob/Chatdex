/**
 * In-memory event queue with ack-after-processing delivery.
 *
 * Delivery semantics: **ack after processing, at least once, in memory.**
 * A worker `claim()`s a job, which leases it to that worker for `leaseMs`
 * and hands back a fresh lease token. The job stays in the queue, in the
 * `leased` state, until the worker `ack()`s it with that token. Only an ack
 * removes a job. A worker that fails before acking never removes the job:
 * when its lease expires the job returns to `pending` and is delivered again.
 *
 * Consequences callers must accept:
 * - Duplicates. A worker can finish its work and then fail, or be too slow
 *   and lose its lease, before its ack lands. The job is then processed
 *   again. Exactly-once processing is not promised; handlers should be
 *   idempotent.
 * - Bounded retries. Each claim is one attempt. When the lease of the
 *   `maxAttempts`-th attempt expires without an ack, the job moves to the
 *   `dead_lettered` state, where `deadLetters()` reports it. It is never
 *   dropped silently.
 * - Ordering. First delivery follows enqueue order. A job returning from an
 *   expired lease is claimable again in its original position, so there is
 *   no strict FIFO guarantee across retries.
 * - Memory only. All state, including leases, lives in this process. Jobs
 *   survive a worker failure only while the queue process keeps running; a
 *   queue process restart loses every job.
 */

/** Source of time for the queue. Tests use a manual clock. */
export interface Clock {
  now(): number;
}

/** A job as stored by, and dispatched from, the queue. */
export interface Job {
  id: string;
  payload: unknown;
  enqueuedAt: number;
}

/** A job handed to a worker by `claim()`, with the lease that worker holds. */
export interface ClaimedJob extends Job {
  /** Opaque token for this claim. Only this token can ack this claim. */
  leaseToken: string;
  /** 1 for the first delivery, 2 for the first redelivery, and so on. */
  attempt: number;
  workerId: string;
  /** Clock time at which the lease expires unless the job is acked first. */
  leaseExpiresAt: number;
}

/**
 * Lifecycle states of a job the queue still holds.
 *
 * - `pending`: waiting to be claimed.
 * - `leased`: claimed by a worker, not yet acknowledged (in flight).
 * - `dead_lettered`: every allowed attempt expired without an ack. Terminal;
 *   kept for inspection, never claimed again.
 *
 * Acknowledgement is the other terminal transition: an acked job is removed
 * and the queue keeps no state for it.
 */
export type JobState = 'pending' | 'leased' | 'dead_lettered';

/** Read-only view of a job the queue holds. */
export interface JobSnapshot extends Job {
  state: JobState;
  /** Number of times the job has been claimed. */
  attempts: number;
  /** Present only while `state` is `leased`. */
  lease?: { workerId: string; expiresAt: number };
}

export type AckRejection = 'unknown_job' | 'not_leased' | 'stale_token' | 'lease_expired';

/** Thrown by `ack()` when the caller does not hold the job's current lease. */
export class AckRejectedError extends Error {
  readonly reason: AckRejection;
  readonly jobId: string;

  constructor(reason: AckRejection, jobId: string, message: string) {
    super(message);
    this.name = 'AckRejectedError';
    this.reason = reason;
    this.jobId = jobId;
  }
}

export const DEFAULT_MAX_ATTEMPTS = 5;

export interface EventQueueOptions {
  clock?: Clock;
  idFactory?: () => string;
  /** Produces lease tokens. Must not repeat a token. */
  leaseTokenFactory?: () => string;
  /** Claims allowed per job before it is dead-lettered. Default 5. */
  maxAttempts?: number;
}

const systemClock: Clock = { now: () => Date.now() };

function counterFactory(prefix: string): () => string {
  let next = 0;
  return () => {
    next += 1;
    return `${prefix}-${next}`;
  };
}

interface Lease {
  token: string;
  workerId: string;
  expiresAt: number;
}

interface StoredJob extends Job {
  state: JobState;
  attempts: number;
  lease: Lease | null;
}

export class EventQueue {
  private readonly clock: Clock;
  private readonly nextId: () => string;
  private readonly nextLeaseToken: () => string;
  private readonly maxAttempts: number;
  /** Insertion-ordered, so iteration order is enqueue order. */
  private readonly jobs = new Map<string, StoredJob>();

  constructor(options: EventQueueOptions = {}) {
    const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
      throw new Error(`maxAttempts must be a positive integer, got ${maxAttempts}`);
    }
    this.clock = options.clock ?? systemClock;
    this.nextId = options.idFactory ?? counterFactory('job');
    this.nextLeaseToken = options.leaseTokenFactory ?? counterFactory('lease');
    this.maxAttempts = maxAttempts;
  }

  /**
   * Accept a job. Resolves with its id once it is pending in memory. From
   * then on it is delivered at least once, provided the queue process keeps
   * running; it is not persisted anywhere.
   */
  async enqueue(payload: unknown): Promise<string> {
    const id = this.nextId();
    this.jobs.set(id, { id, payload, enqueuedAt: this.clock.now(), state: 'pending', attempts: 0, lease: null });
    return id;
  }

  /**
   * Lease the oldest pending job to `workerId` for `leaseMs`.
   *
   * The job stays in the queue (state `leased`) until it is acked with the
   * returned `leaseToken`. Expired leases are reaped first, so a job whose
   * worker failed becomes claimable again without a separate reaper.
   * Resolves with `null` when no job is pending.
   */
  async claim(workerId: string, leaseMs: number): Promise<ClaimedJob | null> {
    if (workerId === '') throw new Error('workerId must not be empty');
    if (!Number.isFinite(leaseMs) || leaseMs <= 0) throw new Error(`leaseMs must be positive, got ${leaseMs}`);

    const now = this.clock.now();
    await this.reapExpired(now);

    for (const job of this.jobs.values()) {
      if (job.state !== 'pending') continue;
      const lease: Lease = { token: this.nextLeaseToken(), workerId, expiresAt: now + leaseMs };
      job.state = 'leased';
      job.attempts += 1;
      job.lease = lease;
      return {
        id: job.id,
        payload: job.payload,
        enqueuedAt: job.enqueuedAt,
        leaseToken: lease.token,
        attempt: job.attempts,
        workerId,
        leaseExpiresAt: lease.expiresAt,
      };
    }
    return null;
  }

  /**
   * Acknowledge that the claim holding `leaseToken` finished processing the
   * job. This is the only operation that removes a job.
   *
   * Rejects with `AckRejectedError` when the job is unknown (never enqueued,
   * or already acked), is not leased, is leased under a different token (a
   * newer claim), or its lease has expired.
   */
  async ack(jobId: string, leaseToken: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new AckRejectedError('unknown_job', jobId, `cannot ack ${jobId}: unknown job (never enqueued or already acked)`);
    }
    if (job.state !== 'leased' || !job.lease) {
      throw new AckRejectedError('not_leased', jobId, `cannot ack ${jobId}: job is ${job.state}, not leased`);
    }
    if (job.lease.token !== leaseToken) {
      throw new AckRejectedError('stale_token', jobId, `cannot ack ${jobId}: lease token is stale or unknown`);
    }
    if (this.clock.now() >= job.lease.expiresAt) {
      throw new AckRejectedError('lease_expired', jobId, `cannot ack ${jobId}: lease expired`);
    }
    this.jobs.delete(jobId);
  }

  /**
   * End every lease that has expired at `now`. Each such job returns to
   * `pending`, or moves to `dead_lettered` if it has used all `maxAttempts`.
   * Resolves with the number of expired leases handled.
   */
  async reapExpired(now: number = this.clock.now()): Promise<number> {
    let expired = 0;
    for (const job of this.jobs.values()) {
      if (job.state !== 'leased' || !job.lease || now < job.lease.expiresAt) continue;
      job.lease = null;
      job.state = job.attempts >= this.maxAttempts ? 'dead_lettered' : 'pending';
      expired += 1;
    }
    return expired;
  }

  /** Inspect a job the queue still holds. `null` once acked or if unknown. */
  inspect(jobId: string): JobSnapshot | null {
    const job = this.jobs.get(jobId);
    return job ? snapshot(job) : null;
  }

  /** Jobs that exhausted their attempts, in enqueue order. */
  deadLetters(): JobSnapshot[] {
    return [...this.jobs.values()].filter((job) => job.state === 'dead_lettered').map(snapshot);
  }

  /** Number of live jobs (pending or leased). Excludes dead-lettered jobs. */
  size(): number {
    let live = 0;
    for (const job of this.jobs.values()) if (job.state !== 'dead_lettered') live += 1;
    return live;
  }
}

function snapshot(job: StoredJob): JobSnapshot {
  const view: JobSnapshot = {
    id: job.id,
    payload: job.payload,
    enqueuedAt: job.enqueuedAt,
    state: job.state,
    attempts: job.attempts,
  };
  if (job.lease) view.lease = { workerId: job.lease.workerId, expiresAt: job.lease.expiresAt };
  return view;
}

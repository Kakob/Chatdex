/**
 * Baseline in-memory event queue with legacy destructive delivery.
 *
 * Delivery semantics at this revision: **remove on dispatch.** `dequeue()`
 * takes the oldest pending job out of the queue and hands it to the caller.
 * From that moment the queue holds no record of the job. If the worker that
 * received it fails before it finishes processing, the job is lost: nothing
 * can redeliver it, because nothing remembers it.
 *
 * There is no claim, no acknowledgement, no lease, no retry, and no durable
 * storage. State lives only in this process's memory.
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

/**
 * The lifecycle states a job can be in while the queue still knows about it.
 * At baseline there is only one: a job is pending until it is dispatched, and
 * dispatching removes it, so there is no in-flight or acknowledged state.
 */
export type JobState = 'pending';

export interface EventQueueOptions {
  clock?: Clock;
  idFactory?: () => string;
}

const systemClock: Clock = { now: () => Date.now() };

function counterIdFactory(): () => string {
  let next = 0;
  return () => {
    next += 1;
    return `job-${next}`;
  };
}

interface StoredJob extends Job {
  state: JobState;
}

export class EventQueue {
  private readonly clock: Clock;
  private readonly nextId: () => string;
  private readonly jobs: StoredJob[] = [];

  constructor(options: EventQueueOptions = {}) {
    this.clock = options.clock ?? systemClock;
    this.nextId = options.idFactory ?? counterIdFactory();
  }

  /** Accept a job. Resolves with its id once it is pending in memory. */
  async enqueue(payload: unknown): Promise<string> {
    const id = this.nextId();
    this.jobs.push({ id, payload, enqueuedAt: this.clock.now(), state: 'pending' });
    return id;
  }

  /**
   * Dispatch the oldest pending job, removing it from the queue.
   *
   * Removal happens before the caller does any work. If the caller fails
   * after this returns and before it completes the job, the job is gone for
   * good. Resolves with `null` when no job is pending.
   */
  async dequeue(): Promise<Job | null> {
    const stored = this.jobs.shift();
    if (!stored) return null;
    return { id: stored.id, payload: stored.payload, enqueuedAt: stored.enqueuedAt };
  }

  /** Number of jobs the queue still holds (all pending at baseline). */
  size(): number {
    return this.jobs.length;
  }
}

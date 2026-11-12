import { AckRejectedError, type ClaimedJob, type EventQueue } from './queue.ts';

/** Processes one job. Throwing models a worker that fails before completion. */
export type JobHandler = (job: ClaimedJob) => void | Promise<void>;

export type WorkResult =
  | { status: 'idle' }
  | { status: 'completed'; jobId: string }
  | { status: 'failed'; jobId: string; error: string }
  /** The handler finished, but the ack was rejected: the lease had expired or been reclaimed. */
  | { status: 'lease_lost'; jobId: string; error: string };

export const DEFAULT_LEASE_MS = 30_000;

export interface WorkOptions {
  workerId?: string;
  leaseMs?: number;
}

/**
 * Claim one job, process it, and ack it only if processing succeeded.
 *
 * When the handler throws, the job is not acked and stays leased; once the
 * lease expires the queue delivers it again (or dead-letters it after its
 * last attempt). When the handler succeeds but the ack is rejected because
 * the lease was lost, the result is `lease_lost`: the work was done, and the
 * job may be (or may already have been) processed again by another claim.
 */
export async function workOnce(queue: EventQueue, handler: JobHandler, options: WorkOptions = {}): Promise<WorkResult> {
  const job = await queue.claim(options.workerId ?? 'worker', options.leaseMs ?? DEFAULT_LEASE_MS);
  if (!job) return { status: 'idle' };
  try {
    await handler(job);
  } catch (err) {
    return { status: 'failed', jobId: job.id, error: errorMessage(err) };
  }
  try {
    await queue.ack(job.id, job.leaseToken);
  } catch (err) {
    if (err instanceof AckRejectedError) return { status: 'lease_lost', jobId: job.id, error: err.message };
    throw err;
  }
  return { status: 'completed', jobId: job.id };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

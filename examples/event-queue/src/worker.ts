import type { EventQueue, Job } from './queue.ts';

/** Processes one job. Throwing models a worker that fails before completion. */
export type JobHandler = (job: Job) => void | Promise<void>;

export type WorkResult =
  | { status: 'idle' }
  | { status: 'completed'; jobId: string }
  | { status: 'failed'; jobId: string; error: string };

/**
 * Take one job from the queue and process it.
 *
 * Baseline behavior: the job is removed by `dequeue()` before the handler
 * runs. When the handler throws, this reports `failed`, but the job has
 * already left the queue and will never be delivered again. That loss is the
 * defect the ack-after-processing change is meant to remove.
 */
export async function workOnce(queue: EventQueue, handler: JobHandler): Promise<WorkResult> {
  const job = await queue.dequeue();
  if (!job) return { status: 'idle' };
  try {
    await handler(job);
    return { status: 'completed', jobId: job.id };
  } catch (err) {
    return { status: 'failed', jobId: job.id, error: err instanceof Error ? err.message : String(err) };
  }
}

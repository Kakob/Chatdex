/**
 * Controlled, in-browser execution of the *actual* event queue.
 *
 * No fake lifecycle reducer: every state observation comes from
 * EventQueue.inspect()/deadLetters(), after invoking queue methods through
 * the existing deterministic test harness. The wrapper stores only UI
 * history and the identifiers needed to inspect these real objects.
 */
import { createHarness } from '../../../examples/event-queue/src/harness.ts';
import type { ClaimedJob, JobSnapshot } from '../../../examples/event-queue/src/queue.ts';
import type { DiagramEdgeId, DiagramNodeId } from '../../components/engineering/SystemDiagram';

export interface QueueTraceEvent {
  number: number;
  atMs: number;
  label: string;
  detail: string;
  node: DiagramNodeId;
  highlighted: DiagramNodeId[];
  edge?: DiagramEdgeId;
  states: Array<{ id: string; state: JobSnapshot['state'] | 'acknowledged' }>;
}

export interface LiveQueueSnapshot {
  atMs: number;
  jobs: JobSnapshot[];
  completedIds: string[];
  events: QueueTraceEvent[];
  currentClaimId: string | null;
  leaseMs: number;
  maxAttempts: number;
  retryBackoffMs: number;
  pendingCount: number;
  readyCount: number;
  scheduledCount: number;
  leasedCount: number;
  deadLetterCount: number;
}

const LEASE_MS = 5_000;
const MAX_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = 1_000;

export class LiveQueueSession {
  private readonly harness = createHarness({ leaseMs: LEASE_MS, maxAttempts: MAX_ATTEMPTS, retryBackoffMs: RETRY_BACKOFF_MS });
  private readonly jobIds: string[] = [];
  private readonly completedIds: string[] = [];
  private readonly trace: QueueTraceEvent[] = [];
  private active: ClaimedJob | null = null;

  constructor() {
    this.record('Queue ready', 'The actual in-memory queue is ready. Add a job to begin.', 'queue', ['queue']);
  }

  snapshot(): LiveQueueSnapshot {
    const jobs = this.jobIds
      .map((id) => this.harness.queue.inspect(id))
      .filter((job): job is JobSnapshot => job !== null);
    return {
      atMs: this.harness.clock.now(),
      jobs,
      completedIds: [...this.completedIds],
      events: [...this.trace],
      currentClaimId: this.active?.id ?? null,
      leaseMs: LEASE_MS,
      maxAttempts: MAX_ATTEMPTS,
      retryBackoffMs: RETRY_BACKOFF_MS,
      pendingCount: jobs.filter((job) => job.state === 'pending').length,
      readyCount: jobs.filter((job) => job.state === 'pending' && (job.availableAt ?? 0) <= this.harness.clock.now()).length,
      scheduledCount: jobs.filter((job) => job.state === 'pending' && (job.availableAt ?? 0) > this.harness.clock.now()).length,
      leasedCount: jobs.filter((job) => job.state === 'leased').length,
      deadLetterCount: jobs.filter((job) => job.state === 'dead_lettered').length,
    };
  }

  private record(label: string, detail: string, node: DiagramNodeId, highlighted: DiagramNodeId[], edge?: DiagramEdgeId): void {
    const current = this.snapshot();
    this.trace.push({
      number: this.trace.length + 1,
      atMs: current.atMs,
      label,
      detail,
      node,
      highlighted,
      edge,
      states: [
        ...current.jobs.map(({ id, state }) => ({ id, state })),
        ...current.completedIds.map((id) => ({ id, state: 'acknowledged' as const })),
      ],
    });
  }

  async enqueue(): Promise<LiveQueueSnapshot> {
    const id = await this.harness.enqueue({ example: 'work', order: this.jobIds.length + 1 });
    this.jobIds.push(id);
    this.record('Job accepted', id + ' is pending in real queue memory.', 'producer', ['producer', 'queue', 'pending'], 'enqueue');
    return this.snapshot();
  }

  async claim(): Promise<LiveQueueSnapshot> {
    if (this.active) throw new Error('Finish or fail the active worker before claiming another job.');
    const claimed = await this.harness.claim('worker-' + (this.trace.length + 1));
    if (!claimed) throw new Error('No pending job can be claimed.');
    this.active = claimed;
    this.record('Worker claimed ' + claimed.id, 'Claim ' + claimed.attempt + ' has a lease expiring at t=' + claimed.leaseExpiresAt + 'ms.', 'leased', ['queue', 'worker', 'leased'], 'claim');
    return this.snapshot();
  }

  async complete(): Promise<LiveQueueSnapshot> {
    if (!this.active) throw new Error('Claim a job before completing it.');
    const { id } = this.active;
    await this.harness.ack(this.active);
    this.completedIds.push(id);
    this.active = null;
    this.record('Job acknowledged', id + ' was removed by EventQueue.ack().', 'acked', ['leased', 'acked'], 'ack');
    return this.snapshot();
  }

  failWorker(): LiveQueueSnapshot {
    if (!this.active) throw new Error('Claim a job before failing its worker.');
    const { id } = this.active;
    // A worker dying cannot ack. This models that failure by dropping the
    // worker's claim handle; the job is STILL leased in the actual queue.
    this.active = null;
    this.record('Worker stopped without ack', id + ' remains leased in the actual queue; the worker lost its claim handle.', 'worker', ['worker', 'leased']);
    return this.snapshot();
  }

  async expireLeases(): Promise<LiveQueueSnapshot> {
    if (this.active) throw new Error('Finish or fail the active worker before advancing past its lease.');
    const before = this.snapshot();
    const scheduled = before.jobs.filter((job) => job.state === 'pending' && (job.availableAt ?? 0) > before.atMs);
    const advanceMs = before.leasedCount > 0 ? LEASE_MS + 1 :
      scheduled.length > 0 ? Math.min(...scheduled.map((job) => job.availableAt! - before.atMs)) + 1 : LEASE_MS + 1;
    await this.harness.advance(advanceMs);
    const after = this.snapshot();
    const newlyDead = after.jobs.filter((j) => j.state === 'dead_lettered' && before.jobs.some((b) => b.id === j.id && b.state !== 'dead_lettered'));
    const newlyPending = after.jobs.filter((j) => j.state === 'pending' && before.jobs.some((b) => b.id === j.id && b.state === 'leased'));
    if (newlyDead.length) {
      this.record('Attempts exhausted', newlyDead.map((j) => j.id).join(', ') + ' moved into the real dead-letter state.', 'dead-letter', ['retry', 'dead-letter'], 'dead-letter');
    } else if (newlyPending.length) {
      const waiting = newlyPending.filter((job) => (job.availableAt ?? 0) > after.atMs);
      this.record(waiting.length ? 'Lease expired → scheduled retry' : 'Lease expired → pending',
        waiting.length ? waiting.map((job) => job.id + ' eligible at t=' + job.availableAt).join(', ') + 'ms.':
          newlyPending.map((job) => job.id).join(', ') + ' became claimable again.',
        'pending', ['leased', 'retry', 'pending'], 'requeue');
    } else if (scheduled.length && after.readyCount > before.readyCount) {
      this.record('Retry delay elapsed', 'A scheduled job is now eligible to be claimed.', 'pending', ['retry', 'pending'], 'requeue');
    } else {
      this.record('Clock advanced', 'No leased job needed recovery at this time.', 'retry', ['retry']);
    }
    return this.snapshot();
  }
}

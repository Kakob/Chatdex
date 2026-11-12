// Authored domain knowledge for the event-queue prototype: the delivery
// contract's parameter vocabulary, the verification criteria, and the rule
// pack that turns a contract change into engineering obligations.
//
// Nothing here is inferred. The rules are hand-written engineering knowledge,
// versioned, and shown to the user as "rule pack queue-delivery@1".

import type { ContractDefinition, ContractValues, RulePack } from '../../types/engineering';

export const DELIVERY_CONTRACT_KEY = 'delivery';

export const deliveryContract: ContractDefinition = {
  key: DELIVERY_CONTRACT_KEY,
  title: 'Delivery guarantee',
  parameters: [
    {
      key: 'semantics',
      label: 'Delivery semantics',
      options: [
        {
          value: 'remove_on_dispatch',
          label: 'Remove on dispatch',
          description:
            'A job leaves the queue when a worker receives it. If the worker then fails, the job is gone.',
        },
        {
          value: 'ack_after_processing',
          label: 'Ack after processing',
          description:
            'A job stays in the queue, leased to one worker, until that worker acknowledges success. Unacknowledged work is redelivered; redelivery can duplicate processing.',
        },
      ],
    },
    {
      key: 'failureScope',
      label: 'Failures survived',
      options: [
        {
          value: 'none',
          label: 'None',
          description: 'No failure is survived once a job has been dispatched.',
        },
        {
          value: 'worker_failure',
          label: 'Worker failure',
          description:
            'A worker failing before completion does not lose the job, provided the queue process itself keeps running. Jobs held only in memory are lost if the queue process restarts.',
        },
        {
          value: 'process_restart',
          label: 'Queue process restart',
          description:
            'Accepted, unacknowledged jobs survive the queue process dying and restarting. Requires durable enqueue, claim and ack transitions.',
        },
      ],
    },
  ],
  validate(values: ContractValues): string | null {
    const { semantics, failureScope } = values;
    if (semantics === 'remove_on_dispatch' && failureScope !== 'none') {
      return 'Remove-on-dispatch cannot survive any failure after dispatch: the job no longer exists.';
    }
    if (semantics === 'ack_after_processing' && failureScope === 'none') {
      return 'Choose which failures ack-after-processing must survive (worker failure, or queue process restart).';
    }
    if (!semantics || !failureScope) return 'Both delivery semantics and failure scope are required.';
    return null;
  },
  describe(values: ContractValues): string {
    if (values.semantics === 'remove_on_dispatch') {
      return 'Jobs are removed when dispatched; no failure after dispatch is survived';
    }
    if (values.failureScope === 'process_restart') {
      return 'Jobs are removed only after acknowledgment and survive worker failure and queue process restart (at least once, durable)';
    }
    return 'Jobs are removed only after acknowledgment and survive worker failure while the queue process runs (at least once, in memory)';
  },
};

export interface EngineeringCriterion {
  id: string;
  text: string;
}

/** Verification criteria. Test names in the example start with `[ID]`. */
export const QUEUE_CRITERIA: EngineeringCriterion[] = [
  { id: 'EQ-C0', text: 'First dispatch follows enqueue order; no global FIFO promise across retries' },
  { id: 'EQ-C1', text: 'A completed (acknowledged) job is not dispatched again' },
  { id: 'EQ-C2', text: 'A claimed but unacknowledged job can be reclaimed after its lease expires' },
  { id: 'EQ-C3', text: 'A stale lease token cannot acknowledge a newer claim' },
  { id: 'EQ-C4', text: 'Lease expiry can cause duplicate processing (documented, demonstrated)' },
  { id: 'EQ-C5', text: 'An accepted job survives a worker failure before completion (queue process alive)' },
  { id: 'EQ-C6', text: 'An accepted, unacknowledged job survives a queue process restart (durable)' },
  { id: 'EQ-C7', text: 'Retries are bounded; exhausted jobs are dead-lettered, not silently dropped' },
];

export function criterionText(id: string): string {
  return QUEUE_CRITERIA.find((c) => c.id === id)?.text ?? id;
}

const ACK = { semantics: 'ack_after_processing' };
const RESTART = { failureScope: 'process_restart' };
const WORKER_ONLY = { failureScope: 'worker_failure' };

export const queueDeliveryRules: RulePack = {
  id: 'queue-delivery',
  version: '1',
  contractKey: DELIVERY_CONTRACT_KEY,
  rules: [
    {
      id: 'lifecycle.leased-state',
      when: ACK,
      conceptId: 'eq-lifecycle',
      kind: 'state',
      title: 'Add a leased / in-flight state between pending and acknowledged',
      because:
        'A job must stay owned by the queue while a worker processes it, so the lifecycle needs a state for "dispatched but not yet acknowledged".',
    },
    {
      id: 'lifecycle.remove-on-ack',
      when: ACK,
      conceptId: 'eq-lifecycle',
      kind: 'state',
      title: 'Remove a job only on acknowledgment; acknowledged is terminal',
      because: 'Under ack-after-processing, acknowledgment — not dispatch — is the only transition that ends a job.',
    },
    {
      id: 'worker.claim-ack-protocol',
      when: ACK,
      conceptId: 'eq-worker',
      kind: 'protocol',
      title: 'Replace dequeue() with claim(workerId, leaseMs) and ack(jobId, leaseToken)',
      because:
        'Workers implement the delivery contract; a destructive dequeue cannot express "received but not finished".',
    },
    {
      id: 'worker.no-ack-on-failure',
      when: ACK,
      conceptId: 'eq-worker',
      kind: 'protocol',
      title: 'A worker that fails before completion must not acknowledge',
      because: 'Acknowledging before successful processing reintroduces the job loss the change removes.',
    },
    {
      id: 'retry.lease-expiry',
      when: ACK,
      conceptId: 'eq-retry',
      kind: 'mechanism',
      title: 'Expire leases and return unacknowledged jobs to pending (reapExpired)',
      because:
        'A failed worker never acknowledges; without lease expiry its job would stay leased forever, which is loss by another name.',
    },
    {
      id: 'retry.lease-fencing',
      when: ACK,
      conceptId: 'eq-retry',
      kind: 'mechanism',
      title: 'Issue a fresh lease token per claim; reject acks carrying a stale token',
      because:
        'After a lease expires and the job is reclaimed, the slow original worker may still try to ack; that ack must not complete the newer claim.',
    },
    {
      id: 'retry.bounded-attempts',
      when: ACK,
      conceptId: 'eq-retry',
      kind: 'mechanism',
      title: 'Bound delivery attempts; move exhausted jobs to a dead-letter state',
      because: 'A job that always fails would otherwise be redelivered forever; dropping it silently would be loss.',
    },
    {
      id: 'delivery.duplicates-documented',
      when: ACK,
      conceptId: 'eq-delivery',
      kind: 'documentation',
      title: 'State that redelivery can duplicate processing; exactly-once is not promised',
      because:
        'A worker can finish its work and then fail (or be fenced) before its ack lands, so the job is processed again.',
    },
    {
      id: 'storage.memory-limitation',
      when: { ...ACK, ...WORKER_ONLY },
      conceptId: 'eq-storage',
      kind: 'documentation',
      title: 'State that in-memory jobs are lost if the queue process restarts',
      because:
        'Leases kept in process memory survive a worker failure only while the queue process survives; this contract does not cover process restart.',
    },
    {
      id: 'storage.durable-transitions',
      when: { ...ACK, ...RESTART },
      conceptId: 'eq-storage',
      kind: 'storage',
      title: 'Persist enqueue, claim and ack transitions durably and atomically',
      because:
        'Surviving a queue process restart requires the job and its lease state to exist outside process memory.',
    },
    {
      id: 'producer.durable-enqueue',
      when: { ...ACK, ...RESTART },
      conceptId: 'eq-producer',
      kind: 'protocol',
      title: 'enqueue() resolves only after the job is durably stored',
      because: 'A producer told "accepted" must not lose the job if the process dies a moment later.',
    },
    ...(['EQ-C0', 'EQ-C1', 'EQ-C2', 'EQ-C3', 'EQ-C4', 'EQ-C5', 'EQ-C7'] as const).map((criterionId) => ({
      id: `verify.${criterionId}`,
      when: ACK,
      conceptId: 'eq-verification',
      kind: 'verification' as const,
      title: `Test ${criterionId}: ${criterionText(criterionId)}`,
      because:
        criterionId === 'EQ-C0' || criterionId === 'EQ-C1'
          ? 'Holds today; the new lifecycle must not regress it.'
          : 'New behavior required by the changed contract; untested behavior stays unverified.',
      criterionId,
    })),
    {
      id: 'verify.EQ-C6',
      when: { ...ACK, ...RESTART },
      conceptId: 'eq-verification',
      kind: 'verification',
      title: `Test EQ-C6: ${criterionText('EQ-C6')}`,
      because: 'Only a real restart against persisted state supports a process-restart guarantee.',
      criterionId: 'EQ-C6',
    },
  ],
};

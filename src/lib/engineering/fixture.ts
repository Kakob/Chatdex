// Synthetic Event Queue project: the authored model the prototype starts
// from. Every row is labeled author 'fixture' (relationships, bindings) or
// meta.authoredBy 'fixture' (statements). It describes the code in
// examples/event-queue/ at its baseline (remove on dispatch). Nothing here is
// inferred, and nothing here claims verification: evidence arrives only by
// importing a manifest captured from real test runs.

import type {
  EngineeringBinding,
  EngineeringConcept,
  EngineeringProjectRecord,
  EngineeringRelationship,
  EngineeringStatement,
  EngineeringStatementEvent,
} from '../../types/engineering';
import { DELIVERY_CONTRACT_KEY, deliveryContract } from './rules';

export const ENGINEERING_PROJECT_ID = 'eng-event-queue';
export const FIXTURE_VERSION = 'event-queue@1';
export const DELIVERY_STATEMENT_ID = 'eq-st-delivery-v1';

const T0 = new Date('2026-11-12T00:00:00.000Z');

export interface EngineeringFixture {
  project: EngineeringProjectRecord;
  concepts: EngineeringConcept[];
  statements: EngineeringStatement[];
  events: EngineeringStatementEvent[];
  relationships: EngineeringRelationship[];
  bindings: EngineeringBinding[];
}

interface ConceptSeed {
  id: string;
  parent: string | null;
  title: string;
  summary: string;
  body?: string;
  kind: string;
}

const CONCEPTS: ConceptSeed[] = [
  {
    id: 'eq',
    parent: null,
    title: 'Event Queue',
    summary: 'In-process job queue: producers enqueue, workers process.',
    kind: 'system',
  },
  {
    id: 'eq-producer',
    parent: 'eq',
    title: 'Producer / enqueue',
    summary: 'Accepts jobs and hands back an id.',
    kind: 'component',
  },
  {
    id: 'eq-lifecycle',
    parent: 'eq',
    title: 'Job lifecycle',
    summary: 'The states a job passes through and the transitions between them.',
    kind: 'state machine',
  },
  {
    id: 'eq-lifecycle-pending',
    parent: 'eq-lifecycle',
    title: 'Pending',
    summary: 'Accepted and waiting for a worker.',
    kind: 'state',
  },
  {
    id: 'eq-lifecycle-leased',
    parent: 'eq-lifecycle',
    title: 'Leased / in flight',
    summary: 'Held by one worker under a time-limited lease.',
    body: 'Modeled target state. The baseline implementation has no such state.',
    kind: 'state',
  },
  {
    id: 'eq-lifecycle-acked',
    parent: 'eq-lifecycle',
    title: 'Acknowledged',
    summary: 'Processed successfully; terminal.',
    body: 'Modeled target state. The baseline implementation has no such state.',
    kind: 'state',
  },
  {
    id: 'eq-worker',
    parent: 'eq',
    title: 'Worker / claim / process / ack',
    summary: 'Takes a job, runs the handler, reports the outcome.',
    kind: 'protocol',
  },
  {
    id: 'eq-delivery',
    parent: 'eq',
    title: 'Delivery guarantee',
    summary: 'What the queue promises about a job once accepted.',
    kind: 'guarantee',
  },
  {
    id: 'eq-retry',
    parent: 'eq',
    title: 'Retry + lease expiration',
    summary: 'How unfinished work comes back, and how often.',
    kind: 'mechanism',
  },
  {
    id: 'eq-storage',
    parent: 'eq',
    title: 'Storage + recovery',
    summary: 'Where job state lives and what survives a restart.',
    kind: 'storage',
  },
  {
    id: 'eq-verification',
    parent: 'eq',
    title: 'Verification / fault scenarios',
    summary: 'Tests that show which behavior holds at a revision.',
    kind: 'verification',
  },
];

interface StatementSeed {
  id: string;
  conceptId: string;
  type: string;
  title: string;
  body?: string;
  meta?: Record<string, string>;
}

const BASE_CONTRACT = { semantics: 'remove_on_dispatch', failureScope: 'none' };

const STATEMENTS: StatementSeed[] = [
  {
    id: DELIVERY_STATEMENT_ID,
    conceptId: 'eq-delivery',
    type: 'guarantee',
    title: deliveryContract.describe(BASE_CONTRACT),
    body: 'EventQueue.dequeue() removes the job it returns. Nothing tracks it afterwards.',
    meta: {
      contract: DELIVERY_CONTRACT_KEY,
      'p.semantics': BASE_CONTRACT.semantics,
      'p.failureScope': BASE_CONTRACT.failureScope,
    },
  },
  {
    id: 'eq-st-loss',
    conceptId: 'eq-delivery',
    type: 'limitation',
    title: 'A job is lost if its worker fails after receiving it and before completing',
    body: 'Exercised by test EQ-C5. Its outcome at a revision comes only from imported evidence.',
    // Resolved on acceptance only if EQ-C5 is supported by pinned evidence.
    meta: { refutedBy: 'EQ-C5' },
  },
  {
    id: 'eq-st-no-exactly-once',
    conceptId: 'eq-delivery',
    type: 'constraint',
    title: 'Exactly-once execution is not promised',
  },
  {
    id: 'eq-st-order',
    conceptId: 'eq-worker',
    type: 'behavior',
    title: 'Workers receive jobs in enqueue order on first delivery',
    body: 'Exercised by test EQ-C0.',
  },
  {
    id: 'eq-st-pending',
    conceptId: 'eq-lifecycle-pending',
    type: 'behavior',
    title: 'An enqueued job waits as pending until a worker takes it',
  },
  {
    id: 'eq-st-memory',
    conceptId: 'eq-storage',
    type: 'behavior',
    title: 'Jobs live in queue-process memory only',
  },
];

interface RelationshipSeed {
  id: string;
  from: string;
  kind: EngineeringRelationship['kind'];
  to: string;
  explanation: string;
}

const RELATIONSHIPS: RelationshipSeed[] = [
  {
    id: 'rel-worker-implements-delivery',
    from: 'eq-worker',
    kind: 'implements',
    to: 'eq-delivery',
    explanation: 'The worker protocol is how a delivery promise is carried out.',
  },
  {
    id: 'rel-delivery-constrains-lifecycle',
    from: 'eq-delivery',
    kind: 'constrains',
    to: 'eq-lifecycle',
    explanation: 'The delivery contract decides which states a job passes through and which transition ends it.',
  },
  {
    id: 'rel-lifecycle-constrains-worker',
    from: 'eq-lifecycle',
    kind: 'constrains',
    to: 'eq-worker',
    explanation: 'Workers may only perform the transitions the lifecycle allows.',
  },
  {
    id: 'rel-retry-enables-delivery',
    from: 'eq-retry',
    kind: 'enables',
    to: 'eq-delivery',
    explanation: 'Lease expiry and retry are what bring unfinished work back for redelivery.',
  },
  {
    id: 'rel-retry-constrains-lifecycle',
    from: 'eq-retry',
    kind: 'constrains',
    to: 'eq-lifecycle',
    explanation: 'Lease expiry moves a leased job back to pending.',
  },
  {
    id: 'rel-storage-supports-delivery',
    from: 'eq-storage',
    kind: 'supports',
    to: 'eq-delivery',
    explanation: 'Where job state lives decides which failures a delivery promise can survive.',
  },
  {
    id: 'rel-producer-depends-storage',
    from: 'eq-producer',
    kind: 'depends_on',
    to: 'eq-storage',
    explanation: 'enqueue() writes the job into storage before returning its id.',
  },
  {
    id: 'rel-delivery-verified-by',
    from: 'eq-delivery',
    kind: 'verified_by',
    to: 'eq-verification',
    explanation: 'Delivery behavior is shown only by the fault-scenario tests.',
  },
];

interface BindingSeed {
  id: string;
  targetId: string;
  path: string;
  symbol: string;
  role: EngineeringBinding['role'];
}

/**
 * Paths are relative to the repository root `examples/event-queue`. Some
 * symbols (claim, ack, reapExpired) do not exist at the baseline: they show
 * as missing until a revision that defines them is observed.
 */
const BINDINGS: BindingSeed[] = [
  { id: 'bind-producer-enqueue', targetId: 'eq-producer', path: 'src/queue.ts', symbol: 'EventQueue.enqueue', role: 'implementation' },
  { id: 'bind-lifecycle-state', targetId: 'eq-lifecycle', path: 'src/queue.ts', symbol: 'JobState', role: 'implementation' },
  { id: 'bind-delivery-dequeue', targetId: 'eq-delivery', path: 'src/queue.ts', symbol: 'EventQueue.dequeue', role: 'implementation' },
  { id: 'bind-worker-claim', targetId: 'eq-worker', path: 'src/queue.ts', symbol: 'EventQueue.claim', role: 'implementation' },
  { id: 'bind-worker-ack', targetId: 'eq-worker', path: 'src/queue.ts', symbol: 'EventQueue.ack', role: 'implementation' },
  { id: 'bind-worker-workonce', targetId: 'eq-worker', path: 'src/worker.ts', symbol: 'workOnce', role: 'implementation' },
  { id: 'bind-retry-reap', targetId: 'eq-retry', path: 'src/queue.ts', symbol: 'EventQueue.reapExpired', role: 'implementation' },
  { id: 'bind-storage-queue', targetId: 'eq-storage', path: 'src/queue.ts', symbol: 'EventQueue', role: 'implementation' },
  { id: 'bind-verify-c0', targetId: 'eq-verification', path: 'test/delivery.test.ts', symbol: 'test:EQ-C0', role: 'test' },
  { id: 'bind-verify-c1', targetId: 'eq-verification', path: 'test/delivery.test.ts', symbol: 'test:EQ-C1', role: 'test' },
  { id: 'bind-verify-c5', targetId: 'eq-verification', path: 'test/delivery.test.ts', symbol: 'test:EQ-C5', role: 'test' },
];

export function buildEventQueueFixture(): EngineeringFixture {
  const project: EngineeringProjectRecord = {
    id: ENGINEERING_PROJECT_ID,
    name: 'Event Queue (synthetic)',
    description:
      'Synthetic demonstration project modeling the TypeScript queue in examples/event-queue. Local to this browser; never synced.',
    repository: { remote: 'https://github.com/Kakob/Chatdex', root: 'examples/event-queue' },
    fixtureVersion: FIXTURE_VERSION,
    createdAt: T0,
  };

  const statements: EngineeringStatement[] = STATEMENTS.map((s) => ({
    id: s.id,
    projectId: ENGINEERING_PROJECT_ID,
    type: s.type,
    title: s.title,
    ...(s.body ? { body: s.body } : {}),
    status: 'current',
    origin: 'user',
    reviewState: 'accepted',
    meta: { authoredBy: 'fixture', ...(s.meta ?? {}) },
    createdAt: T0,
    updatedAt: T0,
  }));

  const concepts: EngineeringConcept[] = CONCEPTS.map((c, index) => ({
    id: c.id,
    projectId: ENGINEERING_PROJECT_ID,
    parentRegionId: c.parent,
    title: c.title,
    summary: c.summary,
    ...(c.body ? { body: c.body } : {}),
    kind: c.kind,
    order: index,
    memberObjectIds: STATEMENTS.filter((s) => s.conceptId === c.id).map((s) => s.id),
    pinnedObjectIds: [],
    revisions: [{ at: T0, field: 'created' }],
    createdAt: T0,
    updatedAt: T0,
  }));

  const events: EngineeringStatementEvent[] = statements.map((s) => ({
    id: `${s.id}-introduced`,
    objectId: s.id,
    op: 'introduced',
    detail: 'Authored fixture',
    evidence: [],
    origin: 'user',
    reviewState: 'accepted',
    occurredAt: T0,
    createdAt: T0,
  }));

  const relationships: EngineeringRelationship[] = RELATIONSHIPS.map((r) => ({
    ...r,
    projectId: ENGINEERING_PROJECT_ID,
    author: 'fixture',
    reviewState: 'accepted',
    createdAt: T0,
  }));

  const bindings: EngineeringBinding[] = BINDINGS.map((b) => ({
    ...b,
    projectId: ENGINEERING_PROJECT_ID,
    author: 'fixture',
    createdAt: T0,
  }));

  return { project, concepts, statements, events, relationships, bindings };
}

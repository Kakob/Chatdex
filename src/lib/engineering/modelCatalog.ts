/**
 * Iteration 3: shared authored relationship vocabulary and fixture edges.
 *
 * Nodes do NOT get duplicated here: their identity, title, kind, hierarchy,
 * and current description are existing LandscapeRegion records. These typed
 * edges are supplemental and are stored in a separate local-only database.
 * Future adapters should provide data here, not create another page-specific
 * persistence scheme.
 */
import { exampleConceptId, type EngineeringExampleKind } from './demoProjects';

export type EngineeringRelationKind = 'flow' | 'state_transition' | 'depends_on' | 'verified_by';

export interface EngineeringTransition {
  id: string;
  projectId: string;
  fromConceptId: string;
  toConceptId: string;
  kind: EngineeringRelationKind;
  title: string;
  description: string;
  origin: 'authored-fixture' | 'manual';
  createdAt: Date;
}

interface EdgeSeed {
  id: string;
  from: string;
  to: string;
  kind: EngineeringRelationKind;
  title: string;
  description: string;
}

const FIXTURE_EDGES: Record<EngineeringExampleKind, EdgeSeed[]> = {
  'event-queue': [
    { id: 'enqueue', from: 'producer', to: 'queue', kind: 'flow', title: 'Enqueue', description: 'The producer submits a job and the queue stores it before returning an ID.' },
    { id: 'dispatch', from: 'queue', to: 'worker', kind: 'flow', title: 'Dispatch to worker', description: 'A worker claims pending work without removing the job from storage.' },
    { id: 'store', from: 'queue', to: 'pending', kind: 'state_transition', title: 'Store pending', description: 'A newly accepted job begins in pending state.' },
    { id: 'claim', from: 'worker', to: 'leased', kind: 'state_transition', title: 'Claim lease', description: 'A worker takes a time-bounded claim while the queue keeps the job.' },
    { id: 'to-lease', from: 'pending', to: 'leased', kind: 'state_transition', title: 'Pending → leased', description: 'Claim changes a job from pending to leased.' },
    { id: 'ack', from: 'leased', to: 'acked', kind: 'state_transition', title: 'Acknowledge completion', description: 'A successful ack ends the lease and removes the job from the queue.' },
    { id: 'expire', from: 'leased', to: 'retry', kind: 'state_transition', title: 'Lease expires', description: 'An unacknowledged lease expires and the queue may retry or dead-letter the job.' },
    { id: 'requeue', from: 'retry', to: 'pending', kind: 'state_transition', title: 'Requeue after expiry', description: 'An expired claim with remaining attempts goes back to pending.' },
    { id: 'dead-letter', from: 'retry', to: 'dead-letter', kind: 'state_transition', title: 'Exhaust retries', description: 'A job with no attempts remaining becomes dead-lettered, not silently dropped.' },
  ],
  'todo-list': [
    { id: 'create', from: 'input', to: 'list', kind: 'flow', title: 'Create task', description: 'A valid title becomes a task with a stable ID.' },
    { id: 'activate', from: 'list', to: 'active', kind: 'state_transition', title: 'New task is active', description: 'Every new task begins incomplete.' },
    { id: 'complete', from: 'active', to: 'completed', kind: 'state_transition', title: 'Complete task', description: 'Toggling an active task marks it completed while preserving its identity.' },
    { id: 'reopen', from: 'completed', to: 'active', kind: 'state_transition', title: 'Reopen task', description: 'Toggling a completed task marks it active again.' },
    { id: 'remove', from: 'completed', to: 'archive', kind: 'flow', title: 'Remove completed task', description: 'Completed tasks can be explicitly cleared from the list.' },
    { id: 'verify', from: 'list', to: 'tests', kind: 'verified_by', title: 'Exercise model operations', description: 'The pure reducer is covered by unit tests for create, toggle and removal.' },
  ],
};

export function exampleTransitionId(kind: EngineeringExampleKind, id: string): string {
  return 'sample-engineering-' + kind + '-transition-' + id;
}

export function fixtureTransitions(kind: EngineeringExampleKind, projectId: string): EngineeringTransition[] {
  const createdAt = new Date('2026-11-12T00:00:00.000Z');
  return FIXTURE_EDGES[kind].map((edge) => ({
    id: exampleTransitionId(kind, edge.id),
    projectId,
    fromConceptId: exampleConceptId(kind, edge.from),
    toConceptId: exampleConceptId(kind, edge.to),
    kind: edge.kind,
    title: edge.title,
    description: edge.description,
    origin: 'authored-fixture' as const,
    createdAt,
  }));
}

import { describe, it, expect } from 'vitest';
import { assemblePendingCounts } from './pendingReviews';
import type {
  UnderstandingProject,
  ProjectAssociation,
  UnderstandingObject,
  UnderstandingEvent,
  ReviewState,
} from '../../types/understanding';

const now = new Date('2026-08-01T00:00:00Z');

function project(id: string, reviewState: ReviewState): UnderstandingProject {
  return { id, name: id, origin: 'ai', reviewState, createdAt: now, updatedAt: now };
}

function association(projectId: string, reviewState: ReviewState): ProjectAssociation {
  return {
    id: crypto.randomUUID(),
    projectId,
    conversationId: 'conv-1',
    confidence: 0.9,
    origin: 'ai',
    reviewState,
    createdAt: now,
    updatedAt: now,
  };
}

function object(
  id: string,
  projectId: string | null,
  reviewState: ReviewState
): UnderstandingObject {
  return {
    id,
    projectId,
    type: 'idea',
    title: id,
    status: 'current',
    origin: 'ai',
    reviewState,
    createdAt: now,
    updatedAt: now,
  };
}

function event(objectId: string, reviewState: ReviewState): UnderstandingEvent {
  return {
    id: crypto.randomUUID(),
    objectId,
    op: 'supported',
    evidence: [],
    origin: 'ai',
    reviewState,
    occurredAt: now,
    createdAt: now,
  };
}

describe('assemblePendingCounts', () => {
  it('counts pending rows across all four kinds', () => {
    const counts = assemblePendingCounts(
      [project('p1', 'accepted'), project('p2', 'pending')],
      [association('p1', 'pending'), association('p1', 'accepted')],
      [object('o1', 'p1', 'pending'), object('o2', 'p1', 'accepted'), object('o3', null, 'pending')],
      [event('o2', 'pending'), event('o2', 'accepted')]
    );
    expect(counts).toEqual({ projects: 1, associations: 1, objects: 2, events: 1, total: 5 });
  });

  it('excludes everything under a rejected project', () => {
    const counts = assemblePendingCounts(
      [project('rejected', 'rejected')],
      [association('rejected', 'pending')],
      [object('o1', 'rejected', 'pending')],
      [event('o1', 'pending')]
    );
    expect(counts.total).toBe(0);
  });

  it('excludes events on rejected objects, keeps unassigned-bucket pending', () => {
    const counts = assemblePendingCounts(
      [],
      [],
      [object('gone', null, 'rejected'), object('o1', null, 'pending')],
      [event('gone', 'pending'), event('o1', 'pending')]
    );
    expect(counts).toEqual({ projects: 0, associations: 0, objects: 1, events: 1, total: 2 });
  });

  it('is zero on an empty workspace', () => {
    expect(assemblePendingCounts([], [], [], []).total).toBe(0);
  });
});

import { describe, it, expect } from 'vitest';
import { assembleOverview } from './overview';
import type {
  UnderstandingProject,
  UnderstandingObject,
  UnderstandingEvent,
  UnderstandingOp,
  ReviewState,
} from '../../types/understanding';

let seq = 0;

function proj(overrides: Partial<UnderstandingProject> = {}): UnderstandingProject {
  const now = new Date('2026-08-01T00:00:00Z');
  return {
    id: `p-${++seq}`,
    name: `Project ${seq}`,
    origin: 'ai',
    reviewState: 'accepted' as ReviewState,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function obj(overrides: Partial<UnderstandingObject> = {}): UnderstandingObject {
  const now = new Date('2026-08-01T00:00:00Z');
  return {
    id: `obj-${++seq}`,
    projectId: 'p1',
    type: 'idea',
    title: `Object ${seq}`,
    status: 'current',
    origin: 'ai',
    reviewState: 'accepted' as ReviewState,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function evt(
  objectId: string,
  overrides: Partial<UnderstandingEvent> & { op?: UnderstandingOp } = {}
): UnderstandingEvent {
  return {
    id: `evt-${++seq}`,
    objectId,
    op: 'introduced',
    evidence: [{ conversationId: 'c1' }],
    origin: 'ai',
    reviewState: 'accepted',
    occurredAt: new Date('2026-08-01T00:00:00Z'),
    createdAt: new Date('2026-08-02T00:00:00Z'),
    ...overrides,
  };
}

describe('assembleOverview', () => {
  it('computes per-project counts: current objects, questions, pending reviews', () => {
    const p = proj({ id: 'p1' });
    const objects = [
      obj({ id: 'a' }),
      obj({ id: 'q', type: 'question' }),
      obj({ id: 'pend', reviewState: 'pending' }),
      obj({ id: 'old', status: 'superseded' }),
    ];
    const events = [
      ...objects.map((o) => evt(o.id)),
      evt('a', { op: 'refined', reviewState: 'pending' }),
    ];
    const overview = assembleOverview([p], objects, events);
    expect(overview.projects).toHaveLength(1);
    const stats = overview.projects[0];
    // 'old' is superseded → not current; 'pend' is current and counted.
    expect(stats.objectCount).toBe(3);
    expect(stats.openQuestionCount).toBe(1);
    // 1 pending object + 1 pending event.
    expect(stats.pendingReviewCount).toBe(2);
  });

  it('excludes rejected projects and everything under them', () => {
    const kept = proj({ id: 'p1' });
    const rejected = proj({ id: 'p2', reviewState: 'rejected' });
    const objects = [
      obj({ id: 'a', projectId: 'p1' }),
      obj({ id: 'b', projectId: 'p2', type: 'question' }),
    ];
    const events = objects.map((o) => evt(o.id));
    const overview = assembleOverview([kept, rejected], objects, events);
    expect(overview.projects.map((s) => s.project.id)).toEqual(['p1']);
    expect(overview.openQuestions).toHaveLength(0);
    expect(overview.recentChanges.map((c) => c.event.objectId)).toEqual(['a']);
  });

  it('orders projects by last activity, most recent first', () => {
    const p1 = proj({ id: 'p1' });
    const p2 = proj({ id: 'p2' });
    const objects = [obj({ id: 'a', projectId: 'p1' }), obj({ id: 'b', projectId: 'p2' })];
    const events = [
      evt('a', { occurredAt: new Date('2026-08-02T00:00:00Z') }),
      evt('b', { occurredAt: new Date('2026-08-06T00:00:00Z') }),
    ];
    const overview = assembleOverview([p1, p2], objects, events);
    expect(overview.projects.map((s) => s.project.id)).toEqual(['p2', 'p1']);
    expect(overview.projects[0].lastActivityAt).toEqual(new Date('2026-08-06T00:00:00Z'));
  });

  it('rolls up current questions across projects and the unassigned bucket', () => {
    const p = proj({ id: 'p1', name: 'Chatdex' });
    const objects = [
      obj({ id: 'q1', type: 'question', projectId: 'p1' }),
      obj({ id: 'q2', type: 'question', projectId: null }),
      obj({ id: 'resolved', type: 'question', projectId: 'p1', status: 'resolved' }),
    ];
    const events = [
      evt('q1', { occurredAt: new Date('2026-08-03T00:00:00Z') }),
      evt('q2', { occurredAt: new Date('2026-08-05T00:00:00Z') }),
      evt('resolved'),
    ];
    const overview = assembleOverview([p], objects, events);
    expect(overview.openQuestions.map((q) => q.object.id)).toEqual(['q2', 'q1']);
    expect(overview.openQuestions[0].projectName).toBeNull();
    expect(overview.openQuestions[1].projectName).toBe('Chatdex');
  });

  it('counts non-rejected unassigned objects regardless of status', () => {
    const objects = [
      obj({ id: 'a', projectId: null }),
      obj({ id: 'b', projectId: null, status: 'superseded' }),
      obj({ id: 'c', projectId: null, reviewState: 'rejected' }),
    ];
    const overview = assembleOverview([], objects, objects.map((o) => evt(o.id)));
    expect(overview.unassignedCount).toBe(2);
  });

  it('builds the global recent-changes stream: capped, newest first, with project names and supersession', () => {
    const p = proj({ id: 'p1', name: 'Chatdex' });
    const objects = [
      obj({ id: 'old', projectId: 'p1', title: 'Old way' }),
      obj({ id: 'new', projectId: 'p1', title: 'New way' }),
      obj({ id: 'loose', projectId: null }),
    ];
    const events = [
      evt('old', { occurredAt: new Date('2026-08-01T00:00:00Z') }),
      evt('new', { occurredAt: new Date('2026-08-02T00:00:00Z') }),
      evt('loose', { occurredAt: new Date('2026-08-03T00:00:00Z') }),
      evt('old', {
        op: 'superseded',
        supersededByObjectId: 'new',
        occurredAt: new Date('2026-08-04T00:00:00Z'),
      }),
    ];
    const overview = assembleOverview([p], objects, events, { recentLimit: 3 });
    expect(overview.recentChanges).toHaveLength(3);
    expect(overview.recentChanges[0]).toMatchObject({
      objectTitle: 'Old way',
      projectName: 'Chatdex',
      supersededByTitle: 'New way',
    });
    expect(overview.recentChanges[1].projectName).toBeNull();
  });

  it('excludes rejected events but keeps pending ones in the stream', () => {
    const p = proj({ id: 'p1' });
    const o = obj({ id: 'a', projectId: 'p1' });
    const events = [
      evt('a'),
      evt('a', {
        op: 'refined',
        reviewState: 'rejected',
        occurredAt: new Date('2026-08-05T00:00:00Z'),
      }),
      evt('a', {
        op: 'supported',
        reviewState: 'pending',
        occurredAt: new Date('2026-08-06T00:00:00Z'),
      }),
    ];
    const overview = assembleOverview([p], [o], events);
    expect(overview.recentChanges.map((c) => c.event.op)).toEqual(['supported', 'introduced']);
  });

  it('handles empty stores', () => {
    const overview = assembleOverview([], [], []);
    expect(overview.projects).toEqual([]);
    expect(overview.openQuestions).toEqual([]);
    expect(overview.recentChanges).toEqual([]);
    expect(overview.unassignedCount).toBe(0);
  });
});

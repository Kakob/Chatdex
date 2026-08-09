import { describe, it, expect, beforeEach } from 'vitest';
import { db } from './schema';
import { clearAllData } from './index';
import {
  putUnderstandingProject,
  getAllUnderstandingProjects,
  setProjectReviewState,
  putProjectAssociation,
  getAssociationsForConversation,
  getAssociationsForProject,
  setAssociationReviewState,
  deleteAssociationsForConversation,
  createUnderstandingObject,
  recordUnderstandingEvent,
  getUnderstandingObject,
  getObjectsForProject,
  getEventsForObject,
} from './understanding';
import type { UnderstandingProject, ProjectAssociation } from '../../types/understanding';

beforeEach(async () => {
  await clearAllData();
});

function makeProject(overrides: Partial<UnderstandingProject> = {}): UnderstandingProject {
  const now = new Date('2026-08-01T00:00:00Z');
  return {
    id: crypto.randomUUID(),
    name: 'Chatdex',
    origin: 'ai',
    reviewState: 'pending',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeAssociation(
  projectId: string,
  conversationId: string,
  overrides: Partial<ProjectAssociation> = {}
): ProjectAssociation {
  const now = new Date('2026-08-01T00:00:00Z');
  return {
    id: crypto.randomUUID(),
    projectId,
    conversationId,
    confidence: 0.94,
    origin: 'ai',
    reviewState: 'pending',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('understanding projects', () => {
  it('stores and lists projects, newest updated first', async () => {
    await putUnderstandingProject(
      makeProject({ name: 'Older', updatedAt: new Date('2026-07-01T00:00:00Z') })
    );
    await putUnderstandingProject(
      makeProject({ name: 'Newer', updatedAt: new Date('2026-08-01T00:00:00Z') })
    );
    const all = await getAllUnderstandingProjects();
    expect(all.map((p) => p.name)).toEqual(['Newer', 'Older']);
  });

  it('review-state changes bump updatedAt for last-write-wins sync', async () => {
    const p = makeProject();
    await putUnderstandingProject(p);
    await setProjectReviewState(p.id, 'accepted');
    const stored = await db.understandingProjects.get(p.id);
    expect(stored?.reviewState).toBe('accepted');
    expect(stored!.updatedAt.getTime()).toBeGreaterThan(p.updatedAt.getTime());
  });
});

describe('project associations', () => {
  it('a conversation can associate with multiple projects (PRD §6)', async () => {
    await putProjectAssociation(makeAssociation('proj-1', 'conv-1', { confidence: 0.94 }));
    await putProjectAssociation(makeAssociation('proj-2', 'conv-1', { confidence: 0.21 }));
    const forConv = await getAssociationsForConversation('conv-1');
    expect(forConv).toHaveLength(2);
    expect(await getAssociationsForProject('proj-1')).toHaveLength(1);
  });

  it('rejects confidence outside [0, 1]', async () => {
    await expect(
      putProjectAssociation(makeAssociation('p', 'c', { confidence: 1.2 }))
    ).rejects.toThrow(/confidence/);
  });

  it('enforces one association row per (project, conversation) pair', async () => {
    await putProjectAssociation(makeAssociation('proj-1', 'conv-1'));
    await expect(
      putProjectAssociation(makeAssociation('proj-1', 'conv-1'))
    ).rejects.toThrow();
  });

  it('review-state update bumps updatedAt', async () => {
    const a = makeAssociation('proj-1', 'conv-1');
    await putProjectAssociation(a);
    await setAssociationReviewState(a.id, 'rejected');
    const stored = await db.projectAssociations.get(a.id);
    expect(stored?.reviewState).toBe('rejected');
    expect(stored!.updatedAt.getTime()).toBeGreaterThan(a.updatedAt.getTime());
  });

  it('deleting a conversation deletes its associations only', async () => {
    await putProjectAssociation(makeAssociation('proj-1', 'conv-1'));
    await putProjectAssociation(makeAssociation('proj-1', 'conv-2'));
    await deleteAssociationsForConversation('conv-1');
    expect(await getAssociationsForConversation('conv-1')).toHaveLength(0);
    expect(await getAssociationsForConversation('conv-2')).toHaveLength(1);
  });
});

describe('understanding objects + events', () => {
  const evidence = [{ conversationId: 'conv-1', messageIds: ['m1'] }];
  const occurredAt = new Date('2026-03-01T00:00:00Z');

  it('AI-origin objects require evidence (PRD §9)', async () => {
    await expect(
      createUnderstandingObject({
        projectId: 'proj-1',
        type: 'decision',
        title: 'Use Dexie',
        origin: 'ai',
        evidence: [],
        occurredAt,
      })
    ).rejects.toThrow(/evidence/);
  });

  it('user-origin objects may omit evidence and start accepted', async () => {
    const obj = await createUnderstandingObject({
      projectId: null,
      type: 'goal',
      title: 'Ship U2 this month',
      origin: 'user',
      evidence: [],
      occurredAt,
    });
    expect(obj.reviewState).toBe('accepted');
    expect(obj.status).toBe('current');
  });

  it('creation writes the object and its introduced event atomically', async () => {
    const obj = await createUnderstandingObject({
      projectId: 'proj-1',
      type: 'direction',
      title: 'Chatdex as shared understanding',
      origin: 'ai',
      evidence,
      occurredAt,
    });
    expect(obj.reviewState).toBe('pending');
    const events = await getEventsForObject(obj.id);
    expect(events).toHaveLength(1);
    expect(events[0].op).toBe('introduced');
    expect(events[0].evidence).toEqual(evidence);
    expect(events[0].occurredAt).toEqual(occurredAt);
  });

  it('temporal ops update denormalized status (PRD §8)', async () => {
    const obj = await createUnderstandingObject({
      projectId: 'proj-1',
      type: 'direction',
      title: 'Conversation analyzer',
      origin: 'ai',
      evidence,
      occurredAt,
    });

    await recordUnderstandingEvent({
      objectId: obj.id,
      op: 'superseded',
      supersededByObjectId: 'obj-next',
      evidence: [{ conversationId: 'conv-2' }],
      occurredAt: new Date('2026-06-01T00:00:00Z'),
    });
    expect((await getUnderstandingObject(obj.id))?.status).toBe('superseded');

    await recordUnderstandingEvent({
      objectId: obj.id,
      op: 'reopened',
      evidence: [{ conversationId: 'conv-3' }],
      occurredAt: new Date('2026-07-01T00:00:00Z'),
    });
    expect((await getUnderstandingObject(obj.id))?.status).toBe('current');

    const events = await getEventsForObject(obj.id);
    expect(events.map((e) => e.op)).toEqual(['introduced', 'superseded', 'reopened']);
  });

  it('supporting/refining ops leave status unchanged', async () => {
    const obj = await createUnderstandingObject({
      projectId: 'proj-1',
      type: 'idea',
      title: 'Living document',
      origin: 'ai',
      evidence,
      occurredAt,
    });
    await recordUnderstandingEvent({
      objectId: obj.id,
      op: 'supported',
      evidence: [{ conversationId: 'conv-2' }],
      occurredAt: new Date('2026-04-01T00:00:00Z'),
    });
    expect((await getUnderstandingObject(obj.id))?.status).toBe('current');
  });

  it('rejects events for unknown objects', async () => {
    await expect(
      recordUnderstandingEvent({
        objectId: 'nope',
        op: 'supported',
        evidence: [],
        occurredAt,
      })
    ).rejects.toThrow(/not found/);
  });

  it('queries objects by project and status, including the null-project bucket', async () => {
    const a = await createUnderstandingObject({
      projectId: 'proj-1',
      type: 'idea',
      title: 'A',
      origin: 'ai',
      evidence,
      occurredAt,
    });
    await createUnderstandingObject({
      projectId: 'proj-1',
      type: 'question',
      title: 'B',
      origin: 'ai',
      evidence,
      occurredAt,
    });
    await createUnderstandingObject({
      projectId: null,
      type: 'goal',
      title: 'C',
      origin: 'user',
      evidence: [],
      occurredAt,
    });
    await recordUnderstandingEvent({
      objectId: a.id,
      op: 'superseded',
      evidence: [{ conversationId: 'conv-2' }],
      occurredAt: new Date('2026-06-01T00:00:00Z'),
    });

    expect(await getObjectsForProject('proj-1')).toHaveLength(2);
    expect((await getObjectsForProject('proj-1', 'current')).map((o) => o.title)).toEqual(['B']);
    expect((await getObjectsForProject(null)).map((o) => o.title)).toEqual(['C']);
  });
});

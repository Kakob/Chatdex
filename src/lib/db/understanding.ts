// CRUD + invariants for shared-understanding entities.
//
// Core invariant (PRD §9, mirroring the findings evidence rule): every
// AI-origin understanding object must be traceable to source evidence. That is
// enforced structurally — createUnderstandingObject writes the object and its
// 'introduced' event in one transaction, and AI-origin creation without at
// least one EvidenceRef is rejected. User-origin objects may omit evidence
// (the user asserting something directly is its own provenance).

import { db } from './schema';
import { generateId } from '../utils/ids';
import type {
  UnderstandingProject,
  ProjectAssociation,
  UnderstandingObject,
  UnderstandingEvent,
  UnderstandingOp,
  EvidenceRef,
  ReviewState,
  UnderstandingOrigin,
} from '../../types/understanding';

// --- projects ---

export async function putUnderstandingProject(p: UnderstandingProject): Promise<void> {
  await db.understandingProjects.put(p);
}

export async function getUnderstandingProject(
  id: string
): Promise<UnderstandingProject | undefined> {
  return db.understandingProjects.get(id);
}

export async function getAllUnderstandingProjects(): Promise<UnderstandingProject[]> {
  return db.understandingProjects.orderBy('updatedAt').reverse().toArray();
}

export async function createHumanProject(input: {
  name: string;
  description?: string;
}): Promise<UnderstandingProject> {
  const name = input.name.trim();
  if (!name) throw new Error('Project name cannot be empty');

  const now = new Date();
  const project: UnderstandingProject = {
    id: generateId(),
    name,
    description: input.description?.trim() || undefined,
    origin: 'user',
    reviewState: 'accepted',
    createdAt: now,
    updatedAt: now,
  };
  await db.understandingProjects.add(project);
  return project;
}

export async function setProjectReviewState(id: string, state: ReviewState): Promise<void> {
  await db.understandingProjects.update(id, { reviewState: state, updatedAt: new Date() });
}

// --- associations ---

export async function putProjectAssociation(a: ProjectAssociation): Promise<void> {
  if (a.confidence < 0 || a.confidence > 1) {
    throw new Error(`Association confidence must be in [0, 1], got ${a.confidence}`);
  }
  await db.projectAssociations.put(a);
}

export async function associateConversationWithProject(
  projectId: string,
  conversationId: string
): Promise<ProjectAssociation> {
  const [project, conversation] = await Promise.all([
    db.understandingProjects.get(projectId),
    db.conversations.get(conversationId),
  ]);
  if (!project) throw new Error(`Project not found: ${projectId}`);
  if (project.reviewState === 'rejected') {
    throw new Error('Rejected projects cannot receive new sources');
  }
  if (!conversation) throw new Error(`Conversation not found: ${conversationId}`);

  const existing = await db.projectAssociations
    .where('[projectId+conversationId]')
    .equals([projectId, conversationId])
    .first();
  if (existing) {
    if (existing.reviewState !== 'rejected') return existing;
    const restored: ProjectAssociation = {
      ...existing,
      confidence: 1,
      reason: 'Added by the user',
      origin: 'user',
      reviewState: 'accepted',
      updatedAt: new Date(),
    };
    await db.projectAssociations.put(restored);
    return restored;
  }

  const now = new Date();
  const association: ProjectAssociation = {
    id: generateId(),
    projectId,
    conversationId,
    confidence: 1,
    reason: 'Added by the user',
    origin: 'user',
    reviewState: 'accepted',
    createdAt: now,
    updatedAt: now,
  };
  await db.projectAssociations.add(association);
  return association;
}

export async function getAssociationsForConversation(
  conversationId: string
): Promise<ProjectAssociation[]> {
  return db.projectAssociations.where('conversationId').equals(conversationId).toArray();
}

export async function getAssociationsForProject(
  projectId: string
): Promise<ProjectAssociation[]> {
  return db.projectAssociations.where('projectId').equals(projectId).toArray();
}

export async function setAssociationReviewState(
  id: string,
  state: ReviewState
): Promise<void> {
  await db.projectAssociations.update(id, { reviewState: state, updatedAt: new Date() });
}

export async function deleteAssociationsForConversation(
  conversationId: string
): Promise<void> {
  await db.projectAssociations.where('conversationId').equals(conversationId).delete();
}

// --- objects + events ---

export interface CreateUnderstandingObjectInput {
  id?: string;
  projectId: string | null;
  type: string;
  title: string;
  body?: string;
  origin: UnderstandingOrigin;
  evidence: EvidenceRef[];
  /** Source-timeline moment the understanding was introduced. */
  occurredAt: Date;
}

/**
 * Create an object together with its 'introduced' event, atomically.
 * Rejects AI-origin objects without evidence — an unexplainable synthesis is
 * incomplete by definition (PRD §9).
 */
export async function createUnderstandingObject(
  input: CreateUnderstandingObjectInput
): Promise<UnderstandingObject> {
  if (input.origin === 'ai' && input.evidence.length === 0) {
    throw new Error(
      'AI-origin understanding objects require at least one evidence reference (PRD §9)'
    );
  }
  const now = new Date();
  const object: UnderstandingObject = {
    id: input.id ?? generateId(),
    projectId: input.projectId,
    type: input.type,
    title: input.title,
    body: input.body,
    status: 'current',
    origin: input.origin,
    reviewState: input.origin === 'ai' ? 'pending' : 'accepted',
    createdAt: now,
    updatedAt: now,
  };
  const event: UnderstandingEvent = {
    id: generateId(),
    objectId: object.id,
    op: 'introduced',
    evidence: input.evidence,
    origin: input.origin,
    // The object's own reviewState gates its existence; the introduced event
    // asserts nothing beyond that, so it never needs separate review.
    reviewState: 'accepted',
    occurredAt: input.occurredAt,
    createdAt: now,
  };
  await db.transaction('rw', [db.understandingObjects, db.understandingEvents], async () => {
    await db.understandingObjects.put(object);
    await db.understandingEvents.put(event);
  });
  return object;
}

/** Status implied by each op; ops absent here leave status unchanged. */
export const OP_STATUS: Partial<Record<UnderstandingOp, UnderstandingObject['status']>> = {
  introduced: 'current',
  superseded: 'superseded',
  resolved: 'resolved',
  reopened: 'current',
};

export interface RecordUnderstandingEventInput {
  objectId: string;
  op: Exclude<UnderstandingOp, 'introduced'>;
  detail?: string;
  supersededByObjectId?: string;
  evidence: EvidenceRef[];
  origin: UnderstandingOrigin;
  occurredAt: Date;
}

/**
 * Append an event to an existing object. Events are append-only — there is no
 * update/delete helper by design.
 *
 * Review gate (PRD §11, U3.1): user-origin events are accepted and applied
 * (denormalized status updated) immediately; AI-origin events land 'pending'
 * and change nothing until setEventReviewState accepts them. AI-origin events
 * require evidence, mirroring the object-creation invariant.
 */
export async function recordUnderstandingEvent(
  input: RecordUnderstandingEventInput
): Promise<UnderstandingEvent> {
  if (input.origin === 'ai' && input.evidence.length === 0) {
    throw new Error(
      'AI-origin understanding events require at least one evidence reference (PRD §9)'
    );
  }
  const now = new Date();
  const reviewState: ReviewState = input.origin === 'ai' ? 'pending' : 'accepted';
  const event: UnderstandingEvent = {
    id: generateId(),
    objectId: input.objectId,
    op: input.op,
    detail: input.detail,
    supersededByObjectId: input.supersededByObjectId,
    evidence: input.evidence,
    origin: input.origin,
    reviewState,
    occurredAt: input.occurredAt,
    createdAt: now,
  };
  await db.transaction('rw', [db.understandingObjects, db.understandingEvents], async () => {
    const object = await db.understandingObjects.get(input.objectId);
    if (!object) {
      throw new Error(`Cannot record event: understanding object ${input.objectId} not found`);
    }
    await db.understandingEvents.put(event);
    const status = reviewState === 'accepted' ? OP_STATUS[input.op] : undefined;
    await db.understandingObjects.update(input.objectId, {
      ...(status ? { status } : {}),
      updatedAt: now,
    });
  });
  return event;
}

/**
 * Review a pending event. Accepting applies the op's status effect to the
 * object; rejecting leaves the object untouched (the event row is kept for
 * the audit trail). One-shot: re-reviewing a non-pending event would require
 * replaying the object's whole event stream to derive status, so it throws.
 */
export async function setEventReviewState(
  id: string,
  state: Exclude<ReviewState, 'pending'>
): Promise<void> {
  const now = new Date();
  await db.transaction('rw', [db.understandingObjects, db.understandingEvents], async () => {
    const event = await db.understandingEvents.get(id);
    if (!event) {
      throw new Error(`Cannot review event ${id}: not found`);
    }
    if (event.reviewState !== 'pending') {
      throw new Error(
        `Cannot review event ${id}: already ${event.reviewState} (re-review is not supported)`
      );
    }
    await db.understandingEvents.update(id, { reviewState: state, updatedAt: now });
    if (state === 'accepted' || state === 'edited') {
      const status = OP_STATUS[event.op];
      await db.understandingObjects.update(event.objectId, {
        ...(status ? { status } : {}),
        updatedAt: now,
      });
    }
  });
}

export async function getUnderstandingObject(
  id: string
): Promise<UnderstandingObject | undefined> {
  return db.understandingObjects.get(id);
}

export async function getObjectsForProject(
  projectId: string | null,
  status?: UnderstandingObject['status']
): Promise<UnderstandingObject[]> {
  // Dexie can't index null keys, so the "no project" bucket filters in memory.
  if (projectId === null) {
    const all = await db.understandingObjects.filter((o) => o.projectId === null).toArray();
    return status ? all.filter((o) => o.status === status) : all;
  }
  if (status) {
    return db.understandingObjects
      .where('[projectId+status]')
      .equals([projectId, status])
      .toArray();
  }
  return db.understandingObjects.where('projectId').equals(projectId).toArray();
}

export async function setObjectReviewState(id: string, state: ReviewState): Promise<void> {
  await db.understandingObjects.update(id, { reviewState: state, updatedAt: new Date() });
}

export async function getEventsForObject(objectId: string): Promise<UnderstandingEvent[]> {
  return db.understandingEvents
    .where('[objectId+occurredAt]')
    .between([objectId, new Date(0)], [objectId, new Date(8.64e15)])
    .toArray();
}

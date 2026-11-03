// Persistence for Understanding Landscape regions (docs/changes/understanding-landscape).
//
// Organization edits never change a finding's statement, review state,
// lifecycle status, or evidence. Every write bumps updatedAt so the sync
// engine's last-writer-wins applies per region, and every change to a
// concept's own fields appends a revision (docs/changes/editable-landscape).
//
// The one write that touches understanding records is addConceptStatement:
// it creates a NEW user-origin object (accepted, evidence optional) and
// places it in the concept — it never edits an existing object.

import { db } from './schema';
import { generateId } from '../utils/ids';
import { createUnderstandingObject } from './understanding';
import type { LandscapeRegion } from '../../types/landscape';
import type { UnderstandingObject } from '../../types/understanding';
import {
  nextOrder,
  reorderedSiblings,
  withMembership,
  withPin,
  withRevision,
  wouldCreateCycle,
} from '../landscape/organize';

export async function listRegionsForProject(projectId: string): Promise<LandscapeRegion[]> {
  return db.landscapeRegions.where('projectId').equals(projectId).toArray();
}

export async function listAllRegions(): Promise<LandscapeRegion[]> {
  return db.landscapeRegions.toArray();
}

export async function createRegion(input: {
  projectId: string;
  title: string;
  parentRegionId?: string | null;
  summary?: string;
  body?: string;
  kind?: string;
}): Promise<LandscapeRegion> {
  const title = input.title.trim();
  if (!title) throw new Error('Concept name cannot be empty');
  const project = await db.understandingProjects.get(input.projectId);
  if (!project) throw new Error('Unknown project');
  if (project.reviewState === 'rejected') throw new Error('Rejected projects cannot be organized');
  const existing = await listRegionsForProject(input.projectId);
  const parentRegionId = input.parentRegionId ?? null;
  if (parentRegionId && !existing.some((r) => r.id === parentRegionId)) {
    throw new Error('Parent concept is not in this project');
  }
  const now = new Date();
  const region: LandscapeRegion = {
    id: generateId(),
    projectId: input.projectId,
    parentRegionId,
    title,
    summary: input.summary?.trim() || undefined,
    body: input.body?.trim() || undefined,
    kind: input.kind?.trim() || undefined,
    order: nextOrder(existing, input.projectId, parentRegionId),
    memberObjectIds: [],
    pinnedObjectIds: [],
    revisions: [{ at: now, field: 'created', to: title }],
    createdAt: now,
    updatedAt: now,
  };
  await db.landscapeRegions.add(region);
  return region;
}

async function requireRegion(id: string): Promise<LandscapeRegion> {
  const region = await db.landscapeRegions.get(id);
  if (!region) throw new Error('Concept not found');
  return region;
}

async function save(region: LandscapeRegion): Promise<LandscapeRegion> {
  const next = { ...region, updatedAt: new Date() };
  await db.landscapeRegions.put(next);
  return next;
}

type TextField = 'title' | 'summary' | 'body' | 'kind';

/** Set one text field, recording the change; a no-op returns the stored row. */
async function setText(id: string, field: TextField, value: string | undefined): Promise<LandscapeRegion> {
  const region = await requireRegion(id);
  const next = value?.trim() || undefined;
  if ((region[field] ?? undefined) === next) return region;
  const now = new Date();
  return save({ ...withRevision(region, field, region[field], next, now), [field]: next });
}

export async function renameRegion(id: string, title: string): Promise<LandscapeRegion> {
  if (!title.trim()) throw new Error('Concept name cannot be empty');
  return setText(id, 'title', title);
}

export async function setRegionSummary(id: string, summary: string): Promise<LandscapeRegion> {
  return setText(id, 'summary', summary);
}

/** The concept's longer description. Empty clears it (the old text stays in history). */
export async function setRegionBody(id: string, body: string): Promise<LandscapeRegion> {
  return setText(id, 'body', body);
}

/** Optional categorization; empty clears it. */
export async function setRegionKind(id: string, kind: string): Promise<LandscapeRegion> {
  return setText(id, 'kind', kind.toLowerCase());
}

export async function setRegionParent(id: string, parentRegionId: string | null): Promise<LandscapeRegion> {
  const region = await requireRegion(id);
  const regions = await listRegionsForProject(region.projectId);
  if (wouldCreateCycle(regions, id, parentRegionId)) {
    throw new Error('A concept cannot be placed inside itself or one of its sub-concepts');
  }
  if (region.parentRegionId === parentRegionId) return region;
  return save({
    ...withRevision(region, 'parent', region.parentRegionId, parentRegionId, new Date()),
    parentRegionId,
    order: nextOrder(regions.filter((r) => r.id !== id), region.projectId, parentRegionId),
  });
}

export async function moveRegion(id: string, direction: -1 | 1): Promise<void> {
  const region = await requireRegion(id);
  const changed = reorderedSiblings(await listRegionsForProject(region.projectId), id, direction);
  if (!changed.length) return;
  const now = new Date();
  await db.landscapeRegions.bulkPut(changed.map((r) => ({ ...r, updatedAt: now })));
}

/**
 * Delete a region. Its subregions move up to its parent; its member findings
 * are untouched and fall back to Uncategorized if no other region holds them.
 */
export async function deleteRegion(id: string): Promise<void> {
  const region = await requireRegion(id);
  await db.transaction('rw', db.landscapeRegions, async () => {
    const children = await db.landscapeRegions.where('parentRegionId').equals(id).toArray();
    const now = new Date();
    for (const child of children) {
      await db.landscapeRegions.put({ ...child, parentRegionId: region.parentRegionId, updatedAt: now });
    }
    await db.landscapeRegions.delete(id);
  });
}

export async function setMembership(
  regionId: string,
  objectId: string,
  member: boolean
): Promise<LandscapeRegion> {
  const region = await requireRegion(regionId);
  const object = await db.understandingObjects.get(objectId);
  if (member && object?.projectId !== region.projectId) {
    throw new Error('Only understanding from this project can be placed in its concepts');
  }
  const next = withMembership(region, objectId, member);
  return next === region ? region : save(next);
}

export async function setPinned(
  regionId: string,
  objectId: string,
  pinned: boolean
): Promise<LandscapeRegion> {
  const region = await requireRegion(regionId);
  if (pinned) {
    const object = await db.understandingObjects.get(objectId);
    if (object?.projectId !== region.projectId) {
      throw new Error('Only understanding from this project can represent its concepts');
    }
  }
  return save(withPin(region, objectId, pinned));
}

/** Statement kinds offered on a concept; `type` is the open-ontology object type. */
export const CONCEPT_STATEMENT_TYPES = ['behavior', 'belief', 'question', 'decision'] as const;

/**
 * Write a new user statement about a concept: an accepted, user-origin
 * UnderstandingObject in the concept's project (no evidence required — the
 * user asserting it is its provenance), placed in the concept. Atomic.
 */
export async function addConceptStatement(
  regionId: string,
  input: { type: string; title: string; body?: string }
): Promise<UnderstandingObject> {
  const title = input.title.trim();
  if (!title) throw new Error('Write something first');
  const type = input.type.trim().toLowerCase();
  if (!type) throw new Error('A statement needs a type');
  if (type === 'intent') throw new Error('Intents belong to Intent Trace');
  return db.transaction('rw', [db.landscapeRegions, db.understandingObjects, db.understandingEvents], async () => {
    const region = await requireRegion(regionId);
    const object = await createUnderstandingObject({
      projectId: region.projectId,
      type,
      title,
      body: input.body?.trim() || undefined,
      origin: 'user',
      evidence: [],
      occurredAt: new Date(),
    });
    await save(withMembership(region, object.id, true));
    return object;
  });
}

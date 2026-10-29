// Persistence for Understanding Landscape regions (docs/changes/understanding-landscape).
//
// Organization only: nothing here reads or writes understanding objects or
// events, so no edit can change a finding's statement, review state,
// lifecycle status, or evidence. Every write bumps updatedAt so the sync
// engine's last-writer-wins applies per region.

import { db } from './schema';
import { generateId } from '../utils/ids';
import type { LandscapeRegion } from '../../types/landscape';
import {
  nextOrder,
  reorderedSiblings,
  withMembership,
  withPin,
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
}): Promise<LandscapeRegion> {
  const title = input.title.trim();
  if (!title) throw new Error('Region name cannot be empty');
  const project = await db.understandingProjects.get(input.projectId);
  if (!project) throw new Error('Unknown project');
  const existing = await listRegionsForProject(input.projectId);
  const parentRegionId = input.parentRegionId ?? null;
  if (parentRegionId && !existing.some((r) => r.id === parentRegionId)) {
    throw new Error('Parent region is not in this project');
  }
  const now = new Date();
  const region: LandscapeRegion = {
    id: generateId(),
    projectId: input.projectId,
    parentRegionId,
    title,
    summary: input.summary?.trim() || undefined,
    order: nextOrder(existing, input.projectId, parentRegionId),
    memberObjectIds: [],
    pinnedObjectIds: [],
    createdAt: now,
    updatedAt: now,
  };
  await db.landscapeRegions.add(region);
  return region;
}

async function requireRegion(id: string): Promise<LandscapeRegion> {
  const region = await db.landscapeRegions.get(id);
  if (!region) throw new Error('Region not found');
  return region;
}

async function save(region: LandscapeRegion): Promise<LandscapeRegion> {
  const next = { ...region, updatedAt: new Date() };
  await db.landscapeRegions.put(next);
  return next;
}

export async function renameRegion(id: string, title: string): Promise<LandscapeRegion> {
  const trimmed = title.trim();
  if (!trimmed) throw new Error('Region name cannot be empty');
  return save({ ...(await requireRegion(id)), title: trimmed });
}

export async function setRegionSummary(id: string, summary: string): Promise<LandscapeRegion> {
  return save({ ...(await requireRegion(id)), summary: summary.trim() || undefined });
}

export async function setRegionParent(id: string, parentRegionId: string | null): Promise<LandscapeRegion> {
  const region = await requireRegion(id);
  const regions = await listRegionsForProject(region.projectId);
  if (wouldCreateCycle(regions, id, parentRegionId)) {
    throw new Error('A region cannot be placed inside itself or one of its subregions');
  }
  return save({
    ...region,
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
    throw new Error('Only findings from this project can be placed in its regions');
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
      throw new Error('Only findings from this project can represent its regions');
    }
  }
  return save(withPin(region, objectId, pinned));
}

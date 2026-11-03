// Pure organization rules for landscape regions (docs/changes/understanding-landscape).
// No Dexie here: db/landscape.ts applies these to stored rows.

import type { LandscapeRegion } from '../../types/landscape';

/** At most this many pinned statements render on a region's terrain. */
export const MAX_PINNED_STATEMENTS = 2;

/**
 * True when making `parentId` the parent of `regionId` would create a cycle
 * (including a region parenting itself) or cross projects.
 */
export function wouldCreateCycle(
  regions: LandscapeRegion[],
  regionId: string,
  parentId: string | null
): boolean {
  if (parentId === null) return false;
  if (parentId === regionId) return true;
  const byId = new Map(regions.map((r) => [r.id, r]));
  const self = byId.get(regionId);
  const parent = byId.get(parentId);
  if (!self || !parent || parent.projectId !== self.projectId) return true;
  const seen = new Set<string>();
  let cursor: LandscapeRegion | undefined = parent;
  while (cursor) {
    if (cursor.id === regionId) return true;
    if (seen.has(cursor.id)) return true; // pre-existing cycle: refuse to extend it
    seen.add(cursor.id);
    cursor = cursor.parentRegionId ? byId.get(cursor.parentRegionId) : undefined;
  }
  return false;
}

/** Siblings of a region (same project and parent), in display order. */
export function siblingsOf(
  regions: LandscapeRegion[],
  projectId: string,
  parentRegionId: string | null
): LandscapeRegion[] {
  return regions
    .filter((r) => r.projectId === projectId && r.parentRegionId === parentRegionId)
    .sort(compareRegions);
}

export function compareRegions(a: LandscapeRegion, b: LandscapeRegion): number {
  return a.order - b.order || a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id);
}

/** Next order value for a new region appended under `parentRegionId`. */
export function nextOrder(
  regions: LandscapeRegion[],
  projectId: string,
  parentRegionId: string | null
): number {
  const siblings = siblingsOf(regions, projectId, parentRegionId);
  return siblings.length ? siblings[siblings.length - 1].order + 1 : 0;
}

/**
 * Swap a region with its previous (-1) or next (+1) sibling. Returns the
 * rows whose `order` changed (renumbered densely), or [] at either end.
 */
export function reorderedSiblings(
  regions: LandscapeRegion[],
  regionId: string,
  direction: -1 | 1
): LandscapeRegion[] {
  const self = regions.find((r) => r.id === regionId);
  if (!self) return [];
  const siblings = siblingsOf(regions, self.projectId, self.parentRegionId);
  const index = siblings.findIndex((r) => r.id === regionId);
  const target = index + direction;
  if (target < 0 || target >= siblings.length) return [];
  const next = [...siblings];
  [next[index], next[target]] = [next[target], next[index]];
  return next
    .map((r, order) => (r.order === order ? null : { ...r, order }))
    .filter((r): r is LandscapeRegion => r !== null);
}

/** Toggle one object's membership. Unpins it when removed. */
export function withMembership(
  region: LandscapeRegion,
  objectId: string,
  member: boolean
): LandscapeRegion {
  const has = region.memberObjectIds.includes(objectId);
  if (member === has) return region;
  return member
    ? { ...region, memberObjectIds: [...region.memberObjectIds, objectId] }
    : {
        ...region,
        memberObjectIds: region.memberObjectIds.filter((id) => id !== objectId),
        pinnedObjectIds: region.pinnedObjectIds.filter((id) => id !== objectId),
      };
}

/**
 * Toggle a representative-statement pin. Pinning adds membership too; the
 * newest pin wins when more than MAX_PINNED_STATEMENTS are pinned.
 */
export function withPin(region: LandscapeRegion, objectId: string, pinned: boolean): LandscapeRegion {
  const base = pinned ? withMembership(region, objectId, true) : region;
  const rest = base.pinnedObjectIds.filter((id) => id !== objectId);
  return {
    ...base,
    pinnedObjectIds: pinned ? [objectId, ...rest].slice(0, MAX_PINNED_STATEMENTS) : rest,
  };
}

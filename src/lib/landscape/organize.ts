// Pure organization rules for landscape regions (docs/changes/understanding-landscape).
// No Dexie here: db/landscape.ts applies these to stored rows.

import type { LandscapeRegion, LandscapeRegionField } from '../../types/landscape';

/** At most this many pinned statements render on a region's terrain. */
export const MAX_PINNED_STATEMENTS = 2;

/**
 * Saves of the same free-text field (description, summary) within this
 * window merge into one revision (the earliest `from` is kept), so writing a
 * description in several saves does not bury the history in fragments.
 * Renames, kind changes, and moves are discrete actions and never merge.
 */
export const REVISION_COALESCE_MS = 2 * 60 * 1000;
const COALESCED_FIELDS: ReadonlySet<LandscapeRegionField> = new Set(['body', 'summary']);

/** Suggested concept kinds; the field is free text, these are just offered. */
export const CONCEPT_KINDS = ['area', 'feature', 'interaction', 'component', 'workflow', 'data', 'research', 'experiment'] as const;

/**
 * Record a change of `field` on the region's revision list. A free-text
 * save merges into the previous revision when it is the same field and
 * recent; a merge back to the starting text removes that revision. Returns
 * the region unchanged when from === to.
 */
export function withRevision(
  region: LandscapeRegion,
  field: Exclude<LandscapeRegionField, 'created'>,
  from: string | null | undefined,
  to: string | null | undefined,
  at: Date
): LandscapeRegion {
  const norm = (v: string | null | undefined) => (v === undefined || v === '' ? null : v);
  if (norm(from) === norm(to)) return region;
  const revisions = [...(region.revisions ?? [])];
  const last = revisions[revisions.length - 1];
  if (last && last.field === field && COALESCED_FIELDS.has(field) && at.getTime() - last.at.getTime() <= REVISION_COALESCE_MS) {
    revisions.pop();
    if (norm(last.from) !== norm(to)) revisions.push({ at, field, from: norm(last.from), to: norm(to) });
  } else {
    revisions.push({ at, field, from: norm(from), to: norm(to) });
  }
  return { ...region, revisions };
}

/** Ids of every region nested under `regionId` (not including itself). */
export function descendantIds(regions: LandscapeRegion[], regionId: string): Set<string> {
  const out = new Set<string>();
  const queue = [regionId];
  while (queue.length) {
    const id = queue.shift()!;
    for (const r of regions) {
      if (r.parentRegionId === id && !out.has(r.id) && r.id !== regionId) {
        out.add(r.id);
        queue.push(r.id);
      }
    }
  }
  return out;
}

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

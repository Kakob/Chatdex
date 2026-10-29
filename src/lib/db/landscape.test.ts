// Landscape region persistence: organization edits never touch the
// underlying understanding records; deletes never delete findings; cycles
// and cross-project placement are refused; v15 data upgrades additively.
import { describe, it, expect, beforeEach } from 'vitest';
import Dexie from 'dexie';
import { db, ChatdexDB } from './schema';
import { clearAllData } from './index';
import { createHumanProject, createUnderstandingObject } from './understanding';
import {
  createRegion,
  deleteRegion,
  listRegionsForProject,
  moveRegion,
  renameRegion,
  setMembership,
  setPinned,
  setRegionParent,
} from './landscape';
import { envelopeLandscapeRegion, rehydrateLandscapeRegion } from '../sync/serializer';

beforeEach(async () => {
  await clearAllData();
});

async function setup() {
  const project = await createHumanProject({ name: 'Landscape test' });
  const other = await createHumanProject({ name: 'Other' });
  const object = await createUnderstandingObject({
    projectId: project.id,
    type: 'decision',
    title: 'Keep sync ciphertext-only',
    origin: 'ai',
    evidence: [{ conversationId: 'c1', messageIds: ['m1'] }],
    occurredAt: new Date('2026-09-01T00:00:00Z'),
  });
  return { project, other, object };
}

describe('landscape regions', () => {
  it('moving, pinning, and renaming change organization only — never the finding', async () => {
    const { project, object } = await setup();
    const before = await db.understandingObjects.get(object.id);
    const eventsBefore = await db.understandingEvents.where('objectId').equals(object.id).toArray();

    const a = await createRegion({ projectId: project.id, title: 'Trust' });
    const b = await createRegion({ projectId: project.id, title: 'Backup' });
    await setMembership(a.id, object.id, true);
    await setMembership(b.id, object.id, true);
    await setPinned(b.id, object.id, true);
    await setMembership(a.id, object.id, false);
    await renameRegion(b.id, 'Backup & restore');

    expect(await db.understandingObjects.get(object.id)).toEqual(before);
    expect(await db.understandingEvents.where('objectId').equals(object.id).toArray()).toEqual(eventsBefore);
    const regions = await listRegionsForProject(project.id);
    expect(regions.find((r) => r.id === a.id)!.memberObjectIds).toEqual([]);
    expect(regions.find((r) => r.id === b.id)).toMatchObject({ title: 'Backup & restore', memberObjectIds: [object.id], pinnedObjectIds: [object.id] });
  });

  it('refuses cross-project membership and parent cycles', async () => {
    const { project, other, object } = await setup();
    const foreign = await createRegion({ projectId: other.id, title: 'Elsewhere' });
    await expect(setMembership(foreign.id, object.id, true)).rejects.toThrow(/this project/);
    const parent = await createRegion({ projectId: project.id, title: 'Parent' });
    const child = await createRegion({ projectId: project.id, title: 'Child', parentRegionId: parent.id });
    await expect(setRegionParent(parent.id, child.id)).rejects.toThrow(/inside itself/);
    await expect(setRegionParent(parent.id, foreign.id)).rejects.toThrow();
    await expect(createRegion({ projectId: project.id, title: 'X', parentRegionId: foreign.id })).rejects.toThrow();
    await expect(createRegion({ projectId: project.id, title: '   ' })).rejects.toThrow();
  });

  it('deleting a region keeps its findings and lifts subregions to its parent', async () => {
    const { project, object } = await setup();
    const top = await createRegion({ projectId: project.id, title: 'Top' });
    const mid = await createRegion({ projectId: project.id, title: 'Mid', parentRegionId: top.id });
    const leaf = await createRegion({ projectId: project.id, title: 'Leaf', parentRegionId: mid.id });
    await setMembership(mid.id, object.id, true);
    await deleteRegion(mid.id);
    expect(await db.understandingObjects.get(object.id)).toBeDefined();
    expect((await db.landscapeRegions.get(leaf.id))!.parentRegionId).toBe(top.id);
    expect(await db.landscapeRegions.get(mid.id)).toBeUndefined();
  });

  it('reorders siblings and persists across a reload of the table', async () => {
    const { project } = await setup();
    const a = await createRegion({ projectId: project.id, title: 'A' });
    const b = await createRegion({ projectId: project.id, title: 'B' });
    await moveRegion(b.id, -1);
    const rows = (await listRegionsForProject(project.id)).sort((x, y) => x.order - y.order);
    expect(rows.map((r) => r.id)).toEqual([b.id, a.id]);
  });

  it('round-trips through the sync serializer with content inside the payload only', async () => {
    const { project, object } = await setup();
    const region = await createRegion({ projectId: project.id, title: 'Private title', summary: 'Private summary' });
    const placed = await setPinned(region.id, object.id, true);
    const env = envelopeLandscapeRegion(placed);
    expect(env.kind).toBe('landscape_region');
    expect(env.parentId).toBe(project.id);
    expect(rehydrateLandscapeRegion(JSON.parse(JSON.stringify(env.payload)))).toEqual(placed);
  });

  it('clears with local data', async () => {
    const { project } = await setup();
    await createRegion({ projectId: project.id, title: 'Gone soon' });
    await clearAllData();
    expect(await db.landscapeRegions.count()).toBe(0);
  });
});

it('upgrades a v15 database additively, preserving existing records', async () => {
  const name = 'synthetic-migration-landscape';
  const old = new Dexie(name);
  const schema = Object.fromEntries(
    db.tables
      .filter((t) => t.name !== 'landscapeRegions')
      .map((t) => [t.name, [t.schema.primKey.src, ...t.schema.indexes.map((i) => i.src)].join(', ')])
  );
  old.version(15).stores(schema);
  await old.open();
  const legacyObject = { id: 'legacy-o', projectId: 'p', type: 'decision', title: 'Preserve', status: 'current', reviewState: 'pending', createdAt: new Date('2020-01-01') };
  const legacyProject = { id: 'p', name: 'Legacy', reviewState: 'accepted', updatedAt: new Date('2020-01-01') };
  await old.table('understandingObjects').add(legacyObject);
  await old.table('understandingProjects').add(legacyProject);
  old.close();
  const upgraded = new ChatdexDB(name);
  await upgraded.open();
  expect(upgraded.verno).toBe(16);
  expect(await upgraded.understandingObjects.get('legacy-o')).toEqual(legacyObject);
  expect(await upgraded.understandingProjects.get('p')).toEqual(legacyProject);
  expect(await upgraded.landscapeRegions.count()).toBe(0);
  await upgraded.delete();
});

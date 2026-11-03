// Editable landscape (docs/changes/editable-landscape): concepts and the
// statements about them can be created and developed with no conversation,
// history is kept, structure stays acyclic and project-local, linking an
// existing record never copies or alters it, and AI rewording never lands
// without review.
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from './schema';
import { clearAllData } from './index';
import {
  createHumanProject,
  createUnderstandingObject,
  recordUnderstandingEvent,
  reviewUnderstandingObject,
  reviseUnderstandingObject,
  setEventReviewState,
} from './understanding';
import {
  addConceptStatement,
  createRegion,
  deleteRegion,
  renameRegion,
  setMembership,
  setRegionBody,
  setRegionKind,
  setRegionParent,
} from './landscape';
import { envelopeLandscapeRegion, rehydrateLandscapeRegion, envelopeUnderstandingEvent, rehydrateUnderstandingEvent } from '../sync/serializer';
import { withRevision, REVISION_COALESCE_MS } from '../landscape/organize';

beforeEach(async () => {
  await clearAllData();
});

describe('concepts without conversations', () => {
  it('builds a nested hierarchy from titles alone', async () => {
    const atlas = await createHumanProject({ name: 'Atlas Maps' });
    const map = await createRegion({ projectId: atlas.id, title: 'Map' });
    const interactions = await createRegion({ projectId: atlas.id, title: 'Map interactions', parentRegionId: map.id });
    const drag = await createRegion({ projectId: atlas.id, title: 'Box zoom', parentRegionId: interactions.id });

    expect(drag).toMatchObject({ parentRegionId: interactions.id, memberObjectIds: [] });
    expect(drag.revisions).toEqual([{ at: drag.createdAt, field: 'created', to: 'Box zoom' }]);
    expect(await db.understandingObjects.count()).toBe(0);
    expect(await db.projectAssociations.count()).toBe(0);
    expect(await db.conversations.count()).toBe(0);
  });

  it('records every field change in history, oldest first', async () => {
    const p = await createHumanProject({ name: 'Atlas Maps' });
    const a = await createRegion({ projectId: p.id, title: 'Map' });
    const b = await createRegion({ projectId: p.id, title: 'Data' });
    await renameRegion(a.id, 'Map view');
    await setRegionBody(a.id, 'The map and everything drawn on it.');
    await setRegionKind(a.id, 'Feature');
    await setRegionParent(a.id, b.id);
    const row = (await db.landscapeRegions.get(a.id))!;
    expect(row).toMatchObject({ title: 'Map view', kind: 'feature', parentRegionId: b.id });
    expect(row.revisions!.map((r) => [r.field, r.from ?? null, r.to ?? null])).toEqual([
      ['created', null, 'Map'],
      ['title', 'Map', 'Map view'],
      ['body', null, 'The map and everything drawn on it.'],
      ['kind', null, 'feature'],
      ['parent', null, b.id],
    ]);
    // Clearing keeps the old text in history.
    await setRegionBody(a.id, '');
    const cleared = (await db.landscapeRegions.get(a.id))!;
    expect(cleared.body).toBeUndefined();
    expect(cleared.revisions!.at(-1)).toMatchObject({ field: 'body', from: 'The map and everything drawn on it.', to: null });
  });

  it('coalesces rapid edits of one field and drops edits that return to the start', () => {
    const base = { id: 'r', projectId: 'p', parentRegionId: null, title: 'A', order: 0, memberObjectIds: [], pinnedObjectIds: [], createdAt: new Date(0), updatedAt: new Date(0) };
    const t0 = new Date('2026-11-03T10:00:00Z');
    const t1 = new Date(t0.getTime() + 1000);
    const late = new Date(t0.getTime() + REVISION_COALESCE_MS + 5000);
    const one = withRevision(base, 'body', undefined, 'draft', t0);
    const two = withRevision(one, 'body', 'draft', 'draft two', t1);
    expect(two.revisions).toEqual([{ at: t1, field: 'body', from: null, to: 'draft two' }]);
    expect(withRevision(two, 'body', 'draft two', '', t1).revisions).toEqual([]);
    expect(withRevision(two, 'body', 'draft two', 'final', late).revisions).toHaveLength(2);
    expect(withRevision(base, 'title', 'A', 'A', t0)).toBe(base);
    // Discrete actions never merge: a move and a move back are both kept.
    const moved = withRevision(withRevision(base, 'parent', null, 'x', t0), 'parent', 'x', null, t1);
    expect(moved.revisions).toHaveLength(2);
  });

  it('rejects containment cycles and cross-project structure', async () => {
    const p = await createHumanProject({ name: 'Atlas Maps' });
    const other = await createHumanProject({ name: 'Other' });
    const map = await createRegion({ projectId: p.id, title: 'Map' });
    const inner = await createRegion({ projectId: p.id, title: 'Map interactions', parentRegionId: map.id });
    const deep = await createRegion({ projectId: p.id, title: 'Box zoom', parentRegionId: inner.id });
    const foreign = await createRegion({ projectId: other.id, title: 'Elsewhere' });

    await expect(setRegionParent(map.id, deep.id)).rejects.toThrow(/inside itself/);
    await expect(setRegionParent(map.id, map.id)).rejects.toThrow(/inside itself/);
    await expect(setRegionParent(map.id, foreign.id)).rejects.toThrow();
    await expect(createRegion({ projectId: p.id, title: 'X', parentRegionId: foreign.id })).rejects.toThrow(/not in this project/);
    // A valid reparent still works and is recorded.
    await setRegionParent(deep.id, map.id);
    expect((await db.landscapeRegions.get(deep.id))!.parentRegionId).toBe(map.id);
  });

  it('deleting a concept lifts its sub-concepts and keeps its statements', async () => {
    const p = await createHumanProject({ name: 'Atlas Maps' });
    const map = await createRegion({ projectId: p.id, title: 'Map' });
    const inner = await createRegion({ projectId: p.id, title: 'Map interactions', parentRegionId: map.id });
    const statement = await addConceptStatement(map.id, { type: 'behavior', title: 'Render tiles' });
    await deleteRegion(map.id);
    expect((await db.landscapeRegions.get(inner.id))!.parentRegionId).toBeNull();
    expect(await db.understandingObjects.get(statement.id)).toBeDefined();
  });
});

describe('statements about a concept', () => {
  it('writes accepted user-origin understanding with no evidence, placed in the concept', async () => {
    const p = await createHumanProject({ name: 'Atlas Maps' });
    const drag = await createRegion({ projectId: p.id, title: 'Box zoom' });
    const object = await addConceptStatement(drag.id, { type: 'behavior', title: 'Dragging a box zooms to the selected area', body: 'Release applies the zoom.' });
    expect(object).toMatchObject({ projectId: p.id, type: 'behavior', origin: 'user', reviewState: 'accepted', status: 'current' });
    const events = await db.understandingEvents.where('objectId').equals(object.id).toArray();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ op: 'introduced', origin: 'user', evidence: [] });
    expect((await db.landscapeRegions.get(drag.id))!.memberObjectIds).toEqual([object.id]);
    await expect(addConceptStatement(drag.id, { type: 'behavior', title: '  ' })).rejects.toThrow();
    await expect(addConceptStatement(drag.id, { type: 'intent', title: 'x' })).rejects.toThrow(/Intent Trace/);
  });

  it('links an existing record (tile licensing decision) without copying or altering it', async () => {
    const p = await createHumanProject({ name: 'Atlas Maps' });
    const licensing = await createUnderstandingObject({
      projectId: p.id,
      type: 'decision',
      title: 'Tile licensing decision',
      body: 'Why satellite tiles are display-only.',
      origin: 'ai',
      evidence: [{ conversationId: 'conv-licensing', messageIds: ['m1'] }],
      occurredAt: new Date('2026-09-01T00:00:00Z'),
    });
    await recordUnderstandingEvent({ objectId: licensing.id, op: 'supported', evidence: [{ conversationId: 'conv-2' }], origin: 'user', occurredAt: new Date('2026-09-02T00:00:00Z') });
    const before = await db.understandingObjects.get(licensing.id);
    const eventsBefore = await db.understandingEvents.where('objectId').equals(licensing.id).toArray();

    const data = await createRegion({ projectId: p.id, title: 'Data and research' });
    await setMembership(data.id, licensing.id, true);
    await setMembership(data.id, licensing.id, true); // idempotent

    expect(await db.understandingObjects.get(licensing.id)).toEqual(before);
    expect(await db.understandingEvents.where('objectId').equals(licensing.id).toArray()).toEqual(eventsBefore);
    expect(await db.understandingObjects.count()).toBe(1);
    expect((await db.landscapeRegions.get(data.id))!.memberObjectIds).toEqual([licensing.id]);
  });
});

describe('rewording with history', () => {
  async function statement() {
    const p = await createHumanProject({ name: 'Atlas Maps' });
    const drag = await createRegion({ projectId: p.id, title: 'Box zoom' });
    return addConceptStatement(drag.id, { type: 'behavior', title: 'Drag zooms', body: 'v1' });
  }

  it('user edits apply immediately and keep the previous wording', async () => {
    const object = await statement();
    const event = await reviseUnderstandingObject(object.id, { title: 'Drag zooms the viewport', body: 'v2' });
    expect(event).toMatchObject({ op: 'refined', origin: 'user', reviewState: 'accepted', revision: { previousTitle: 'Drag zooms', previousBody: 'v1', title: 'Drag zooms the viewport', body: 'v2' } });
    expect(await db.understandingObjects.get(object.id)).toMatchObject({ title: 'Drag zooms the viewport', body: 'v2', reviewState: 'accepted' });
    expect(await reviseUnderstandingObject(object.id, { title: 'Drag zooms the viewport', body: 'v2' })).toBeNull();
  });

  it('AI rewording stays pending until accepted, and refuses to overwrite newer text', async () => {
    const object = await statement();
    const proposal = await recordUnderstandingEvent({
      objectId: object.id,
      op: 'refined',
      evidence: [{ conversationId: 'chatdex-1' }],
      origin: 'ai',
      occurredAt: new Date(),
      revision: { title: 'Drag selects a range, release zooms', previousTitle: 'Drag zooms', previousBody: 'v1' },
    });
    expect(proposal.reviewState).toBe('pending');
    expect((await db.understandingObjects.get(object.id))!.title).toBe('Drag zooms');

    // The user edits in the meantime → accepting the stale proposal is refused.
    await reviseUnderstandingObject(object.id, { title: 'Drag zooms (mine)', body: 'v1' });
    await expect(setEventReviewState(proposal.id, 'accepted')).rejects.toThrow(/changed after the proposal/);
    // Edit & accept against the current wording works and records what it replaced.
    await setEventReviewState(proposal.id, 'edited', { title: 'Drag selects a range; release zooms', body: 'v3' });
    expect(await db.understandingObjects.get(object.id)).toMatchObject({ title: 'Drag selects a range; release zooms', body: 'v3' });
    expect(await db.understandingEvents.get(proposal.id)).toMatchObject({ reviewState: 'edited', revision: { previousTitle: 'Drag zooms (mine)' } });
    const reviewed = (await db.understandingEvents.get(proposal.id))!;
    expect(reviewed.originalRevision).toEqual(proposal.revision);
    expect(reviewed.originalRevision?.title).toBe('Drag selects a range, release zooms');
    expect(reviewed.originalRevision?.previousBody).toBe('v1');
    expect(reviewed.revision).toMatchObject({ title: 'Drag selects a range; release zooms', body: 'v3', previousTitle: 'Drag zooms (mine)' });
    expect(reviewed.evidence).toEqual(proposal.evidence);
    const wire = JSON.parse(JSON.stringify(envelopeUnderstandingEvent(reviewed).payload));
    expect(rehydrateUnderstandingEvent(wire)).toEqual(reviewed);
    await expect(setEventReviewState(proposal.id, 'accepted')).rejects.toThrow(/already edited/);

  });

  it('accepting an untouched AI rewording applies it; rejecting changes nothing', async () => {
    const object = await statement();
    const mk = (title: string) =>
      recordUnderstandingEvent({ objectId: object.id, op: 'refined', evidence: [{ conversationId: 'c' }], origin: 'ai', occurredAt: new Date(), revision: { title, previousTitle: 'Drag zooms', previousBody: 'v1' } });
    const rejected = await mk('Rejected wording');
    await setEventReviewState(rejected.id, 'rejected');
    expect((await db.understandingObjects.get(object.id))!.title).toBe('Drag zooms');
    const accepted = await mk('Accepted wording');
    await setEventReviewState(accepted.id, 'accepted');
    const after = (await db.understandingObjects.get(object.id))!;
    expect(after.title).toBe('Accepted wording');
    expect('body' in after).toBe(false);
  });

  it('pending AI objects cannot be edited by a side door; edit & accept keeps the AI text in history', async () => {
    const p = await createHumanProject({ name: 'Atlas Maps' });
    const ai = await createUnderstandingObject({ projectId: p.id, type: 'belief', title: 'AI wording', origin: 'ai', evidence: [{ conversationId: 'c' }], occurredAt: new Date() });
    await expect(reviseUnderstandingObject(ai.id, { title: 'mine' })).rejects.toThrow(/Review this pending/);
    await reviewUnderstandingObject(ai.id, 'edited', { title: 'My wording' });
    expect(await db.understandingObjects.get(ai.id)).toMatchObject({ title: 'My wording', reviewState: 'edited', origin: 'ai' });
    const events = await db.understandingEvents.where('objectId').equals(ai.id).toArray();
    expect(events.find((e) => e.op === 'refined')).toMatchObject({ origin: 'user', revision: { previousTitle: 'AI wording', title: 'My wording' } });
    await expect(reviewUnderstandingObject(ai.id, 'accepted')).rejects.toThrow(/re-review/);
  });
});

describe('sync', () => {
  it('round-trips concept fields and revision dates through the serializer', async () => {
    const p = await createHumanProject({ name: 'Atlas Maps' });
    const r = await createRegion({ projectId: p.id, title: 'Map', kind: 'feature', body: 'About the map' });
    const renamed = await renameRegion(r.id, 'Map view');
    const envelope = envelopeLandscapeRegion(renamed);
    const wire = JSON.parse(JSON.stringify(envelope.payload));
    expect(typeof wire.revisions[0].at).toBe('string');
    expect(rehydrateLandscapeRegion(wire)).toEqual(renamed);
    // Rows from before the editable landscape stay without revisions.
    const legacy = { ...wire };
    delete legacy.revisions;
    expect(rehydrateLandscapeRegion(legacy).revisions).toBeUndefined();
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import Dexie from 'dexie';
import { db, ChatdexDB } from '../db/schema';
import { clearAllData, createHumanProject } from '../db';
import { createSyntheticWalkthrough, SYNTHETIC_EARLY } from './synthetic';
import { addRelation, attachSource, createQuestionNode, exportPacket, finalizeResearchFinding, importText, parseRegistry, pinResearchExhibit, registerSource, removeRelation, resolveExhibit, saveResearchFinding, startResearchCase, unknownTime } from './service';
import { completeQuestionInvestigation, reopenQuestionInvestigation } from '../investigation/cases';

beforeEach(async () => { await clearAllData(); });
async function fixture() {
  const p = await createHumanProject({ name: 'SYNTHETIC test inquiry' });
  const c = await startResearchCase(p.id, 'What changed?');
  const s = await registerSource({ projectId: p.id, title: 'Synthetic notes', kind: 'recollection', attribution: 'Fictional author', uri: 'https://example.invalid/private', authored: { value: '2019', precision: 'year' }, eventTime: unknownTime(), notes: 'Lead only', locator: '' });
  await attachSource(c.id, s.id, true);
  return { p, c, s };
}

describe('private research vertical slice', () => {
  it('starts with zero conversations; imports idempotently, preserves exact CRLF and old versions', async () => {
    const { p, c, s } = await fixture();
    expect(c.conversationId).toBe('');
    expect(await db.conversations.count()).toBe(0);
    const old = await importText(p.id, s.id, 'notes.txt', SYNTHETIC_EARLY);
    expect(old.text).toBe(SYNTHETIC_EARLY);
    expect((await importText(p.id, s.id, 'renamed.md', SYNTHETIC_EARLY)).id).toBe(old.id);
    const e = await pinResearchExhibit(c.id, s.id, { snapshotId: old.id, start: 0, end: 9, note: 'My note' });
    const changed = await importText(p.id, s.id, 'notes.txt', 'Changed source');
    expect(changed.id).not.toBe(old.id);
    expect((await resolveExhibit(e)).snapshot?.text).toBe(SYNTHETIC_EARLY);
    await attachSource(c.id, s.id, false);
    expect((await resolveExhibit(e)).status).toBe('exact');
    expect(await db.researchSnapshots.count()).toBe(2);
  });

  it('rejects forged offsets, hashes, source versions, unaccepted projects and cross-project attachment', async () => {
    const { p, c, s } = await fixture();
    const snap = await importText(p.id, s.id, 'notes.md', 'Exact text');
    await expect(pinResearchExhibit(c.id, s.id, { snapshotId: snap.id, start: -1, end: 5, note: '' })).rejects.toThrow('span');
    await expect(pinResearchExhibit(c.id, s.id, { snapshotId: snap.id, start: 0, end: 50, note: '' })).rejects.toThrow('span');
    const other = await createHumanProject({ name: 'Other' });
    const foreign = await startResearchCase(other.id, 'Another question');
    await expect(attachSource(foreign.id, s.id, true)).rejects.toThrow('unavailable');
    await expect(importText(other.id, s.id, 'notes.txt', 'wrong')).rejects.toThrow('unavailable');
    const e = await pinResearchExhibit(c.id, s.id, { snapshotId: snap.id, start: 0, end: 5, note: '' });
    expect((await resolveExhibit({ ...e, quoteHash: 'forged' })).status).toBe('source mismatch');
    expect((await resolveExhibit({ ...e, start: 1 })).status).toBe('source mismatch');
    await db.researchSnapshots.update(snap.id, { text: 'Tampered text' });
    expect((await resolveExhibit(e)).status).toBe('source mismatch');
    await expect(pinResearchExhibit(c.id, s.id, { snapshotId: snap.id, start: 0, end: 3, note: '' })).rejects.toThrow('mismatch');
    await db.researchSnapshots.delete(snap.id);
    expect((await resolveExhibit(e)).status).toBe('source unavailable');
    await db.understandingProjects.update(p.id, { reviewState: 'rejected' });
    await expect(startResearchCase(p.id, 'Question')).rejects.toThrow('accepted project');
  });

  it('registers a manifest as leads only, makes no requests, never supplies reference quotes', async () => {
    const { p, c } = await fixture();
    const fetch = vi.spyOn(globalThis, 'fetch');
    const [lead] = parseRegistry(JSON.stringify({ is_source_content: false, sources: [{ id: 'lead', title: 'Synthetic video', kind: 'video', locator: 'https://example.invalid/video', authored_at: 'Spring 2019', notes: 'This is not source text.' }] }));
    const source = await registerSource({ ...lead, projectId: p.id });
    expect((await registerSource({ ...lead, projectId: p.id })).id).toBe(source.id);
    expect(source.access).toBe('reference-only');
    expect(await db.researchSnapshots.count()).toBe(0);
    await attachSource(c.id, source.id, true);
    const e = await pinResearchExhibit(c.id, source.id, { note: 'Need transcript', locator: '00:45' });
    expect(e.quote).toBe('');
    expect((await resolveExhibit(e)).status).toBe('reference-only');
    await expect(createQuestionNode(p.id, e.id)).rejects.toThrow('exact');
    expect(fetch).not.toHaveBeenCalled(); fetch.mockRestore();
  });

  it('retains human finding revisions, support/conflict evidence and completion/reopen semantics', async () => {
    const { p, c, s } = await fixture();
    const snap = await importText(p.id, s.id, 'notes.txt', 'one two');
    const a = await pinResearchExhibit(c.id, s.id, { snapshotId: snap.id, start: 0, end: 3, note: '' });
    const b = await pinResearchExhibit(c.id, s.id, { snapshotId: snap.id, start: 4, end: 7, note: '' });
    const f = await saveResearchFinding(c.id, { title: 'My interpretation', body: 'Uncertain', support: [a.id], conflict: [b.id] });
    await finalizeResearchFinding(f.id);
    await completeQuestionInvestigation(c.id);
    await expect(saveResearchFinding(c.id, { id: f.id, title: 'Revised', body: '', support: [a.id], conflict: [] })).rejects.toThrow('Reopen');
    await reopenQuestionInvestigation(c.id);
    const revised = await saveResearchFinding(c.id, { id: f.id, title: 'Revised by me', body: 'Still unresolved', support: [b.id], conflict: [a.id] });
    expect(revised.state).toBe('draft');
    expect(revised.revisions?.[0]).toMatchObject({ title: 'My interpretation', body: 'Uncertain', exhibitIds: [a.id], conflictingExhibitIds: [b.id] });
  });

  it('uses canonical question objects, supports forks/recombination and preserves correction history', async () => {
    const { p, c, s } = await fixture();
    const snap = await importText(p.id, s.id, 'notes.txt', 'First question? Second question? Third question?');
    const a = await pinResearchExhibit(c.id, s.id, { snapshotId: snap.id, start: 0, end: 15, note: '' });
    const b = await pinResearchExhibit(c.id, s.id, { snapshotId: snap.id, start: 16, end: 32, note: '' });
    const d = await pinResearchExhibit(c.id, s.id, { snapshotId: snap.id, start: 33, end: 48, note: '' });
    const [n1,n2,n3] = await Promise.all([a,b,d].map(e => createQuestionNode(p.id,e.id)));
    expect(n1.title).toBe(a.quote); expect(n1.type).toBe('question'); expect(n1.meta?.expressedAt).toBe('2019');
    const events = await db.understandingEvents.where('objectId').equals(n1.id).toArray();
    expect(events[0].occurredAt.getFullYear()).not.toBe(2019); // adoption clock, historical date in metadata
    const edge = await addRelation(p.id, { from: n1.id, to: n2.id, kind: 'refined', explanation: 'My tentative reading', tentative: true });
    await addRelation(p.id, { from: n1.id, to: n3.id, kind: 'branched', explanation: 'Alternative', tentative: true });
    await addRelation(p.id, { from: n2.id, to: n3.id, kind: 'combined', explanation: 'Combining', tentative: true });
    await removeRelation(p.id, edge.id, 'Correction after reading');
    expect(await db.questionRelations.count()).toBe(4);
    expect((await db.questionRelations.get(edge.id))?.explanation).toBe('My tentative reading');
    await expect(addRelation(p.id, { from: n1.id, to: n1.id, kind: 'refined', explanation: 'Self', tentative: false })).rejects.toThrow();
    await expect(addRelation(p.id, { from: n1.id, to: n2.id, kind: 'refined', explanation: '', tentative: false })).rejects.toThrow();
    const other = await createHumanProject({ name: 'Foreign' });
    await expect(addRelation(other.id, { from: n1.id, to: n2.id, kind: 'refined', explanation: 'Wrong project', tentative: false })).rejects.toThrow();
  });

  it('exports a reviewable packet with bodies and private URLs omitted by default, explicit opt-in only', async () => {
    const { p, c, s } = await fixture();
    const snap = await importText(p.id, s.id, 'notes.txt', 'Quote https://example.invalid/private Remaining full source body');
    await pinResearchExhibit(c.id, s.id, { snapshotId: snap.id, start: 0, end: 37, note: 'See https://example.invalid/note' });
    const safe = await exportPacket(c.id);
    expect(safe).not.toContain('https://'); expect(safe).not.toContain('Remaining full source body');
    const parsed = JSON.parse(safe); expect(parsed.snapshots[0].text).toBeUndefined(); expect(parsed.exhibits[0].integrity).toBe('exact');
    const full = await exportPacket(c.id, { includeBodies: true, includeUrls: true });
    expect(full).toContain('Remaining full source body'); expect(full).toContain('https://example.invalid/private');
  });

  it('runs the synthetic walkthrough through the real ChatGPT importer and preserves assistant attribution', async () => {
    const c = await createSyntheticWalkthrough();
    expect((await createSyntheticWalkthrough()).id).toBe(c.id);
    const exhibits = await db.researchExhibits.where('caseId').equals(c.id).toArray();
    expect(exhibits).toHaveLength(3);
    expect(exhibits.map(e => e.expressedAt.value)).toContain('2019');
    const chatSource = (await db.researchSources.where('projectId').equals(c.projectId!).toArray()).find(s => s.conversationId)!;
    const snap = (await db.researchSnapshots.where('sourceId').equals(chatSource.id).toArray())[0];
    const assistant = snap.segments!.find(s => s.role === 'assistant')!;
    const e = await pinResearchExhibit(c.id, chatSource.id, { snapshotId: snap.id, start: assistant.start, end: assistant.end, note: '' });
    expect(e.role).toBe('assistant');
    await expect(pinResearchExhibit(c.id, chatSource.id, { snapshotId: snap.id, start: 0, end: snap.text.length, note: '' })).rejects.toThrow('one message');
    expect(await db.rawSources.count()).toBe(1);
    expect(await db.questionRelations.count()).toBe(1);
    expect(JSON.parse(await exportPacket(c.id)).sources).toHaveLength(4);
  });
});

it('upgrades a v13 database additively without altering legacy cases, verdicts, findings, conversations or prepared changes', async () => {
  const name = 'synthetic-migration-inquiry';
  const old = new Dexie(name);
  const newTables = new Set(['researchSources', 'researchSnapshots', 'researchExhibits', 'questionRelations']);
  const schema = Object.fromEntries(db.tables.filter(t => !newTables.has(t.name)).map(t => [t.name, [t.schema.primKey.src, ...t.schema.indexes.map(i => i.src)].join(', ')]));
  old.version(13).stores(schema);
  await old.open();
  const tables = ['investigationCases', 'verdictRevisions', 'investigationFindings', 'conversations', 'preparedChanges', 'rawSources'];
  const records = tables.map((name,i) => ({ id: `legacy-${i}`, conversationId: 'legacy-conv', caseId: 'legacy-0', projectId: 'p', contentHash: `hash-${i}`, revisionNumber: 1, title: name, legacyContent: 'Preserve exactly', createdAt: new Date('2020-01-01') }));
  for (let i = 0; i < tables.length; i++) await old.table(tables[i]).add(records[i]);
  old.close();
  const upgraded = new ChatdexDB(name); await upgraded.open();
  expect(upgraded.verno).toBe(14);
  for (let i = 0; i < tables.length; i++) expect(await upgraded.table(tables[i]).get(records[i].id)).toEqual(records[i]);
  expect(await upgraded.researchSources.count()).toBe(0);
  await upgraded.delete();
});

it('maps browser selections to exact original CRLF/CR/Unicode offsets', async () => {
  const { sourceOffset, displayOffset } = await import('./selection');
  const text = 'head\r\n😀Question?\rnext';
  const display = text.replace(/\r\n?/g, '\n');
  const start = display.indexOf('Question');
  const end = start + 'Question?'.length;
  expect(text.slice(sourceOffset(text, start), sourceOffset(text, end))).toBe('Question?');
  expect(displayOffset(text, sourceOffset(text, end))).toBe(end);
});

it('round-trips finding revision timestamps through encrypted sync serialization', async () => {
  const { envelopeInvestigationFinding, rehydrateInvestigationFinding } = await import('../sync/serializer');
  const { p, c, s } = await fixture();
  const snap = await importText(p.id, s.id, 'notes.txt', 'Source');
  const e = await pinResearchExhibit(c.id, s.id, { snapshotId: snap.id, start: 0, end: 6, note: '' });
  const f = await saveResearchFinding(c.id, { title: 'Original', body: '', support: [e.id], conflict: [] });
  const next = await saveResearchFinding(c.id, { id: f.id, title: 'Revision', body: '', support: [], conflict: [e.id] });
  const restored = rehydrateInvestigationFinding(JSON.parse(JSON.stringify(envelopeInvestigationFinding(next).payload)));
  expect(restored.revisions?.[0].revisedAt).toEqual(f.updatedAt);
  expect(restored.revisions?.[0].revisedAt).toBeInstanceOf(Date);
});

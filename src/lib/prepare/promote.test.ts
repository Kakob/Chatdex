// SPEC-change-workspace §16 CW-5: promotion creates an accepted user object with
// EvidenceRefs + codeEvidence; only verified items/edges promote; questions link.
import { beforeEach, describe, expect, it } from 'vitest';
import { clearAllData, db, putUnderstandingProject } from '../db';
import { getObjectsForProject, getUnderstandingObject } from '../db/understanding';
import { createPreparedChange, updatePreparedChangeDraft } from './changes';
import { addEvidenceItems, attachImplementation, closeWorkspace, markVerified, updateLearned, updateTrace, updateVerificationRow } from './lifecycle';
import { createWorkspaceQuestion, evidenceRefsFrom, promoteFromWorkspace, promotedObjectsForWorkspace, promotionCandidates, questionsForWorkspace } from './promote';
import type { EvidenceItem } from '../../types/evidence';
import type { PreparedChange } from '../../types/preparedChange';

const iso = '2026-08-28T10:00:00.000Z';
const now = new Date(iso);
const evidence: EvidenceItem[] = [
  { id: 'code', kind: 'code', createdAt: iso, origin: 'user', addedVia: 'search', repoKey: 'gh:Kakob/Chatdex', sha: 'a'.repeat(40), path: 'src/pages/ConversationsPage.tsx', startLine: 5, endLine: 6, quote: 'scrollTo', quoteHash: 'h' },
  { id: 'run', kind: 'test_runtime', createdAt: iso, origin: 'user', addedVia: 'attach', source: 'transcript', conversationId: 'conv-cc', messageId: 'm9', stepIndex: 9, command: 'npm test', outcome: 'pass' },
  { id: 'conv', kind: 'intent_history', createdAt: iso, origin: 'user', addedVia: 'manual', source: 'conversation', conversationId: 'conv-1', messageIds: ['m1'] },
  { id: 'ai', kind: 'ai_inference', createdAt: iso, origin: 'ai', addedVia: 'assisted', runId: 'r', provider: 'anthropic', promptDigest: 'd', text: 'guess' },
];

async function verifiedWorkspace(): Promise<PreparedChange> {
  await putUnderstandingProject({ id: 'p1', name: 'Chatdex', origin: 'user', reviewState: 'accepted', createdAt: now, updatedAt: now });
  let change = await createPreparedChange({ projectId: 'p1', title: 'Scroll to match', understandingPointIds: [], intent: { currentBehavior: '', desiredBehavior: 'scrolls', whyItMatters: '' } });
  change = await updatePreparedChangeDraft(change.id, { criteria: [{ id: 'c1', text: 'scrolls', createdAt: '' }] });
  change = await addEvidenceItems(change.id, evidence);
  change = await updateTrace(change.id, {
    nodes: [
      { id: 'n1', label: 'SearchPage', kind: 'component', evidenceIds: [], order: 0 },
      { id: 'n2', label: 'ConversationsPage', kind: 'component', evidenceIds: [], order: 1 },
      { id: 'n3', label: '???', kind: 'unknown', evidenceIds: [], order: 2 },
    ],
    edges: [
      { id: 'e1', from: 'n1', to: 'n2', claim: 'passes scrollTo', evidenceIds: ['code'], origin: 'user' },
      { id: 'e2', from: 'n2', to: 'n3', evidenceIds: ['ai'], origin: 'user' },
    ],
  });
  change = await attachImplementation(change.id, { source: 'pasted_diff', provenance: 'human', files: [{ path: 'a', additions: 1, deletions: 0 }] });
  change = await updateVerificationRow(change.id, { criterionId: 'c1', evidenceIds: ['run'], status: 'supported' });
  return markVerified(change.id);
}

beforeEach(async () => {
  await clearAllData();
});

describe('promotion (law §2.8)', () => {
  it('offers only mechanical evidence and verified edges', async () => {
    const change = await verifiedWorkspace();
    const candidates = promotionCandidates(change);
    expect(candidates.evidence.map((e) => e.id)).toEqual(['code', 'run']);
    expect(candidates.edges.map((c) => [c.edge.id, c.fromLabel, c.toLabel])).toEqual([['e1', 'SearchPage', 'ConversationsPage']]);
  });

  it('creates an accepted user object with EvidenceRefs and codeEvidence, and records the promotion', async () => {
    const change = await verifiedWorkspace();
    const { change: updated, object } = await promoteFromWorkspace(change.id, {
      title: 'ConversationsPage owns scrolling to the target message',
      body: 'It reads scrollTo from the route after messages render.',
      type: 'belief',
      evidenceIds: ['run'],
      edgeIds: ['e1'],
    });
    expect(object).toMatchObject({ type: 'belief', origin: 'user', reviewState: 'accepted', status: 'current', projectId: 'p1' });
    expect(object.body).toContain('Verified relationships: SearchPage → ConversationsPage (passes scrollTo)');
    expect(object.meta).toMatchObject({ workspaceId: change.id, promotedEdges: 1, promotedEvidence: 2 });
    const events = await db.understandingEvents.where('objectId').equals(object.id).toArray();
    expect(events).toHaveLength(1);
    expect(events[0].op).toBe('introduced');
    expect(events[0].evidence).toEqual([{ conversationId: 'conv-cc', messageIds: ['m9'], note: 'npm test → pass' }]);
    expect(events[0].codeEvidence?.map((e) => e.id).sort()).toEqual(['code', 'run']);
    expect(updated.promotions).toHaveLength(1);
    expect(updated.promotions?.[0]).toMatchObject({ understandingObjectId: object.id });
    expect((await promotedObjectsForWorkspace(updated)).map((o) => o.id)).toEqual([object.id]);
    expect((await getObjectsForProject('p1', 'current')).some((o) => o.id === object.id)).toBe(true);
  });

  it('refuses AI items, unverified edges, empty selections, and premature promotion', async () => {
    const change = await verifiedWorkspace();
    await expect(promoteFromWorkspace(change.id, { title: 'x', type: 'belief', evidenceIds: ['ai'] })).rejects.toThrow(/not verified evidence/);
    await expect(promoteFromWorkspace(change.id, { title: 'x', type: 'belief', evidenceIds: [], edgeIds: ['e2'] })).rejects.toThrow(/not verified/);
    await expect(promoteFromWorkspace(change.id, { title: 'x', type: 'belief', evidenceIds: [] })).rejects.toThrow(/at least one/);
    await expect(promoteFromWorkspace(change.id, { title: ' ', type: 'belief', evidenceIds: ['code'] })).rejects.toThrow(/Write the understanding/);

    await putUnderstandingProject({ id: 'p2', name: 'Other', origin: 'user', reviewState: 'accepted', createdAt: now, updatedAt: now });
    const early = await createPreparedChange({ projectId: 'p2', title: 'Early', understandingPointIds: [], intent: { currentBehavior: '', desiredBehavior: 'x', whyItMatters: '' } });
    await expect(promoteFromWorkspace(early.id, { title: 'x', type: 'belief', evidenceIds: [] })).rejects.toThrow(/unavailable/);
  });

  it('still allows promotion after close, and questions link both ways', async () => {
    let change = await verifiedWorkspace();
    change = await updateLearned(change.id, 'Scrolling belongs to ConversationsPage.');
    change = await closeWorkspace(change.id);
    const { object } = await promoteFromWorkspace(change.id, { title: 'Late promotion', type: 'decision', evidenceIds: ['code'] });
    expect(object.type).toBe('decision');

    await expect(createWorkspaceQuestion(change.id, { title: 'closed?' })).rejects.toThrow(/frozen/);
    const open = await verifiedWorkspace();
    const { change: withQ, question } = await createWorkspaceQuestion(open.id, { title: 'What if the target message was deleted?', body: 'Nothing scrolls today.' });
    expect(question).toMatchObject({ type: 'question', origin: 'user', reviewState: 'accepted', meta: { workspaceId: open.id } });
    expect(withQ.questionIds).toEqual([question.id]);
    expect((await questionsForWorkspace(withQ)).map((q) => q.title)).toEqual(['What if the target message was deleted?']);
    expect((await getUnderstandingObject(question.id))?.body).toBe('Nothing scrolls today.');
  });

  it('maps evidence to conversation refs without duplicates', () => {
    expect(evidenceRefsFrom([evidence[2], evidence[2], evidence[1], evidence[0]])).toEqual([
      { conversationId: 'conv-1', messageIds: ['m1'] },
      { conversationId: 'conv-cc', messageIds: ['m9'], note: 'npm test → pass' },
    ]);
  });
});

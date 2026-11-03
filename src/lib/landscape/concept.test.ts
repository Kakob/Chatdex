// Editable landscape: "Discuss with AI" sends a bounded, scoped packet, and
// proposals from a concept discussion land pending behind review.
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../providers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../providers')>();
  return { ...actual, complete: vi.fn() };
});

import { complete } from '../providers';
import { db } from '../db/schema';
import { clearAllData } from '../db/index';
import { createHumanProject, createUnderstandingObject, setEventReviewState, setObjectReviewState } from '../db/understanding';
import { addConceptStatement, createRegion, setMembership } from '../db/landscape';
import { createChat, appendChatMessage } from '../chat/chats';
import { loadLandscape } from './load';
import { buildConceptContext, groupStatements, supportOf } from './concept';
import { parseProposalResponse, proposeConceptUpdates } from './proposals';
import { UNCATEGORIZED_ID } from './projection';

const completeMock = vi.mocked(complete);

beforeEach(async () => {
  await clearAllData();
  completeMock.mockReset();
});

async function atlas() {
  const p = await createHumanProject({ name: 'Atlas Maps' });
  const other = await createHumanProject({ name: 'Other project' });
  const map = await createRegion({ projectId: p.id, title: 'Map', summary: 'The base map' });
  const interactions = await createRegion({ projectId: p.id, title: 'Map interactions', parentRegionId: map.id });
  const drag = await createRegion({ projectId: p.id, title: 'Box zoom', parentRegionId: interactions.id, body: 'Select an area by dragging a box.' });
  await createRegion({ projectId: p.id, title: 'Distance ruler', parentRegionId: interactions.id });
  await createRegion({ projectId: p.id, title: 'Release animation', parentRegionId: drag.id });
  const mapRule = await addConceptStatement(map.id, { type: 'decision', title: 'Maps use metric units by default' });
  const behavior = await addConceptStatement(drag.id, { type: 'behavior', title: 'Dragging a box zooms to the selected area' });
  const question = await addConceptStatement(drag.id, { type: 'question', title: 'Does box zoom conflict with the distance ruler?' });
  // A pending AI proposal and a record of another project must not be sent.
  const pending = await createUnderstandingObject({ projectId: p.id, type: 'belief', title: 'PENDING-AI-TEXT', origin: 'ai', evidence: [{ conversationId: 'c-secret' }], occurredAt: new Date() });
  await setMembership(drag.id, pending.id, true);
  const rejected = await addConceptStatement(drag.id, { type: 'belief', title: 'REJECTED-TEXT' });
  await setObjectReviewState(rejected.id, 'rejected');
  await createUnderstandingObject({ projectId: other.id, type: 'decision', title: 'OTHER-PROJECT-TEXT', origin: 'user', evidence: [], occurredAt: new Date() });
  // Accepted evidence-backed record placed here: the conversation is named, not quoted.
  await db.conversations.put({ id: 'conv-1', source: 'claude-ai', name: 'Zoom design chat', summary: null, createdAt: new Date(), updatedAt: new Date(), importedAt: new Date(), messageCount: 1, userMessageCount: 1, assistantMessageCount: 0, estimatedTokens: 5, fullText: 'CONVERSATION-BODY-TEXT' } as never);
  const backed = await createUnderstandingObject({ projectId: p.id, type: 'belief', title: 'Users zoom mostly to city level', origin: 'ai', evidence: [{ conversationId: 'conv-1' }], occurredAt: new Date() });
  await setObjectReviewState(backed.id, 'accepted');
  await setMembership(drag.id, backed.id, true);
  return { p, other, map, interactions, drag, mapRule, behavior, question, pending, backed };
}

describe('concept context packet', () => {
  it('contains the concept, its ancestors, children, and accepted statements only', async () => {
    const s = await atlas();
    const { landscape } = await loadLandscape();
    const ctx = buildConceptContext(landscape, s.p.id, s.drag.id)!;
    expect(ctx.path).toEqual(['Atlas Maps', 'Map', 'Map interactions', 'Box zoom']);
    expect(ctx.document).toContain('Select an area by dragging a box.');
    expect(ctx.document).toContain('Dragging a box zooms to the selected area');
    expect(ctx.document).toContain('Does box zoom conflict with the distance ruler?');
    expect(ctx.document).toContain('Release animation'); // sub-concept
    expect(ctx.document).toContain('Maps use metric units by default'); // ancestor statement
    expect(ctx.document).toContain('Zoom design chat'); // evidence title
    for (const leaked of ['PENDING-AI-TEXT', 'REJECTED-TEXT', 'OTHER-PROJECT-TEXT', 'CONVERSATION-BODY-TEXT', 'c-secret']) {
      expect(ctx.systemPrompt).not.toContain(leaked);
    }
    expect(ctx.objectIds.sort()).toEqual([s.mapRule.id, s.behavior.id, s.question.id, s.backed.id].sort());
    expect(ctx.systemPrompt).toContain('does not mean it is implemented');
  });

  it('stays inside its budget and refuses foreign or virtual concepts', async () => {
    const s = await atlas();
    for (let i = 0; i < 60; i++) await addConceptStatement(s.drag.id, { type: 'belief', title: `Observation ${i} `.padEnd(200, 'x') });
    const { landscape } = await loadLandscape();
    const ctx = buildConceptContext(landscape, s.p.id, s.drag.id, { maxContextTokens: 1500 })!;
    expect(ctx.truncated).toBe(true);
    expect(ctx.estimatedTokens).toBeLessThanOrEqual(1500);
    expect(buildConceptContext(landscape, s.other.id, s.drag.id)).toBeNull();
    expect(buildConceptContext(landscape, s.p.id, UNCATEGORIZED_ID)).toBeNull();
    expect(buildConceptContext(landscape, s.p.id, 'nope')).toBeNull();
  });

  it('labels support honestly and groups statements by kind', async () => {
    const s = await atlas();
    const { landscape } = await loadLandscape();
    expect(supportOf(landscape.findings.get(s.behavior.id)!).label).toBe('Your statement · unverified');
    expect(supportOf(landscape.findings.get(s.pending.id)!).level).toBe('proposed');
    expect(supportOf(landscape.findings.get(s.backed.id)!).level).toBe('reviewed-evidence');
    const groups = groupStatements(landscape.regions.get(s.drag.id)!.directIds.map((id) => landscape.findings.get(id)!));
    const byLabel = new Map([...groups].map(([sec, list]) => [sec.label, list.map((f) => f.object.title)]));
    expect(byLabel.get('Intended behavior')).toEqual(['Dragging a box zooms to the selected area']);
    expect(byLabel.get('Open questions')).toEqual(['Does box zoom conflict with the distance ruler?']);
  });
});

describe('proposals from a concept discussion', () => {
  it('parses only known records, supported types, and real message indexes', () => {
    const parsed = parseProposalResponse(
      '```json\n' +
        JSON.stringify({
          changes: [
            { op: 'add', type: 'behavior', title: 'Release applies zoom', body: '', messageIndexes: [1, 99] },
            { op: 'add', type: 'intent', title: 'not allowed' },
            { op: 'revise', objectId: 'known', title: 'New wording', messageIndexes: [0] },
            { op: 'revise', objectId: 'unknown', title: 'x' },
            { op: 'delete', objectId: 'known', title: 'x' },
            { op: 'add', type: 'belief', title: '' },
          ],
        }) +
        '\n```',
      new Set(['known']),
      new Set([0, 1])
    );
    expect(parsed.changes).toEqual([
      { op: 'add', type: 'behavior', title: 'Release applies zoom', body: undefined, messageIndexes: [1] },
      { op: 'revise', objectId: 'known', title: 'New wording', body: undefined, detail: undefined, messageIndexes: [0] },
    ]);
    expect(parsed.warnings).toHaveLength(4);
    expect(() => parseProposalResponse('not json', new Set(), new Set())).toThrow(/valid JSON/);
  });

  it('writes pending, chat-cited proposals into the concept; accepted understanding changes only on review', async () => {
    const s = await atlas();
    const chat = await createChat({ provider: 'anthropic', projectId: s.p.id, conceptId: s.drag.id, firstUserMessage: 'How should box zoom work alongside the distance ruler?' });
    await appendChatMessage(chat.id, { sender: 'assistant', text: 'Hold Shift to measure; plain drag zooms.' });
    await appendChatMessage(chat.id, { sender: 'user', text: 'Yes — plain drag zooms, Shift-drag measures.' });
    completeMock.mockResolvedValue({
      model: 'test',
      text: JSON.stringify({
        changes: [
          { op: 'add', type: 'decision', title: 'Shift-drag measures; plain drag zooms', body: 'Agreed in discussion.', messageIndexes: [2] },
          { op: 'revise', objectId: s.behavior.id, title: 'Plain drag zooms to the selected area', body: '', detail: 'Clarified modifier', messageIndexes: [1, 2] },
          { op: 'revise', objectId: s.pending.id, title: 'cannot revise pending' },
        ],
      }),
    });

    const result = await proposeConceptUpdates(chat.id, s.p.id, s.drag.id, { provider: 'anthropic' });
    expect(result).toMatchObject({ added: 1, revised: 1 });
    // What was sent: the concept packet and this chat only.
    const sent = completeMock.mock.calls[0][1].messages;
    expect(sent[0].content).toContain('Box zoom');
    expect(sent[0].content).not.toContain('PENDING-AI-TEXT');
    expect(JSON.parse(sent[1].content).discussion).toHaveLength(3);

    const region = (await db.landscapeRegions.get(s.drag.id))!;
    const added = (await db.understandingObjects.toArray()).find((o) => o.title === 'Shift-drag measures; plain drag zooms')!;
    expect(added).toMatchObject({ origin: 'ai', reviewState: 'pending', projectId: s.p.id });
    expect(region.memberObjectIds).toContain(added.id);
    const introduced = (await db.understandingEvents.where('objectId').equals(added.id).toArray())[0];
    expect(introduced.evidence[0].conversationId).toBe(chat.id);
    expect(introduced.evidence[0].messageIds).toHaveLength(1);

    // The accepted statement keeps its wording until the rewording is reviewed.
    expect((await db.understandingObjects.get(s.behavior.id))!.title).toBe('Dragging a box zooms to the selected area');
    const proposal = (await db.understandingEvents.where('objectId').equals(s.behavior.id).toArray()).find((e) => e.op === 'refined')!;
    expect(proposal).toMatchObject({ origin: 'ai', reviewState: 'pending', revision: { previousTitle: 'Dragging a box zooms to the selected area' } });
    await setEventReviewState(proposal.id, 'accepted');
    expect((await db.understandingObjects.get(s.behavior.id))!.title).toBe('Plain drag zooms to the selected area');
  });
});

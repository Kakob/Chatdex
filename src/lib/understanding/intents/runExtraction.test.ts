import { describe, it, expect, beforeEach, vi } from 'vitest';
import { clearAllData } from '../../db';
import { db } from '../../db/schema';
import { bulkPutMessages } from '../../db/messages';
import { putUnderstandingProject, putProjectAssociation, getUnderstandingProject, getObjectsForProject } from '../../db/understanding';
import { getIntentExtractableConversations, runIntentExtraction, packPairBatches } from './runExtraction';
import type { IntentPair } from './pairs';
import type { StoredConversation, StoredMessage } from '../../../types';

vi.mock('../../providers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../providers')>();
  return { ...actual, complete: vi.fn() };
});
import { complete } from '../../providers';
const completeMock = vi.mocked(complete);

beforeEach(async () => {
  await clearAllData();
  completeMock.mockReset();
  await putUnderstandingProject({
    id: 'proj-1',
    name: 'Chatdex',
    origin: 'user',
    reviewState: 'accepted',
    createdAt: new Date('2026-08-01T00:00:00Z'),
    updatedAt: new Date('2026-08-01T00:00:00Z'),
  });
});

async function seedConversation(id: string, updatedAt: Date, turns: Array<[StoredMessage['sender'], string]>, reviewState: 'accepted' | 'rejected' = 'accepted') {
  const conv: StoredConversation = {
    id,
    source: 'claude.ai',
    name: id,
    summary: null,
    createdAt: updatedAt,
    updatedAt,
    importedAt: updatedAt,
    messageCount: turns.length,
    userMessageCount: 0,
    assistantMessageCount: 0,
    estimatedTokens: 0,
    fullText: '',
  };
  await db.conversations.put(conv);
  await bulkPutMessages(
    turns.map(([sender, text], i) => ({
      id: `${id}-m${i}`,
      conversationId: id,
      sender,
      text,
      createdAt: new Date(updatedAt.getTime() - (turns.length - i) * 1000),
    }))
  );
  await putProjectAssociation({
    id: `assoc-${id}`,
    projectId: 'proj-1',
    conversationId: id,
    confidence: 1,
    origin: 'user',
    reviewState,
    createdAt: updatedAt,
    updatedAt,
  });
  return conv;
}

const emptyResponse = { text: JSON.stringify({ intents: [] }), model: 'test-model' };

describe('getIntentExtractableConversations', () => {
  it('returns non-rejected associations newer than the cursor, chronological', async () => {
    await seedConversation('old', new Date('2026-08-10T00:00:00Z'), [['user', 'I want x']]);
    await seedConversation('new', new Date('2026-08-20T00:00:00Z'), [['user', 'I want y']]);
    await seedConversation('newer', new Date('2026-08-25T00:00:00Z'), [['user', 'I want z']]);
    await seedConversation('rejected', new Date('2026-08-26T00:00:00Z'), [['user', 'I want w']], 'rejected');
    await putUnderstandingProject({ ...(await getUnderstandingProject('proj-1'))!, lastIntentExtractedAt: new Date('2026-08-15T00:00:00Z') });

    expect((await getIntentExtractableConversations('proj-1')).map((c) => c.id)).toEqual(['new', 'newer']);
    expect((await getIntentExtractableConversations('proj-1', true)).map((c) => c.id)).toEqual(['old', 'new', 'newer']);
    expect((await getIntentExtractableConversations('proj-1', false, ['old'])).map((c) => c.id)).toEqual(['old']);
  });

  it('throws for an unknown project', async () => {
    await expect(getIntentExtractableConversations('nope')).rejects.toThrow(/not found/);
  });
});

describe('packPairBatches', () => {
  const p = (replyI: number): IntentPair => ({ conversationId: 'c', promptI: null, replyI, promptText: '', replyText: 'I want', promptedByQuestion: false });
  const conv = { id: 'c' } as StoredConversation;

  it('splits a long conversation across calls and fills calls across conversations', () => {
    const batches = packPairBatches(
      [
        { conv, pairs: [p(0), p(1), p(2)] },
        { conv: { ...conv, id: 'd' }, pairs: [p(0)] },
      ],
      2
    );
    expect(batches.map((b) => b.map((x) => `${x.conv.id}:${x.pairs.length}`))).toEqual([['c:2'], ['c:1', 'd:1']]);
  });
});

describe('runIntentExtraction', () => {
  it('sends heuristic-kept pairs, persists intents, and advances the cursor on full success', async () => {
    await seedConversation('c1', new Date('2026-08-20T00:00:00Z'), [
      ['user', 'I want a badge on the sidebar'],
      ['assistant', 'Amber or violet?'],
      ['user', 'amber'],
      ['user', 'thanks that all makes sense to me now and it is clear and there is nothing more to say about it really so moving on to unrelated matters entirely how has the weather been over there lately because here it has been raining for weeks and the forecast says more rain which nobody wants and that is the situation over here tonight and that is all there is to say ok bye'],
    ]);
    completeMock.mockResolvedValue({
      text: JSON.stringify({
        intents: [{ title: 'Sidebar badge', statement: 'I want a badge on the sidebar', polarity: 'want', origin: 'unprompted', conversationId: 'c1', statedIn: 0, confidence: 0.9 }],
      }),
      model: 'test-model',
    });
    const progress: Array<[number, number]> = [];
    const outcome = await runIntentExtraction('proj-1', { provider: 'anthropic' }, { onProgress: (d, t) => progress.push([d, t]) });

    expect(outcome).toMatchObject({ conversationsProcessed: 1, batchesRun: 1, batchesTotal: 1, intentsCreated: 1, pairsConsidered: 3, pairsSent: 2, warnings: [] });
    expect(progress).toEqual([[0, 1], [1, 1]]);
    const objects = await getObjectsForProject('proj-1');
    expect(objects).toHaveLength(1);
    expect(objects[0].meta?.origin).toBe('unprompted');
    expect((await getUnderstandingProject('proj-1'))?.lastIntentExtractedAt).toEqual(new Date('2026-08-20T00:00:00Z'));

    // The long pattern-free reply was filtered out before the call.
    const body = JSON.parse(completeMock.mock.calls[0][1].messages[1].content);
    expect(body.conversations[0].pairs.map((p: { replyI: number }) => p.replyI)).toEqual([0, 2]);
  });

  it('a second run sends nothing (cursor); ignoreCursor re-sends; heuristic off sends every pair', async () => {
    await seedConversation('c1', new Date('2026-08-20T00:00:00Z'), [
      ['user', 'I want a badge'],
      ['assistant', 'Where?'],
      ['user', 'sidebar'],
    ]);
    completeMock.mockResolvedValue(emptyResponse);
    await runIntentExtraction('proj-1', { provider: 'anthropic' });
    expect(completeMock).toHaveBeenCalledTimes(1);

    const again = await runIntentExtraction('proj-1', { provider: 'anthropic' });
    expect(again.batchesTotal).toBe(0);
    expect(completeMock).toHaveBeenCalledTimes(1);

    const full = await runIntentExtraction('proj-1', { provider: 'anthropic', ignoreCursor: true, heuristic: { mode: 'off' } });
    expect(full.pairsSent).toBe(2);
    expect(completeMock).toHaveBeenCalledTimes(2);
  });

  it('scoped runs never advance the cursor', async () => {
    await seedConversation('c1', new Date('2026-08-20T00:00:00Z'), [['user', 'I want a badge']]);
    completeMock.mockResolvedValue(emptyResponse);
    await runIntentExtraction('proj-1', { provider: 'anthropic', conversationIds: ['c1'] });
    expect((await getUnderstandingProject('proj-1'))?.lastIntentExtractedAt).toBeUndefined();
  });

  it('stops at the first failing batch, keeps earlier writes, and leaves the cursor alone', async () => {
    await seedConversation('c1', new Date('2026-08-20T00:00:00Z'), [['user', 'I want a badge']]);
    await seedConversation('c2', new Date('2026-08-21T00:00:00Z'), [['user', 'I want a filter']]);
    completeMock
      .mockResolvedValueOnce({
        text: JSON.stringify({ intents: [{ title: 'Badge', statement: 'I want a badge', polarity: 'want', origin: 'unprompted', conversationId: 'c1', statedIn: 0 }] }),
        model: 'test-model',
      })
      .mockRejectedValueOnce(new Error('relay down'));
    const outcome = await runIntentExtraction('proj-1', { provider: 'anthropic', maxPairsPerCall: 1 });
    expect(outcome.batchesTotal).toBe(2);
    expect(outcome.batchesRun).toBe(1);
    expect(outcome.intentsCreated).toBe(1);
    expect(outcome.warnings[0]).toMatch(/Stopped after batch 1 of 2: relay down/);
    expect(await getObjectsForProject('proj-1')).toHaveLength(1);
    expect((await getUnderstandingProject('proj-1'))?.lastIntentExtractedAt).toBeUndefined();
  });
});

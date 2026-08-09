import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '../db/schema';
import { clearAllData } from '../db';
import {
  buildReconcileMessages,
  getReconcilableConversations,
  parseReconcileResponse,
  reconcileProject,
} from './reconcile';
import { bulkPutMessages } from '../db/messages';
import {
  putUnderstandingProject,
  putProjectAssociation,
  createUnderstandingObject,
  getUnderstandingProject,
  getObjectsForProject,
  getEventsForObject,
  setEventReviewState,
} from '../db/understanding';
import type { StoredConversation, StoredMessage } from '../../types';
import type { UnderstandingObject } from '../../types/understanding';

vi.mock('../providers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../providers')>();
  return { ...actual, complete: vi.fn() };
});

import { complete } from '../providers';
const completeMock = vi.mocked(complete);

beforeEach(async () => {
  await clearAllData();
  completeMock.mockReset();
});

function makeConversation(overrides: Partial<StoredConversation> = {}): StoredConversation {
  const now = new Date('2026-08-01T00:00:00Z');
  return {
    id: crypto.randomUUID(),
    source: 'claude.ai',
    name: 'Test conversation',
    summary: null,
    createdAt: now,
    updatedAt: now,
    importedAt: now,
    messageCount: 1,
    userMessageCount: 1,
    assistantMessageCount: 0,
    estimatedTokens: 100,
    fullText: 'Some conversation text',
    ...overrides,
  };
}

function makeMessage(conversationId: string, text: string, createdAt: Date): StoredMessage {
  return { id: crypto.randomUUID(), conversationId, sender: 'user', text, createdAt };
}

async function seedProject(id = 'proj-1'): Promise<void> {
  const now = new Date('2026-07-01T00:00:00Z');
  await putUnderstandingProject({
    id,
    name: 'Chatdex',
    description: 'AI conversation workspace',
    origin: 'user',
    reviewState: 'accepted',
    createdAt: now,
    updatedAt: now,
  });
}

async function associate(projectId: string, conversationId: string): Promise<void> {
  const now = new Date('2026-07-01T00:00:00Z');
  await putProjectAssociation({
    id: crypto.randomUUID(),
    projectId,
    conversationId,
    confidence: 1,
    origin: 'user',
    reviewState: 'accepted',
    createdAt: now,
    updatedAt: now,
  });
}

function makeObject(overrides: Partial<UnderstandingObject> = {}): UnderstandingObject {
  const now = new Date('2026-07-01T00:00:00Z');
  return {
    id: crypto.randomUUID(),
    projectId: 'proj-1',
    type: 'direction',
    title: 'Old direction',
    status: 'current',
    origin: 'ai',
    reviewState: 'accepted',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function respond(payload: unknown): void {
  completeMock.mockResolvedValue({ text: JSON.stringify(payload), model: 'test-model' });
}

describe('buildReconcileMessages', () => {
  it('presents current objects with ids and embeds digests', () => {
    const obj = makeObject({ id: 'obj-1', title: 'Client-side only', status: 'current' });
    const messages = buildReconcileMessages(
      { name: 'Chatdex' },
      [obj],
      [{ id: 'c1', source: 'claude.ai', name: 'Conv', updatedAt: 'x', excerpt: 'text' }],
      5
    );
    expect(messages[0].content).toContain('"id":"obj-1"');
    expect(messages[0].content).toContain('Client-side only');
    expect(messages[0].content).toContain('At most 5 changes');
    expect(JSON.parse(messages[1].content).conversations[0].id).toBe('c1');
  });
});

describe('parseReconcileResponse', () => {
  const knownConvs = new Set(['c1']);
  const knownIdx = new Map([['c1', new Set([0, 1])]]);
  const knownObjs = new Set(['obj-1']);

  it('accepts introduces and event ops; drops unknown ops', () => {
    const parsed = parseReconcileResponse(
      JSON.stringify({
        changes: [
          {
            op: 'introduce',
            ref: 'n1',
            type: 'Direction',
            title: 'New way',
            evidence: [{ conversationId: 'c1', messageIndexes: [0] }],
          },
          {
            op: 'supersede',
            objectId: 'obj-1',
            supersededBy: 'n1',
            detail: 'replaced',
            evidence: [{ conversationId: 'c1', messageIndexes: [1] }],
          },
          { op: 'delete', objectId: 'obj-1', evidence: [{ conversationId: 'c1' }] },
        ],
      }),
      knownConvs,
      knownIdx,
      knownObjs
    );
    expect(parsed.changes).toHaveLength(2);
    expect(parsed.changes[0]).toMatchObject({ op: 'introduce', ref: 'n1', type: 'direction' });
    expect(parsed.changes[1]).toMatchObject({ op: 'supersede', supersededBy: 'n1' });
    expect(parsed.warnings).toContain('Dropped change with unknown op "delete"');
  });

  it('drops event ops targeting unknown objects (hallucination guard)', () => {
    const parsed = parseReconcileResponse(
      JSON.stringify({
        changes: [
          {
            op: 'support',
            objectId: 'invented',
            evidence: [{ conversationId: 'c1', messageIndexes: [] }],
          },
        ],
      }),
      knownConvs,
      knownIdx,
      knownObjs
    );
    expect(parsed.changes).toHaveLength(0);
    expect(parsed.warnings.some((w) => w.includes('unknown object invented'))).toBe(true);
  });

  it('drops changes with no valid evidence and validates message indexes', () => {
    const parsed = parseReconcileResponse(
      JSON.stringify({
        changes: [
          { op: 'refine', objectId: 'obj-1', evidence: [{ conversationId: 'fake' }] },
          {
            op: 'refine',
            objectId: 'obj-1',
            evidence: [{ conversationId: 'c1', messageIndexes: [1, 99] }],
          },
        ],
      }),
      knownConvs,
      knownIdx,
      knownObjs
    );
    expect(parsed.changes).toHaveLength(1);
    expect((parsed.changes[0] as { evidence: unknown[] }).evidence).toEqual([
      { conversationId: 'c1', messageIndexes: [1] },
    ]);
    expect(parsed.warnings.some((w) => w.includes('no valid evidence'))).toBe(true);
    expect(parsed.warnings.some((w) => w.includes('invented message indexes'))).toBe(true);
  });

  it('caps changes at maxChanges with a warning', () => {
    const changes = Array.from({ length: 4 }, () => ({
      op: 'support',
      objectId: 'obj-1',
      evidence: [{ conversationId: 'c1', messageIndexes: [] }],
    }));
    const parsed = parseReconcileResponse(
      JSON.stringify({ changes }),
      knownConvs,
      knownIdx,
      knownObjs,
      2
    );
    expect(parsed.changes).toHaveLength(2);
    expect(parsed.warnings.some((w) => w.includes('keeping the first 2'))).toBe(true);
  });

  it('throws on non-JSON', () => {
    expect(() =>
      parseReconcileResponse('nope', knownConvs, knownIdx, knownObjs)
    ).toThrow(/not valid JSON/);
  });
});

describe('reconcileProject', () => {
  it('throws for an unknown project', async () => {
    await expect(reconcileProject('nope', { provider: 'anthropic' })).rejects.toThrow(
      /not found/
    );
  });

  it('returns an empty result when no conversations are newer than the cursor', async () => {
    await seedProject();
    const conv = makeConversation({ updatedAt: new Date('2026-08-01T00:00:00Z') });
    await db.conversations.put(conv);
    await associate('proj-1', conv.id);
    const project = await getUnderstandingProject('proj-1');
    await putUnderstandingProject({
      ...project!,
      lastReconciledAt: new Date('2026-08-02T00:00:00Z'),
    });

    const result = await reconcileProject('proj-1', { provider: 'anthropic' });
    expect(result.conversationsProcessed).toBe(0);
    expect(completeMock).not.toHaveBeenCalled();
  });

  it('ignoreCursor processes everything for a full re-run', async () => {
    await seedProject();
    const conv = makeConversation({ updatedAt: new Date('2026-08-01T00:00:00Z') });
    await db.conversations.put(conv);
    await associate('proj-1', conv.id);
    const project = await getUnderstandingProject('proj-1');
    await putUnderstandingProject({
      ...project!,
      lastReconciledAt: new Date('2026-08-02T00:00:00Z'),
    });
    respond({ changes: [] });

    const result = await reconcileProject('proj-1', {
      provider: 'anthropic',
      ignoreCursor: true,
    });
    expect(result.conversationsProcessed).toBe(1);
  });

  it('golden scenario: supersession links old direction to introduced replacement, all pending', async () => {
    await seedProject();
    const old = await createUnderstandingObject({
      projectId: 'proj-1',
      type: 'direction',
      title: 'Chatdex is client-side only',
      origin: 'user',
      evidence: [],
      occurredAt: new Date('2026-06-01T00:00:00Z'),
    });
    const conv = makeConversation({
      name: 'Pivot discussion',
      updatedAt: new Date('2026-08-05T00:00:00Z'),
    });
    await db.conversations.put(conv);
    await associate('proj-1', conv.id);
    const msgs = [
      makeMessage(conv.id, 'we should allow provider synthesis', new Date('2026-08-05T00:00:00Z')),
      makeMessage(conv.id, 'agreed, amend the invariant', new Date('2026-08-05T00:01:00Z')),
    ];
    await bulkPutMessages(msgs);

    respond({
      changes: [
        {
          op: 'introduce',
          ref: 'n1',
          type: 'direction',
          title: 'Robust LLM-provider interactions',
          body: 'Synthesis may call user-authed providers',
          evidence: [{ conversationId: conv.id, messageIndexes: [0, 1] }],
        },
        {
          op: 'supersede',
          objectId: old.id,
          supersededBy: 'n1',
          detail: 'Direction changed away from client-side only',
          evidence: [{ conversationId: conv.id, messageIndexes: [1] }],
        },
      ],
    });

    const result = await reconcileProject('proj-1', { provider: 'anthropic' });
    expect(result).toMatchObject({
      conversationsProcessed: 1,
      batches: 1,
      objectsIntroduced: 1,
      eventsProposed: 1,
      warnings: [],
    });

    const objects = await getObjectsForProject('proj-1');
    const introduced = objects.find((o) => o.title === 'Robust LLM-provider interactions')!;
    expect(introduced).toMatchObject({
      projectId: 'proj-1',
      origin: 'ai',
      reviewState: 'pending',
      status: 'current',
    });

    // The gate: old direction is untouched until the event is accepted.
    const oldRow = objects.find((o) => o.id === old.id)!;
    expect(oldRow.status).toBe('current');

    const events = await getEventsForObject(old.id);
    const superseded = events.find((e) => e.op === 'superseded')!;
    expect(superseded).toMatchObject({
      reviewState: 'pending',
      origin: 'ai',
      supersededByObjectId: introduced.id,
    });
    expect(superseded.evidence).toEqual([
      { conversationId: conv.id, messageIds: [msgs[1].id] },
    ]);

    await setEventReviewState(superseded.id, 'accepted');
    expect((await getObjectsForProject('proj-1')).find((o) => o.id === old.id)?.status).toBe(
      'superseded'
    );

    // Cursor advanced to the processed conversation's updatedAt.
    const after = await getUnderstandingProject('proj-1');
    expect(after?.lastReconciledAt?.getTime()).toBe(conv.updatedAt.getTime());
  });

  it('processes batches chronologically and presents earlier introductions to later batches', async () => {
    await seedProject();
    const older = makeConversation({ name: 'Older', updatedAt: new Date('2026-08-01T00:00:00Z') });
    const newer = makeConversation({ name: 'Newer', updatedAt: new Date('2026-08-06T00:00:00Z') });
    await db.conversations.bulkPut([older, newer]);
    await associate('proj-1', older.id);
    await associate('proj-1', newer.id);

    completeMock.mockResolvedValueOnce({
      text: JSON.stringify({
        changes: [
          {
            op: 'introduce',
            ref: 'n1',
            type: 'idea',
            title: 'From batch one',
            evidence: [{ conversationId: older.id, messageIndexes: [] }],
          },
        ],
      }),
      model: 'test-model',
    });
    completeMock.mockResolvedValueOnce({
      text: JSON.stringify({ changes: [] }),
      model: 'test-model',
    });

    const result = await reconcileProject('proj-1', { provider: 'anthropic', batchSize: 1 });
    expect(result.batches).toBe(2);

    // Batch order is chronological.
    const firstPayload = JSON.parse(completeMock.mock.calls[0][1].messages[1].content);
    expect(firstPayload.conversations[0].id).toBe(older.id);

    // Batch 2's system prompt presents the object introduced in batch 1.
    const secondSystem = completeMock.mock.calls[1][1].messages[0].content;
    expect(secondSystem).toContain('From batch one');
  });

  it('drops an unresolvable supersededBy but keeps the event', async () => {
    await seedProject();
    const obj = await createUnderstandingObject({
      projectId: 'proj-1',
      type: 'direction',
      title: 'Old',
      origin: 'user',
      evidence: [],
      occurredAt: new Date('2026-06-01T00:00:00Z'),
    });
    const conv = makeConversation({ updatedAt: new Date('2026-08-05T00:00:00Z') });
    await db.conversations.put(conv);
    await associate('proj-1', conv.id);

    respond({
      changes: [
        {
          op: 'supersede',
          objectId: obj.id,
          supersededBy: 'n9',
          evidence: [{ conversationId: conv.id, messageIndexes: [] }],
        },
      ],
    });

    const result = await reconcileProject('proj-1', { provider: 'anthropic' });
    expect(result.eventsProposed).toBe(1);
    expect(result.warnings.some((w) => w.includes('unresolvable supersededBy'))).toBe(true);
    const events = await getEventsForObject(obj.id);
    expect(events.find((e) => e.op === 'superseded')?.supersededByObjectId).toBeUndefined();
  });
});

describe('scoped reconciliation (U6.1)', () => {
  function makeChat(overrides: Partial<StoredConversation> = {}): StoredConversation {
    return makeConversation({
      source: 'chatdex',
      providerMeta: { provider: 'anthropic' },
      ...overrides,
    });
  }

  it('conversationIds scopes selection and ignores the project cursor', async () => {
    await seedProject();
    const chat = makeChat({ updatedAt: new Date('2026-08-01T00:00:00Z') });
    const other = makeConversation({ updatedAt: new Date('2026-08-03T00:00:00Z') });
    await db.conversations.bulkPut([chat, other]);
    await associate('proj-1', chat.id);
    await associate('proj-1', other.id);
    // Cursor already past the chat — scoped selection must still include it.
    const project = await getUnderstandingProject('proj-1');
    await putUnderstandingProject({
      ...project!,
      lastReconciledAt: new Date('2026-08-02T00:00:00Z'),
    });

    const scoped = await getReconcilableConversations('proj-1', false, [chat.id]);
    expect(scoped.map((c) => c.id)).toEqual([chat.id]);
  });

  it('scoped selection excludes unassociated conversations', async () => {
    await seedProject();
    const stranger = makeChat();
    await db.conversations.put(stranger);
    expect(await getReconcilableConversations('proj-1', false, [stranger.id])).toEqual([]);
  });

  it('scoped run stamps the chat and leaves the project cursor alone', async () => {
    await seedProject();
    const chat = makeChat({ updatedAt: new Date('2026-08-01T00:00:00Z') });
    await db.conversations.put(chat);
    await associate('proj-1', chat.id);
    respond({ changes: [] });

    const result = await reconcileProject('proj-1', {
      provider: 'anthropic',
      conversationIds: [chat.id],
    });
    expect(result.conversationsProcessed).toBe(1);

    const project = await getUnderstandingProject('proj-1');
    expect(project!.lastReconciledAt).toBeUndefined();

    const stored = await db.conversations.get(chat.id);
    expect((stored!.providerMeta as { reconciledAt?: string }).reconciledAt).toBe(
      chat.updatedAt.toISOString()
    );
  });

  it('a stamped, unchanged chat is skipped by scoped and normal runs alike', async () => {
    await seedProject();
    const chat = makeChat({
      updatedAt: new Date('2026-08-01T00:00:00Z'),
      providerMeta: { provider: 'anthropic', reconciledAt: '2026-08-01T00:00:00.000Z' },
    });
    await db.conversations.put(chat);
    await associate('proj-1', chat.id);

    expect(await getReconcilableConversations('proj-1', false, [chat.id])).toEqual([]);
    expect(await getReconcilableConversations('proj-1', false)).toEqual([]);
    // Full re-run is the escape hatch and still includes it.
    expect((await getReconcilableConversations('proj-1', true)).map((c) => c.id)).toEqual([
      chat.id,
    ]);
  });

  it('a chat that changed after its stamp is reconcilable again', async () => {
    await seedProject();
    const chat = makeChat({
      updatedAt: new Date('2026-08-02T00:00:00Z'),
      providerMeta: { provider: 'anthropic', reconciledAt: '2026-08-01T00:00:00.000Z' },
    });
    await db.conversations.put(chat);
    await associate('proj-1', chat.id);

    expect(
      (await getReconcilableConversations('proj-1', false, [chat.id])).map((c) => c.id)
    ).toEqual([chat.id]);
  });

  it('normal runs also stamp processed chats', async () => {
    await seedProject();
    const chat = makeChat({ updatedAt: new Date('2026-08-01T00:00:00Z') });
    await db.conversations.put(chat);
    await associate('proj-1', chat.id);
    respond({ changes: [] });

    await reconcileProject('proj-1', { provider: 'anthropic' });

    const stored = await db.conversations.get(chat.id);
    expect((stored!.providerMeta as { reconciledAt?: string }).reconciledAt).toBe(
      chat.updatedAt.toISOString()
    );
    // Cursor advanced too — this was an unscoped run.
    const project = await getUnderstandingProject('proj-1');
    expect(project!.lastReconciledAt).toEqual(chat.updatedAt);
  });
});

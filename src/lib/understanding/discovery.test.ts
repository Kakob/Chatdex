import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '../db/schema';
import { clearAllData } from '../db';
import {
  buildDigest,
  sampleDigestMessages,
  buildDiscoveryMessages,
  parseDiscoveryResponse,
  discoverProjects,
} from './discovery';
import { bulkPutMessages } from '../db/messages';
import { putUnderstandingProject } from '../db/understanding';
import { getEventsForObject } from '../db/understanding';
import type { StoredConversation, StoredMessage } from '../../types';

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
    messageCount: 2,
    userMessageCount: 1,
    assistantMessageCount: 1,
    estimatedTokens: 100,
    fullText: 'Some conversation text',
    ...overrides,
  };
}

function makeMessage(
  conversationId: string,
  text: string,
  createdAt: Date,
  overrides: Partial<StoredMessage> = {}
): StoredMessage {
  return {
    id: crypto.randomUUID(),
    conversationId,
    sender: 'user',
    text,
    createdAt,
    ...overrides,
  };
}

function respond(payload: unknown): void {
  completeMock.mockResolvedValue({
    text: JSON.stringify(payload),
    model: 'test-model',
  });
}

describe('buildDigest', () => {
  it('collapses whitespace and truncates to the excerpt length', () => {
    const conv = makeConversation({ fullText: 'a\n\n b\t\tc   d' + 'x'.repeat(1000) });
    const digest = buildDigest(conv, 10);
    expect(digest.excerpt).toBe('a b c dxxx');
    expect(digest.id).toBe(conv.id);
    expect(digest.updatedAt).toBe(conv.updatedAt.toISOString());
  });

  it('prefers per-message entries over the excerpt when messages exist', () => {
    const conv = makeConversation();
    const now = new Date('2026-08-01T00:00:00Z');
    const digest = buildDigest(conv, 600, [
      makeMessage(conv.id, 'hello\n\n world', now),
      makeMessage(conv.id, 'y'.repeat(500), now, { sender: 'assistant' }),
    ]);
    expect(digest.excerpt).toBeUndefined();
    expect(digest.messages).toEqual([
      { i: 0, role: 'user', text: 'hello world' },
      { i: 1, role: 'assistant', text: 'y'.repeat(200) },
    ]);
  });
});

describe('sampleDigestMessages', () => {
  const msgs = Array.from({ length: 10 }, (_, i) =>
    makeMessage('c', `m${i}`, new Date(2026, 0, i + 1))
  );

  it('keeps everything when under the cap', () => {
    expect(sampleDigestMessages(msgs, 12).map((s) => s.i)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
  });

  it('takes the head and tail with original indexes when over the cap', () => {
    expect(sampleDigestMessages(msgs, 5).map((s) => s.i)).toEqual([0, 1, 2, 8, 9]);
  });
});

describe('buildDiscoveryMessages', () => {
  it('lists existing project names and embeds digests as JSON', () => {
    const digest = buildDigest(makeConversation({ name: 'Conv A' }));
    const messages = buildDiscoveryMessages(
      [digest],
      [
        {
          id: 'p1',
          name: 'Chatdex',
          origin: 'user',
          reviewState: 'accepted',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      3
    );
    expect(messages).toHaveLength(2);
    expect(messages[0].content).toContain('- Chatdex');
    expect(messages[0].content).toContain('at most 3');
    expect(JSON.parse(messages[1].content).conversations[0].id).toBe(digest.id);
  });

  it('says (none yet) when no projects exist', () => {
    const messages = buildDiscoveryMessages([], []);
    expect(messages[0].content).toContain('(none yet)');
  });
});

describe('parseDiscoveryResponse', () => {
  const known = new Set(['c1', 'c2']);

  it('strips markdown fences before parsing', () => {
    const parsed = parseDiscoveryResponse(
      '```json\n{"projects":[{"name":"P","description":"d"}],"associations":[],"objects":[]}\n```',
      known
    );
    expect(parsed.projects).toEqual([{ name: 'P', description: 'd' }]);
  });

  it('throws on non-JSON responses', () => {
    expect(() => parseDiscoveryResponse('sorry, I cannot', known)).toThrow(/not valid JSON/);
  });

  it('drops nameless projects with a warning', () => {
    const parsed = parseDiscoveryResponse(
      JSON.stringify({ projects: [{ description: 'no name' }, { name: 'Ok' }] }),
      known
    );
    expect(parsed.projects).toEqual([{ name: 'Ok', description: '' }]);
    expect(parsed.warnings).toContain('Dropped project without a name');
  });

  it('drops associations citing unknown conversations (hallucination guard)', () => {
    const parsed = parseDiscoveryResponse(
      JSON.stringify({
        associations: [
          { conversationId: 'c1', projectName: 'P', confidence: 0.9, reason: 'r' },
          { conversationId: 'made-up', projectName: 'P', confidence: 0.9, reason: 'r' },
        ],
      }),
      known
    );
    expect(parsed.associations).toHaveLength(1);
    expect(parsed.associations[0].conversationId).toBe('c1');
    expect(parsed.warnings.some((w) => w.includes('made-up'))).toBe(true);
  });

  it('clamps confidence to [0,1] and defaults missing confidence to 0.5', () => {
    const parsed = parseDiscoveryResponse(
      JSON.stringify({
        associations: [
          { conversationId: 'c1', projectName: 'P', confidence: 3 },
          { conversationId: 'c2', projectName: 'P' },
        ],
      }),
      known
    );
    expect(parsed.associations[0].confidence).toBe(1);
    expect(parsed.associations[1].confidence).toBe(0.5);
  });

  it('drops objects with no valid evidence conversations (legacy conversationIds shape)', () => {
    const parsed = parseDiscoveryResponse(
      JSON.stringify({
        objects: [
          { projectName: 'P', type: 'decision', title: 'No evidence', conversationIds: [] },
          {
            projectName: 'P',
            type: 'Decision',
            title: 'Hallucinated only',
            conversationIds: ['nope'],
          },
          { projectName: null, type: 'IDEA', title: 'Good', conversationIds: ['c1', 'fake'] },
        ],
      }),
      known
    );
    expect(parsed.objects).toHaveLength(1);
    expect(parsed.objects[0]).toMatchObject({
      projectName: null,
      type: 'idea',
      title: 'Good',
      evidence: [{ conversationId: 'c1', messageIndexes: [] }],
    });
    expect(parsed.warnings.filter((w) => w.includes('no valid evidence'))).toHaveLength(2);
  });

  it('keeps digest message indexes and drops invented ones (hallucination guard)', () => {
    const parsed = parseDiscoveryResponse(
      JSON.stringify({
        objects: [
          {
            projectName: 'P',
            type: 'decision',
            title: 'Anchored',
            evidence: [
              { conversationId: 'c1', messageIndexes: [0, 7, 99] },
              { conversationId: 'c2', messageIndexes: [] },
            ],
          },
        ],
      }),
      known,
      new Map([['c1', new Set([0, 7])]])
    );
    expect(parsed.objects[0].evidence).toEqual([
      { conversationId: 'c1', messageIndexes: [0, 7] },
      { conversationId: 'c2', messageIndexes: [] },
    ]);
    expect(parsed.warnings).toContain('Dropped invented message indexes on object "Anchored"');
  });

  it('drops message indexes for conversations that had no digest messages', () => {
    const parsed = parseDiscoveryResponse(
      JSON.stringify({
        objects: [
          {
            projectName: 'P',
            type: 'idea',
            title: 'T',
            evidence: [{ conversationId: 'c1', messageIndexes: [0] }],
          },
        ],
      }),
      known
    );
    expect(parsed.objects[0].evidence).toEqual([{ conversationId: 'c1', messageIndexes: [] }]);
  });

  it('drops objects missing type or title', () => {
    const parsed = parseDiscoveryResponse(
      JSON.stringify({ objects: [{ title: 'No type', conversationIds: ['c1'] }] }),
      known
    );
    expect(parsed.objects).toHaveLength(0);
    expect(parsed.warnings).toContain('Dropped object missing type or title');
  });
});

describe('discoverProjects', () => {
  it('rejects an empty batch', async () => {
    await expect(discoverProjects([], { provider: 'anthropic' })).rejects.toThrow(
      /No conversations/
    );
  });

  it('persists proposed projects, associations, and objects as pending ai rows', async () => {
    const conv = makeConversation({ name: 'Auth design chat' });
    respond({
      projects: [{ name: 'Auth Rework', description: 'Passkey migration' }],
      associations: [
        { conversationId: conv.id, projectName: 'Auth Rework', confidence: 0.9, reason: 'topic' },
      ],
      objects: [
        {
          projectName: 'Auth Rework',
          type: 'decision',
          title: 'Use passkeys',
          body: 'Drop passwords',
          conversationIds: [conv.id],
        },
      ],
    });

    const result = await discoverProjects([conv], { provider: 'anthropic' });
    expect(result).toMatchObject({
      projectsCreated: 1,
      associationsCreated: 1,
      objectsCreated: 1,
      associationsSkipped: 0,
      warnings: [],
    });

    const projects = await db.understandingProjects.toArray();
    expect(projects).toHaveLength(1);
    expect(projects[0]).toMatchObject({
      name: 'Auth Rework',
      origin: 'ai',
      reviewState: 'pending',
    });

    const associations = await db.projectAssociations.toArray();
    expect(associations[0]).toMatchObject({
      projectId: projects[0].id,
      conversationId: conv.id,
      confidence: 0.9,
      reason: 'topic',
      origin: 'ai',
      reviewState: 'pending',
    });

    const objects = await db.understandingObjects.toArray();
    expect(objects[0]).toMatchObject({
      projectId: projects[0].id,
      type: 'decision',
      title: 'Use passkeys',
      origin: 'ai',
      reviewState: 'pending',
      status: 'current',
    });
    const events = await getEventsForObject(objects[0].id);
    expect(events).toHaveLength(1);
    expect(events[0].op).toBe('introduced');
    expect(events[0].evidence).toEqual([{ conversationId: conv.id }]);
  });

  it('matches existing projects case-insensitively instead of duplicating', async () => {
    const now = new Date();
    await putUnderstandingProject({
      id: 'existing-1',
      name: 'Chatdex',
      origin: 'user',
      reviewState: 'accepted',
      createdAt: now,
      updatedAt: now,
    });
    const conv = makeConversation();
    respond({
      projects: [{ name: 'CHATDEX', description: 'dup attempt' }],
      associations: [
        { conversationId: conv.id, projectName: 'chatdex', confidence: 0.8, reason: 'r' },
      ],
      objects: [],
    });

    const result = await discoverProjects([conv], { provider: 'anthropic' });
    expect(result.projectsCreated).toBe(0);
    expect(result.projectsMatched).toBeGreaterThan(0);
    expect(await db.understandingProjects.count()).toBe(1);
    const assoc = await db.projectAssociations.toArray();
    expect(assoc[0].projectId).toBe('existing-1');
  });

  it('skips associations that already exist for the same project+conversation', async () => {
    const conv = makeConversation();
    respond({
      projects: [{ name: 'P', description: '' }],
      associations: [
        { conversationId: conv.id, projectName: 'P', confidence: 0.7, reason: 'r' },
      ],
      objects: [],
    });
    await discoverProjects([conv], { provider: 'anthropic' });

    respond({
      projects: [],
      associations: [
        { conversationId: conv.id, projectName: 'P', confidence: 0.7, reason: 'again' },
      ],
      objects: [],
    });
    const second = await discoverProjects([conv], { provider: 'anthropic' });
    expect(second.associationsCreated).toBe(0);
    expect(second.associationsSkipped).toBe(1);
    expect(await db.projectAssociations.count()).toBe(1);
  });

  it('translates cited message indexes into stored message ids on evidence', async () => {
    const conv = makeConversation();
    const msgs = [
      makeMessage(conv.id, 'first', new Date('2026-08-01T00:00:00Z')),
      makeMessage(conv.id, 'second', new Date('2026-08-01T00:01:00Z')),
      makeMessage(conv.id, 'third', new Date('2026-08-01T00:02:00Z')),
    ];
    await bulkPutMessages(msgs);
    respond({
      projects: [],
      associations: [],
      objects: [
        {
          projectName: null,
          type: 'decision',
          title: 'Anchored to messages',
          evidence: [{ conversationId: conv.id, messageIndexes: [1, 2] }],
        },
      ],
    });

    await discoverProjects([conv], { provider: 'anthropic' });

    // The digest sent to the provider should carry per-message entries.
    const sent = completeMock.mock.calls[0][1].messages;
    const payload = JSON.parse(sent[1].content) as {
      conversations: Array<{ excerpt?: string; messages?: Array<{ i: number }> }>;
    };
    expect(payload.conversations[0].excerpt).toBeUndefined();
    expect(payload.conversations[0].messages?.map((m) => m.i)).toEqual([0, 1, 2]);

    const objects = await db.understandingObjects.toArray();
    const events = await getEventsForObject(objects[0].id);
    expect(events[0].evidence).toEqual([
      { conversationId: conv.id, messageIds: [msgs[1].id, msgs[2].id] },
    ]);
  });

  it('anchors occurredAt to the latest evidence conversation activity', async () => {
    const older = makeConversation({ updatedAt: new Date('2026-07-01T00:00:00Z') });
    const newer = makeConversation({ updatedAt: new Date('2026-08-05T12:00:00Z') });
    respond({
      projects: [],
      associations: [],
      objects: [
        {
          projectName: null,
          type: 'direction',
          title: 'Anchored',
          conversationIds: [older.id, newer.id],
        },
      ],
    });

    await discoverProjects([older, newer], { provider: 'anthropic' });
    const objects = await db.understandingObjects.toArray();
    const events = await getEventsForObject(objects[0].id);
    expect(events[0].occurredAt.getTime()).toBe(newer.updatedAt.getTime());
  });

  it('surfaces parser warnings in the result', async () => {
    const conv = makeConversation();
    respond({
      projects: [{ description: 'nameless' }],
      associations: [{ conversationId: 'invented', projectName: 'X', confidence: 0.9 }],
      objects: [],
    });
    const result = await discoverProjects([conv], { provider: 'anthropic' });
    expect(result.warnings.length).toBe(2);
    expect(result.projectsCreated).toBe(0);
    expect(result.associationsCreated).toBe(0);
  });
});

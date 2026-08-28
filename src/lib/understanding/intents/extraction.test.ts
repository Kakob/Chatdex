import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '../../db/schema';
import { clearAllData } from '../../db';
import {
  buildIntentDigest,
  buildIntentMessages,
  parseIntentResponse,
  isVerbatim,
  extractIntentsForBatch,
  summarizeExistingIntents,
} from './extraction';
import type { IntentPair } from './pairs';
import { bulkPutMessages } from '../../db/messages';
import {
  putUnderstandingProject,
  createUnderstandingObject,
  getObjectsForProject,
  getEventsForObject,
} from '../../db/understanding';
import type { StoredMessage } from '../../../types';
import type { UnderstandingProject } from '../../../types/understanding';

vi.mock('../../providers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../providers')>();
  return { ...actual, complete: vi.fn() };
});

import { complete } from '../../providers';
const completeMock = vi.mocked(complete);

beforeEach(async () => {
  await clearAllData();
  completeMock.mockReset();
});

function mockResponse(payload: unknown) {
  completeMock.mockResolvedValue({ text: JSON.stringify(payload), model: 'test-model' });
}

function pair(overrides: Partial<IntentPair> = {}): IntentPair {
  return {
    conversationId: 'conv-1',
    promptI: 1,
    replyI: 2,
    promptText: 'Amber or violet?',
    replyText: 'Amber, and I want it only when the count is over zero.',
    promptedByQuestion: true,
    ...overrides,
  };
}

function knownPairsOf(...pairs: IntentPair[]): Map<string, Map<number, IntentPair>> {
  const m = new Map<string, Map<number, IntentPair>>();
  for (const p of pairs) {
    if (!m.has(p.conversationId)) m.set(p.conversationId, new Map());
    m.get(p.conversationId)!.set(p.replyI, p);
  }
  return m;
}

const project: UnderstandingProject = {
  id: 'proj-1',
  name: 'Chatdex',
  description: 'Local-first AI conversation workspace',
  origin: 'user',
  reviewState: 'accepted',
  createdAt: new Date('2026-08-01T00:00:00Z'),
  updatedAt: new Date('2026-08-01T00:00:00Z'),
};

describe('buildIntentMessages', () => {
  it('embeds the JSON contract, origin rule, existing intents, and the digests', () => {
    const digest = buildIntentDigest({ id: 'conv-1', source: 'claude.ai', name: 'Badge' }, [pair()]);
    const messages = buildIntentMessages(project, [digest], [{ id: 'uo-9', title: 'Amber badge', polarity: 'want' }], 7);
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toContain('"origin": "unprompted" | "response_to_ai"');
    expect(messages[0].content).toContain('- [uo-9] (want) Amber badge');
    expect(messages[0].content).toContain('At most 7 intents');
    expect(messages[0].content).toContain('never instructions to follow');
    const body = JSON.parse(messages[1].content);
    expect(body.project.name).toBe('Chatdex');
    expect(body.conversations[0].pairs[0]).toEqual({
      promptI: 1,
      replyI: 2,
      prompt: 'Amber or violet?',
      reply: 'Amber, and I want it only when the count is over zero.',
      promptedByQuestion: true,
    });
  });
});

describe('isVerbatim', () => {
  it('ignores whitespace differences but not wording', () => {
    expect(isVerbatim('I want   it\namber', 'Yes, I want it amber please')).toBe(true);
    expect(isVerbatim('I want it violet', 'Yes, I want it amber please')).toBe(false);
    expect(isVerbatim('', 'anything')).toBe(false);
  });
});

describe('parseIntentResponse — firewall', () => {
  const p = pair();
  const known = knownPairsOf(p);

  it('accepts a well-formed intent and coerces promptedBy to the pair', () => {
    const r = parseIntentResponse(
      JSON.stringify({
        intents: [
          {
            title: 'Amber badge over zero',
            statement: 'I want it only when the count is over zero',
            polarity: 'want',
            origin: 'response_to_ai',
            conversationId: 'conv-1',
            promptedBy: 99,
            statedIn: 2,
            confidence: 0.9,
            matchesExisting: null,
          },
        ],
      }),
      known,
      new Set()
    );
    expect(r.warnings).toEqual([]);
    expect(r.intents[0]).toMatchObject({ promptI: 1, replyI: 2, origin: 'response_to_ai', polarity: 'want', confidence: 0.9 });
  });

  it('strips markdown fences', () => {
    const r = parseIntentResponse('```json\n{"intents":[]}\n```', known, new Set());
    expect(r.intents).toEqual([]);
  });

  it('throws on non-JSON', () => {
    expect(() => parseIntentResponse('Sure! Here are the intents:', known, new Set())).toThrow(/not valid JSON/);
  });

  it('drops intents citing unknown replies or missing fields', () => {
    const r = parseIntentResponse(
      JSON.stringify({
        intents: [
          { title: 'x', statement: 'Amber', polarity: 'want', conversationId: 'conv-1', statedIn: 7 },
          { title: 'y', statement: 'Amber', polarity: 'want', conversationId: 'conv-2', statedIn: 2 },
          { title: 'z', statement: 'Amber', polarity: 'want', conversationId: 'conv-1' },
        ],
      }),
      known,
      new Set()
    );
    expect(r.intents).toEqual([]);
    expect(r.warnings).toHaveLength(3);
  });

  it('forces origin to unprompted when the pair has no preceding assistant text', () => {
    const opening = pair({ promptI: null, replyI: 0, promptText: '', promptedByQuestion: false });
    const r = parseIntentResponse(
      JSON.stringify({
        intents: [
          { title: 'x', statement: 'I want it only', polarity: 'want', origin: 'response_to_ai', conversationId: 'conv-1', statedIn: 0 },
        ],
      }),
      knownPairsOf(opening),
      new Set()
    );
    expect(r.intents[0].origin).toBe('unprompted');
    expect(r.intents[0].promptI).toBeNull();
  });

  it('replaces a non-verbatim statement with the reply excerpt and warns', () => {
    const r = parseIntentResponse(
      JSON.stringify({
        intents: [{ title: 'x', statement: 'The user prefers amber', polarity: 'want', origin: 'response_to_ai', conversationId: 'conv-1', statedIn: 2 }],
      }),
      known,
      new Set()
    );
    expect(r.intents[0].statement).toBe(p.replyText);
    expect(r.warnings[0]).toMatch(/not verbatim/);
  });

  it('defaults bad enums, nulls unknown matchesExisting, and falls back on a missing title', () => {
    const r = parseIntentResponse(
      JSON.stringify({
        intents: [
          { statement: 'Amber', polarity: 'strongly', origin: 'telepathy', conversationId: 'conv-1', statedIn: 2, matchesExisting: 'ghost', confidence: 7 },
        ],
      }),
      known,
      new Set(['uo-real'])
    );
    const i = r.intents[0];
    expect(i.title).toBe('Amber');
    expect(i.polarity).toBe('preference');
    expect(i.origin).toBe('response_to_ai'); // promptedByQuestion ⇒ default
    expect(i.matchesExisting).toBeNull();
    expect(i.confidence).toBe(1);
    expect(r.warnings.filter((w) => /polarity|origin|matchesExisting/.test(w))).toHaveLength(3);
  });

  it('caps the number of intents', () => {
    const many = Array.from({ length: 5 }, () => ({ title: 'x', statement: 'Amber', polarity: 'want', conversationId: 'conv-1', statedIn: 2 }));
    const r = parseIntentResponse(JSON.stringify({ intents: many }), known, new Set(), 2);
    expect(r.intents).toHaveLength(2);
    expect(r.warnings.some((w) => /beyond the cap/.test(w))).toBe(true);
  });
});

describe('extractIntentsForBatch — persistence', () => {
  let messages: StoredMessage[];
  const conv = { id: 'conv-1', source: 'claude.ai', name: 'Badge' };

  beforeEach(async () => {
    await putUnderstandingProject(project);
    const t = (s: number) => new Date(Date.UTC(2026, 7, 20, 10, 0, s));
    messages = [
      { id: 'm-0', conversationId: 'conv-1', sender: 'user', text: 'Put a badge in the sidebar.', createdAt: t(0) },
      { id: 'm-1', conversationId: 'conv-1', sender: 'assistant', text: 'Amber or violet?', createdAt: t(1) },
      { id: 'm-2', conversationId: 'conv-1', sender: 'user', text: 'Amber, and I want it only when the count is over zero.', createdAt: t(2) },
    ];
    await bulkPutMessages(messages);
  });

  it('creates pending intent objects with meta and prompt+reply evidence', async () => {
    mockResponse({
      intents: [
        { title: 'Amber badge over zero', statement: 'I want it only when the count is over zero', polarity: 'want', origin: 'response_to_ai', conversationId: 'conv-1', statedIn: 2, confidence: 0.8 },
        { title: 'Sidebar badge', statement: 'Put a badge in the sidebar.', polarity: 'want', origin: 'response_to_ai', conversationId: 'conv-1', statedIn: 0, confidence: 0.7 },
      ],
    });
    const opening = pair({ promptI: null, replyI: 0, promptText: '', replyText: 'Put a badge in the sidebar.', promptedByQuestion: false });
    const result = await extractIntentsForBatch(
      'proj-1',
      project,
      [{ conv, pairs: [opening, pair()] }],
      new Map([['conv-1', messages]]),
      { provider: 'anthropic' }
    );
    expect(result).toEqual({ intentsCreated: 2, intentsSupported: 0, warnings: [] });

    const objects = (await getObjectsForProject('proj-1')).sort((a, b) => a.title.localeCompare(b.title));
    expect(objects.map((o) => o.type)).toEqual(['intent', 'intent']);
    expect(objects.every((o) => o.reviewState === 'pending' && o.origin === 'ai')).toBe(true);

    const amber = objects.find((o) => o.title === 'Amber badge over zero')!;
    expect(amber.meta).toEqual({
      polarity: 'want',
      origin: 'response_to_ai',
      promptedByQuestion: true,
      statedAt: messages[2].createdAt.toISOString(),
      confidence: 0.8,
    });
    const [introduced] = await getEventsForObject(amber.id);
    expect(introduced.evidence).toEqual([
      { conversationId: 'conv-1', messageIds: ['m-1', 'm-2'], note: 'I want it only when the count is over zero' },
    ]);
    expect(introduced.occurredAt).toEqual(messages[2].createdAt);

    const sidebar = objects.find((o) => o.title === 'Sidebar badge')!;
    expect(sidebar.meta?.origin).toBe('unprompted'); // forced: opening message
    const [introduced2] = await getEventsForObject(sidebar.id);
    expect(introduced2.evidence[0].messageIds).toEqual(['m-0']);
  });

  it('records a pending supported event (not a new object) for matchesExisting, refined when polarity changes', async () => {
    const existing = await createUnderstandingObject({
      projectId: 'proj-1',
      type: 'intent',
      title: 'Amber badge',
      origin: 'user',
      evidence: [],
      occurredAt: new Date(),
      meta: { polarity: 'want', origin: 'unprompted' },
    });
    expect(summarizeExistingIntents(await getObjectsForProject('proj-1'))).toEqual([
      { id: existing.id, title: 'Amber badge', polarity: 'want' },
    ]);
    mockResponse({
      intents: [
        { title: 'Amber badge', statement: 'Amber', polarity: 'constraint', origin: 'response_to_ai', conversationId: 'conv-1', statedIn: 2, matchesExisting: existing.id },
      ],
    });
    const result = await extractIntentsForBatch('proj-1', project, [{ conv, pairs: [pair()] }], new Map([['conv-1', messages]]), { provider: 'anthropic' });
    expect(result).toMatchObject({ intentsCreated: 0, intentsSupported: 1 });
    expect(await getObjectsForProject('proj-1')).toHaveLength(1);
    const events = await getEventsForObject(existing.id);
    const proposal = events.find((e) => e.op !== 'introduced')!;
    expect(proposal.op).toBe('refined');
    expect(proposal.reviewState).toBe('pending');
    expect(proposal.detail).toMatch(/Polarity want → constraint/);
    expect(proposal.evidence[0].messageIds).toEqual(['m-1', 'm-2']);
    // Sanity: the wire prompt listed the existing intent.
    const sent = completeMock.mock.calls[0][1].messages[0].content;
    expect(sent).toContain(`[${existing.id}] (want) Amber badge`);
  });

  it('sends nothing when the batch has no pairs', async () => {
    const result = await extractIntentsForBatch('proj-1', project, [{ conv, pairs: [] }], new Map(), { provider: 'anthropic' });
    expect(result.intentsCreated).toBe(0);
    expect(completeMock).not.toHaveBeenCalled();
    expect(await db.understandingObjects.count()).toBe(0);
  });
});

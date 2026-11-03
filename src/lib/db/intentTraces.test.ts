import { describe, it, expect, beforeEach } from 'vitest';
import { db } from './schema';
import { clearAllData } from './index';
import {
  putIntentTrace,
  getIntentTrace,
  listTracesForProject,
  listTracesForIntent,
  getLatestTraceByIntent,
} from './intentTraces';
import { createUnderstandingObject, getUnderstandingObject } from './understanding';
import type { IntentTrace } from '../../types/intentTrace';

beforeEach(async () => {
  await clearAllData();
});

function makeTrace(overrides: Partial<IntentTrace> = {}): IntentTrace {
  return {
    id: crypto.randomUUID(),
    projectId: 'up-1',
    intentObjectId: 'uo-1',
    repoRef: { owner: 'Kakob', repo: 'Chatdex', commitSha: 'a'.repeat(40), ref: 'main' },
    specStatus: 'no_spec',
    specEvidence: [],
    implStatus: 'implemented',
    implEvidence: [{ path: 'src/a.ts', startLine: 3, endLine: 5, quote: 'export const a = 1;' }],
    implRationale: 'The constant is exported.',
    fetchedPaths: ['src/a.ts'],
    provider: 'anthropic',
    model: 'claude-opus-5',
    warnings: [],
    createdAt: new Date('2026-08-28T10:00:00Z'),
    ...overrides,
  };
}

describe('intentTraces table (Dexie v11)', () => {
  it('is at or past schema version 11 and round-trips Date fields', async () => {
    // v12 added the Change Workspace local-only tables (localOnly.test.ts pins it).
    expect(db.verno).toBeGreaterThanOrEqual(11);
    const trace = makeTrace({
      commitEvidence: [
        {
          sha: 'b'.repeat(40),
          path: 'src/a.ts',
          message: 'feat: add a',
          authoredAt: new Date('2026-08-27T09:00:00Z'),
          url: 'https://github.com/Kakob/Chatdex/commit/' + 'b'.repeat(40),
        },
      ],
    });
    await putIntentTrace(trace);
    const stored = await getIntentTrace(trace.id);
    expect(stored).toEqual(trace);
    expect(stored?.createdAt).toBeInstanceOf(Date);
    expect(stored?.commitEvidence?.[0].authoredAt).toBeInstanceOf(Date);
  });

  it('lists traces per project and per intent, newest first', async () => {
    const t1 = makeTrace({ createdAt: new Date('2026-08-28T10:00:00Z') });
    const t2 = makeTrace({ createdAt: new Date('2026-08-28T11:00:00Z') });
    const other = makeTrace({ intentObjectId: 'uo-2', createdAt: new Date('2026-08-28T12:00:00Z') });
    const elsewhere = makeTrace({ projectId: 'up-2', intentObjectId: 'uo-3' });
    await Promise.all([t1, t2, other, elsewhere].map(putIntentTrace));

    expect((await listTracesForProject('up-1')).map((t) => t.id)).toEqual([other.id, t2.id, t1.id]);
    expect((await listTracesForIntent('uo-1')).map((t) => t.id)).toEqual([t2.id, t1.id]);
  });

  it('getLatestTraceByIntent keeps the newest trace per intent (append-only history)', async () => {
    const older = makeTrace({ implStatus: 'unknown', createdAt: new Date('2026-08-28T10:00:00Z') });
    const newer = makeTrace({ implStatus: 'implemented', createdAt: new Date('2026-08-28T11:00:00Z') });
    await putIntentTrace(older);
    await putIntentTrace(newer);
    const latest = await getLatestTraceByIntent('up-1');
    expect(latest.size).toBe(1);
    expect(latest.get('uo-1')?.id).toBe(newer.id);
    // The older trace is still retrievable — nothing was overwritten.
    expect(await getIntentTrace(older.id)).toBeDefined();
  });
});

describe('UnderstandingObject.meta passthrough', () => {
  it('createUnderstandingObject stores intent meta alongside the object', async () => {
    const obj = await createUnderstandingObject({
      projectId: 'up-1',
      type: 'intent',
      title: 'Badge on the sidebar',
      body: 'I want the badge on the sidebar',
      origin: 'ai',
      evidence: [{ conversationId: 'conv-1', messageIds: ['m-1', 'm-2'] }],
      occurredAt: new Date('2026-08-20T00:00:00Z'),
      meta: { polarity: 'want', origin: 'response_to_ai', promptedByQuestion: true, confidence: 0.9 },
    });
    const stored = await getUnderstandingObject(obj.id);
    expect(stored?.meta).toEqual({
      polarity: 'want',
      origin: 'response_to_ai',
      promptedByQuestion: true,
      confidence: 0.9,
    });
  });

  it('omits meta when not supplied (existing callers unchanged)', async () => {
    const obj = await createUnderstandingObject({
      projectId: 'up-1',
      type: 'decision',
      title: 'Use Dexie',
      origin: 'user',
      evidence: [],
      occurredAt: new Date(),
    });
    const stored = await getUnderstandingObject(obj.id);
    expect(stored).toBeDefined();
    expect('meta' in stored!).toBe(false);
  });
});

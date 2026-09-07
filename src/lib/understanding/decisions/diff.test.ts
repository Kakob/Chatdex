import { describe, it, expect, beforeEach } from 'vitest';
import { clearAllData } from '../../db';
import { db } from '../../db/schema';
import { putDecisionTrace } from '../../db/decisionTraces';
import { createUnderstandingObject, putUnderstandingProject, getEventsForObject, getUnderstandingObject } from '../../db/understanding';
import { foldDecisionDiff, buildDecisionDiff, computeOrLoadDiff, recordInvalidation, mergeDecisions, DIFFER_VERSION } from './diff';
import type { DecisionTrace, TranscriptSpan } from '../../../types/decision';

const now = new Date('2026-09-07T10:00:00Z');
const span: TranscriptSpan = { conversationId: 'c1', messageId: 'm1', stepIndex: 1, role: 'agent_text', quote: 'q', startOffset: 0, endOffset: 1 };

function trace(objectId: string, runId: string, overrides: Partial<DecisionTrace> = {}): DecisionTrace {
  return {
    id: `${objectId}@${runId}`,
    projectId: 'p1',
    decisionObjectId: objectId,
    runId,
    sha: runId === 'run-1' ? 'a'.repeat(40) : 'b'.repeat(40),
    why: 'because',
    alternatives: [],
    assumptions: [{ id: `${objectId}-a1`, statement: 'A one', basis: 'inferred', transcriptEvidence: [span], codeEvidence: [] }],
    transcriptEvidence: [span],
    anchorStableKeys: [],
    implEvidence: [{ path: 'src/a.ts', startLine: 1, endLine: 1, quote: 'x' }],
    symbols: [],
    testPaths: [],
    invalidates: [],
    fetchedPaths: [],
    provider: 'anthropic',
    model: 'm',
    warnings: [],
    createdAt: now,
    ...overrides,
  };
}

describe('foldDecisionDiff (§12, law 2.8)', () => {
  const from = [trace('d-same', 'run-1'), trace('d-revised', 'run-1'), trace('d-gone', 'run-1'), trace('d-killed', 'run-1')];
  const to = [
    trace('d-same', 'run-2'),
    trace('d-revised', 'run-2', {
      why: 'because of something else',
      assumptions: [
        { id: 'r-a1', statement: 'A one', basis: 'inherited', transcriptEvidence: [span], codeEvidence: [] },
        { id: 'r-a2', statement: 'A two', basis: 'inferred', transcriptEvidence: [span], codeEvidence: [] },
      ],
      implEvidence: [{ path: 'src/b.ts', startLine: 1, endLine: 1, quote: 'y' }],
      invalidates: [{ decisionObjectId: 'd-killed', assumptionId: 'd-killed-a1', evidence: [span], codeEvidence: [] }],
    }),
    trace('d-new', 'run-2'),
  ];

  it('emits every op once, in deterministic order', () => {
    const entries = foldDecisionDiff(from, to);
    expect(entries.map((e) => [e.op, e.decisionObjectId, e.assumptionId ?? null])).toEqual([
      ['new_decision', 'd-new', null],
      ['revised', 'd-revised', null],
      ['new_assumption', 'd-revised', 'r-a2'],
      ['invalidated', 'd-killed', 'd-killed-a1'],
      ['unresolved', 'd-gone', null],
    ]);
    const revised = entries.find((e) => e.op === 'revised')!;
    expect(revised.changedFields).toEqual(['why', 'assumptions', 'implementing paths']);
    expect(revised.fromTraceId).toBe('d-revised@run-1');
    expect(revised.toTraceId).toBe('d-revised@run-2');
    const invalidated = entries.find((e) => e.op === 'invalidated')!;
    expect(invalidated.evidence).toEqual([span]);
    expect(invalidated.fromTraceId).toBe('d-killed@run-1');
    // d-killed is invalidated, so it is NOT also unresolved.
    expect(entries.filter((e) => e.decisionObjectId === 'd-killed').map((e) => e.op)).toEqual(['invalidated']);
  });

  it('reports only a basis change as "assumption bases" and nothing for identical runs', () => {
    const basisOnly = trace('d', 'run-2', {
      assumptions: [{ id: 'z', statement: 'A one', basis: 'specified', transcriptEvidence: [span], codeEvidence: [] }],
    });
    expect(foldDecisionDiff([trace('d', 'run-1')], [basisOnly])).toEqual([
      expect.objectContaining({ op: 'revised', changedFields: ['assumption bases'] }),
    ]);
    expect(foldDecisionDiff([trace('d', 'run-1')], [trace('d', 'run-2')])).toEqual([]);
  });

  it('is deterministic and builds an idempotent id', () => {
    const a = buildDecisionDiff('p1', { runId: 'run-1', traces: from }, { runId: 'run-2', traces: to }, now);
    const b = buildDecisionDiff('p1', { runId: 'run-1', traces: [...from].reverse() }, { runId: 'run-2', traces: [...to].reverse() }, now);
    expect(a).toEqual(b);
    expect(a.id).toBe('run-1..run-2');
    expect(a.differVersion).toBe(DIFFER_VERSION);
  });
});

describe('computeOrLoadDiff / recordInvalidation / mergeDecisions', () => {
  beforeEach(async () => {
    await clearAllData();
    await putUnderstandingProject({ id: 'p1', name: 'Chatdex', origin: 'user', reviewState: 'accepted', createdAt: now, updatedAt: now });
  });

  it('persists LOCAL-ONLY once per run pair and reloads it', async () => {
    await putDecisionTrace(trace('d-old', 'run-1'));
    await putDecisionTrace(trace('d-new', 'run-2', { createdAt: new Date(now.getTime() + 1000) }));
    const first = await computeOrLoadDiff('p1', 'run-1', 'run-2');
    expect(first.entries.map((e) => e.op)).toEqual(['new_decision', 'unresolved']);
    expect(first.fromSha).toBe('a'.repeat(40));
    expect(first.toSha).toBe('b'.repeat(40));
    const second = await computeOrLoadDiff('p1', 'run-1', 'run-2');
    expect(second.createdAt).toEqual(first.createdAt);
    expect(await db.decisionDiffs.count()).toBe(1);
  });

  it('records a user-origin contradicted event and a user-origin merge', async () => {
    const killed = await createUnderstandingObject({ projectId: 'p1', type: 'decision', title: 'Old', origin: 'user', evidence: [], occurredAt: now });
    const canon = await createUnderstandingObject({ projectId: 'p1', type: 'decision', title: 'Canonical', origin: 'user', evidence: [], occurredAt: now });

    const event = await recordInvalidation({ op: 'invalidated', decisionObjectId: killed.id, evidence: [span], codeEvidence: [] });
    expect(event).toMatchObject({ op: 'contradicted', origin: 'user', reviewState: 'accepted' });
    expect(event.evidence).toEqual([{ conversationId: 'c1', messageIds: ['m1'] }]);
    await expect(recordInvalidation({ op: 'new_decision', decisionObjectId: killed.id })).rejects.toThrow(/Only invalidated/);
    await expect(recordInvalidation({ op: 'invalidated', decisionObjectId: killed.id, evidence: [] })).rejects.toThrow(/no transcript evidence/);

    const merge = await mergeDecisions(killed.id, canon.id);
    expect(merge).toMatchObject({ op: 'superseded', supersededByObjectId: canon.id, origin: 'user' });
    expect((await getUnderstandingObject(killed.id))?.status).toBe('superseded');
    expect((await getEventsForObject(killed.id)).map((e) => e.op)).toEqual(['introduced', 'contradicted', 'superseded']);
    await expect(mergeDecisions(killed.id, killed.id)).rejects.toThrow(/itself/);
  });
});

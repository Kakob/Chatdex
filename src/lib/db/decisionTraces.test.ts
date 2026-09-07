import { describe, it, expect, beforeEach } from 'vitest';
import { clearAllData } from './index';
import {
  putDecisionTrace,
  getDecisionTrace,
  listDecisionTracesForProject,
  listDecisionTracesForDecision,
  listDecisionTracesForRun,
  getLatestTraceByDecision,
  listRecoveryRuns,
} from './decisionTraces';
import { decisionDiffId, getDecisionDiff, putDecisionDiff, listDecisionDiffsForProject } from './decisionDiffs';
import type { DecisionTrace } from '../../types/decision';

beforeEach(async () => {
  await clearAllData();
});

function makeTrace(overrides: Partial<DecisionTrace> = {}): DecisionTrace {
  return {
    id: crypto.randomUUID(),
    projectId: 'up-1',
    decisionObjectId: 'uo-d1',
    runId: 'run-1',
    repoKey: 'gh:Kakob/Chatdex',
    sha: 'a'.repeat(40),
    alternatives: [],
    assumptions: [],
    transcriptEvidence: [
      { conversationId: 'c1', messageId: 'm1', stepIndex: 0, role: 'user_msg', quote: 'x', startOffset: 0, endOffset: 1 },
    ],
    anchorStableKeys: [],
    implEvidence: [],
    symbols: [],
    testPaths: [],
    invalidates: [],
    fetchedPaths: [],
    provider: 'anthropic',
    model: 'claude-opus-5',
    warnings: [],
    createdAt: new Date('2026-09-07T10:00:00Z'),
    ...overrides,
  };
}

describe('decisionTraces (SPEC-decision-recovery §7.5)', () => {
  it('stores, lists per project / decision / run, and picks the newest per decision', async () => {
    const t1 = makeTrace({ createdAt: new Date('2026-09-07T10:00:00Z') });
    const t2 = makeTrace({ createdAt: new Date('2026-09-07T11:00:00Z'), runId: 'run-2', sha: 'b'.repeat(40) });
    const t3 = makeTrace({ decisionObjectId: 'uo-d2', createdAt: new Date('2026-09-07T10:30:00Z') });
    const other = makeTrace({ projectId: 'up-2', decisionObjectId: 'uo-other' });
    for (const t of [t1, t2, t3, other]) await putDecisionTrace(t);

    expect((await getDecisionTrace(t1.id))?.runId).toBe('run-1');
    expect((await listDecisionTracesForProject('up-1')).map((t) => t.id)).toEqual([t2.id, t3.id, t1.id]);
    expect((await listDecisionTracesForDecision('uo-d1')).map((t) => t.id)).toEqual([t2.id, t1.id]);
    expect((await listDecisionTracesForRun('up-1', 'run-1')).map((t) => t.id)).toEqual([t1.id, t3.id]);

    const latest = await getLatestTraceByDecision('up-1');
    expect(latest.get('uo-d1')?.id).toBe(t2.id);
    expect(latest.get('uo-d2')?.id).toBe(t3.id);

    expect(await listRecoveryRuns('up-1')).toEqual([
      { runId: 'run-2', createdAt: t2.createdAt, repoKey: 'gh:Kakob/Chatdex', sha: 'b'.repeat(40), traceCount: 1 },
      { runId: 'run-1', createdAt: t1.createdAt, repoKey: 'gh:Kakob/Chatdex', sha: 'a'.repeat(40), traceCount: 2 },
    ]);
  });
});

describe('decisionDiffs (LOCAL-ONLY, §12)', () => {
  it('persists idempotently under a deterministic id', async () => {
    const diff = {
      id: decisionDiffId('run-1', 'run-2'),
      projectId: 'up-1',
      fromRunId: 'run-1',
      toRunId: 'run-2',
      entries: [{ op: 'new_decision' as const, decisionObjectId: 'uo-d9' }],
      differVersion: '1.0.0',
      createdAt: new Date(),
    };
    await putDecisionDiff(diff);
    await putDecisionDiff(diff);
    expect(await listDecisionDiffsForProject('up-1')).toHaveLength(1);
    expect((await getDecisionDiff('run-1', 'run-2'))?.entries[0].op).toBe('new_decision');
    expect(diff.id).toBe('run-1..run-2');
  });
});

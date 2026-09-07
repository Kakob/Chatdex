import { describe, it, expect, beforeEach } from 'vitest';
import { clearAllData } from '../../db';
import { db } from '../../db/schema';
import { createUnderstandingObject, putUnderstandingProject, setObjectReviewState } from '../../db/understanding';
import { putDecisionTrace } from '../../db/decisionTraces';
import { createReplacementWorkspace, findReplacementWorkspace } from './replacement';
import { toMetaRecord } from './meta';
import type { DecisionTrace } from '../../../types/decision';

const now = new Date('2026-09-07T10:00:00Z');
const SHA = 'b'.repeat(40);

beforeEach(async () => {
  await clearAllData();
  await putUnderstandingProject({ id: 'p1', name: 'Chatdex', origin: 'user', reviewState: 'accepted', createdAt: now, updatedAt: now });
  await db.conversations.put({ id: 'sess-1', source: 'claude-code', name: 's', summary: null, createdAt: now, updatedAt: now, importedAt: now, messageCount: 0, userMessageCount: 0, assistantMessageCount: 0, estimatedTokens: 0, fullText: '' });
});

async function seedDecision(reviewState: 'pending' | 'accepted' = 'pending') {
  const object = await createUnderstandingObject({
    projectId: 'p1', type: 'decision', title: 'Deletion is permanent with no audit record', body: 'Nobody asked.',
    origin: 'ai', evidence: [{ conversationId: 'sess-1', messageIds: ['m1'] }], occurredAt: now,
    meta: toMetaRecord({ madeBy: 'agent', basis: 'invented', unsupportedAutonomous: true, conflictsWithUserDirection: false, primaryPath: 'src/lib/db/projects.ts', source: 'recovery' }),
  });
  if (reviewState === 'accepted') await setObjectReviewState(object.id, 'accepted');
  const trace: DecisionTrace = {
    id: 'dt-1', projectId: 'p1', decisionObjectId: object.id, runId: 'run-1', repoKey: 'gh:Kakob/Chatdex', sha: SHA,
    why: 'Nobody asked for recovery.',
    alternatives: [{ statement: 'Soft delete', transcriptEvidence: [], rejectedBecause: 'unrequested' }],
    assumptions: [
      { id: 'a1', statement: 'Conversations survive', basis: 'specified', transcriptEvidence: [], codeEvidence: [] },
      { id: 'a2', statement: 'Cascade mirrors deleteConversation', basis: 'inherited', transcriptEvidence: [], codeEvidence: [] },
      { id: 'a3', statement: 'No tombstone needed', basis: 'inferred', transcriptEvidence: [], codeEvidence: [] },
    ],
    transcriptEvidence: [
      { conversationId: 'sess-1', messageId: 'm1', stepIndex: 1, role: 'agent_text', quote: 'permanent with no audit record', startOffset: 0, endOffset: 30 },
      { conversationId: 'sess-1', messageId: 'm2', stepIndex: 3, role: 'tool_call', quote: 'Write', startOffset: 0, endOffset: 5 },
    ],
    anchorStableKeys: [],
    implEvidence: [{ path: 'src/lib/db/projects.ts', startLine: 1, endLine: 3, quote: 'export async function deleteProject' }],
    symbols: ['deleteProject'], testPaths: [], invalidates: [], fetchedPaths: [], provider: 'anthropic', model: 'm', warnings: [], createdAt: now,
  };
  await putDecisionTrace(trace);
  return object;
}

describe('createReplacementWorkspace (§11.3)', () => {
  it('seeds intent, constraints, open choices, repository ref, evidence, and origin — without treating a pending decision as accepted understanding', async () => {
    const object = await seedDecision('pending');
    const change = await createReplacementWorkspace('p1', object.id);

    expect(change.title).toBe('Replace: Deletion is permanent with no audit record');
    expect(change.state).toBe('draft');
    expect(change.originRef).toEqual({ kind: 'decision', id: object.id });
    expect(change.understandingPointIds).toEqual([]);
    expect(change.intent).toMatchObject({
      currentBehavior: 'Deletion is permanent with no audit record — Nobody asked for recovery.',
      desiredBehavior: '',
    });
    expect(change.intent?.whyItMatters).toMatch(/Invented decision made by agent; unsupported autonomous/);
    expect(change.constraints).toEqual(['Conversations survive (specified)', 'Cascade mirrors deleteConversation (inherited)']);
    expect(change.openImplementationChoices).toEqual([
      'No tombstone needed (inferred — revisit)',
      'Alternative: Soft delete (rejected: unrequested)',
    ]);
    expect(change.repositoryRef).toEqual({ baseCommit: SHA, implicatedPaths: ['src/lib/db/projects.ts'] });

    const kinds = (change.evidence ?? []).map((e) => e.kind).sort();
    expect(kinds).toEqual(['code', 'intent_history']);
    const code = change.evidence!.find((e) => e.kind === 'code')!;
    expect(code).toMatchObject({ origin: 'ai', addedVia: 'attach', repoKey: 'gh:Kakob/Chatdex', sha: SHA, path: 'src/lib/db/projects.ts', startLine: 1, endLine: 3 });
    const history = change.evidence!.find((e) => e.kind === 'intent_history')!;
    expect(history).toMatchObject({ source: 'understanding', understandingObjectId: object.id, conversationId: 'sess-1', messageIds: ['m1', 'm2'] });
  });

  it('is idempotent per decision and links accepted decisions as understanding points', async () => {
    const object = await seedDecision('accepted');
    const first = await createReplacementWorkspace('p1', object.id);
    const second = await createReplacementWorkspace('p1', object.id);
    expect(second.id).toBe(first.id);
    expect(await db.preparedChanges.count()).toBe(1);
    expect(first.understandingPointIds).toEqual([object.id]);
    expect((await findReplacementWorkspace('p1', object.id))?.id).toBe(first.id);
  });

  it('rejects non-decisions', async () => {
    const other = await createUnderstandingObject({ projectId: 'p1', type: 'idea', title: 'x', origin: 'user', evidence: [], occurredAt: now });
    await expect(createReplacementWorkspace('p1', other.id)).rejects.toThrow(/Decision not found/);
  });
});

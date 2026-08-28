// SPEC-change-workspace §7.1 lifecycle + §2.4 freeze law + §12 verification gate.
import { beforeEach, describe, expect, it } from 'vitest';
import { clearAllData, putUnderstandingProject } from '../db';
import { getPreparedChange } from '../db/preparedChanges';
import { createPreparedChange, markPreparedChangeReady, updatePreparedChangeDraft } from './changes';
import {
  addEvidenceItems,
  addHypothesis,
  attachImplementation,
  closeWorkspace,
  editOpenHypothesis,
  linkQuestion,
  markVerified,
  setWorkspaceMode,
  suggestLearned,
  updateLearned,
  updateTrace,
  updateVerificationRow,
} from './lifecycle';
import { MAX_QUOTE_CHARS, type CodeEvidence, type EvidenceItem } from '../../types/evidence';
import type { Implementation } from '../../types/preparedChange';

beforeEach(async () => {
  await clearAllData();
  await putUnderstandingProject({
    id: 'project-1',
    name: 'Chatdex',
    origin: 'user',
    reviewState: 'accepted',
    createdAt: new Date('2026-08-28T00:00:00Z'),
    updatedAt: new Date('2026-08-28T00:00:00Z'),
  });
});

const codeItem = (id: string): CodeEvidence => ({
  id,
  kind: 'code',
  createdAt: '2026-08-28T10:00:00.000Z',
  origin: 'user',
  addedVia: 'search',
  repoKey: 'gh:Kakob/Chatdex',
  sha: 'a'.repeat(40),
  path: 'src/pages/SearchPage.tsx',
  startLine: 10,
  endLine: 12,
  quote: 'navigate(`/conversations/${id}?scrollTo=${messageId}`)',
  quoteHash: 'deadbeef',
});

const aiItem = (id: string): EvidenceItem => ({
  id,
  kind: 'ai_inference',
  createdAt: '2026-08-28T10:00:00.000Z',
  origin: 'ai',
  addedVia: 'assisted',
  runId: 'run-1',
  provider: 'anthropic',
  promptDigest: 'abc',
  text: 'The scroll happens in ConversationsPage.',
});

const implementation: Omit<Implementation, 'attachedAt'> = {
  source: 'claude_code_session',
  provenance: 'ai',
  conversationId: 'conv-cc-1',
  files: [{ path: 'src/pages/ConversationsPage.tsx', additions: 12, deletions: 3 }],
};

async function readyWorkspace() {
  let change = await createPreparedChange({
    projectId: 'project-1',
    title: 'Search result scrolls to the matching message',
    understandingPointIds: [],
    intent: {
      currentBehavior: 'Opens the conversation but does not scroll.',
      desiredBehavior: 'Opens the conversation and scrolls the match into view.',
      whyItMatters: 'Search is navigation.',
    },
  });
  change = await updatePreparedChangeDraft(change.id, {
    criteria: [
      { id: 'c1', text: 'The matching message enters the viewport.', createdAt: '' },
      { id: 'c2', text: 'Works after a cold page load.', createdAt: '' },
    ],
  });
  return markPreparedChangeReady(change.id);
}

describe('Change Workspace lifecycle', () => {
  it('starts from a stated intent with no accepted understanding (D7) and mirrors it into the handoff fields', async () => {
    const ready = await readyWorkspace();
    expect(ready.state).toBe('ready');
    expect(ready.understandingPointIds).toEqual([]);
    expect(ready.desiredOutcome).toBe('Opens the conversation and scrolls the match into view.');
    expect(ready.rationale).toBe('Search is navigation.');
    expect(ready.acceptanceCriteria).toEqual([
      'The matching message enters the viewport.',
      'Works after a cold page load.',
    ]);
    expect(ready.criteria?.map((c) => c.id)).toEqual(['c1', 'c2']);
  });

  it('appends evidence and never exceeds the quote cap', async () => {
    const ready = await readyWorkspace();
    const withEvidence = await addEvidenceItems(ready.id, [codeItem('e1'), aiItem('e2')]);
    expect(withEvidence.evidence?.map((e) => e.id)).toEqual(['e1', 'e2']);
    // Re-adding the same id is a no-op, not a rewrite.
    const again = await addEvidenceItems(ready.id, [{ ...codeItem('e1'), quote: 'changed' }]);
    expect(again.evidence?.find((e) => e.id === 'e1')).toEqual(codeItem('e1'));
    await expect(
      addEvidenceItems(ready.id, [{ ...codeItem('e3'), quote: 'x'.repeat(MAX_QUOTE_CHARS + 1) }])
    ).rejects.toThrow(/exceeds/);
  });

  it('validates trace references against nodes and evidence', async () => {
    const ready = await readyWorkspace();
    await addEvidenceItems(ready.id, [codeItem('e1')]);
    const updated = await updateTrace(ready.id, {
      nodes: [
        { id: 'n1', label: 'SearchPage', kind: 'component', evidenceIds: ['e1'], order: 0 },
        { id: 'n2', label: '???', kind: 'unknown', evidenceIds: [], order: 1 },
      ],
      edges: [{ id: 'x1', from: 'n1', to: 'n2', evidenceIds: [], origin: 'user' }],
    });
    expect(updated.trace?.nodes).toHaveLength(2);
    await expect(
      updateTrace(ready.id, {
        nodes: [{ id: 'n1', label: 'A', kind: 'other', evidenceIds: ['missing'], order: 0 }],
        edges: [],
      })
    ).rejects.toThrow(/unknown evidence/);
    await expect(
      updateTrace(ready.id, {
        nodes: [{ id: 'n1', label: 'A', kind: 'other', evidenceIds: [], order: 0 }],
        edges: [{ id: 'x', from: 'n1', to: 'nope', evidenceIds: [], origin: 'user' }],
      })
    ).rejects.toThrow(/missing node/);
  });

  it('freezes the open hypothesis when an implementation is attached (freeze law §2.4)', async () => {
    const ready = await readyWorkspace();
    let change = await addHypothesis(ready.id, 'Only the conversation id survives navigation.');
    const hypothesisId = change.hypotheses![0].id;
    change = await editOpenHypothesis(ready.id, hypothesisId, 'Only the conversation id survives the route.');
    expect(change.hypotheses![0].frozenAt).toBeUndefined();

    change = await attachImplementation(ready.id, implementation);
    expect(change.state).toBe('implementing');
    expect(change.implementingAt).toBeInstanceOf(Date);
    expect(change.hypotheses![0].frozenAt).toBeDefined();
    expect(change.hypotheses![0].text).toBe('Only the conversation id survives the route.');
    await expect(editOpenHypothesis(ready.id, hypothesisId, 'rewrite')).rejects.toThrow(/frozen/);

    // A later hypothesis appends; the frozen one stays visible.
    change = await addHypothesis(ready.id, 'Second thought.');
    expect(change.hypotheses).toHaveLength(2);
    expect(change.hypotheses![1].frozenAt).toBeUndefined();

    // Verification rows exist for every criterion from this point.
    expect(change.verification?.map((r) => [r.criterionId, r.status])).toEqual([
      ['c1', 'unverified'],
      ['c2', 'unverified'],
    ]);
  });

  it('auto-readies a draft on attach for the AI-led path', async () => {
    let change = await createPreparedChange({
      projectId: 'project-1',
      title: 'Understand this change',
      understandingPointIds: [],
      intent: { currentBehavior: '', desiredBehavior: 'Whatever Claude Code did', whyItMatters: '' },
      originRef: { kind: 'conversation', id: 'conv-cc-1' },
    });
    change = await updatePreparedChangeDraft(change.id, {
      criteria: [{ id: 'c1', text: 'Tests pass.', createdAt: '' }],
    });
    change = await attachImplementation(change.id, implementation);
    expect(change.state).toBe('implementing');
    expect(change.readyAt).toBeInstanceOf(Date);
    expect(change.originRef).toEqual({ kind: 'conversation', id: 'conv-cc-1' });
  });

  it('keeps a replaced implementation in history and refuses attachment after verified', async () => {
    const ready = await readyWorkspace();
    await attachImplementation(ready.id, implementation);
    const replaced = await attachImplementation(ready.id, {
      ...implementation,
      source: 'github_pr',
      prNumber: 42,
      provenance: 'human_ai',
    });
    expect(replaced.implementation?.source).toBe('github_pr');
    expect(replaced.implementationHistory).toHaveLength(1);
    expect(replaced.implementationHistory![0].source).toBe('claude_code_session');
  });

  it('blocks "supported" on AI-only evidence and gates markVerified on notes (law §2.2, §12)', async () => {
    const ready = await readyWorkspace();
    await addEvidenceItems(ready.id, [codeItem('e1'), aiItem('e2')]);
    await attachImplementation(ready.id, implementation);
    await expect(
      updateVerificationRow(ready.id, { criterionId: 'c1', evidenceIds: ['e2'], status: 'supported' })
    ).rejects.toThrow(/non-AI evidence/);
    await expect(
      updateVerificationRow(ready.id, { criterionId: 'c1', evidenceIds: [], status: 'supported' })
    ).rejects.toThrow(/non-AI evidence/);
    await updateVerificationRow(ready.id, { criterionId: 'c1', evidenceIds: ['e1', 'e2'], status: 'supported' });

    await expect(markVerified(ready.id)).rejects.toThrow(/1 criterion\(s\) are unverified/);
    await updateVerificationRow(ready.id, {
      criterionId: 'c2',
      evidenceIds: [],
      status: 'unverified',
      note: 'Cold load not tested yet — accepted.',
    });
    const verified = await markVerified(ready.id);
    expect(verified.state).toBe('verified');
    expect(verified.verifiedAt).toBeInstanceOf(Date);
    await expect(attachImplementation(ready.id, implementation)).rejects.toThrow(/cannot be attached/);
  });

  it('requires "learned" before close, keeps AI suggestions out of the human text (§2.3)', async () => {
    const ready = await readyWorkspace();
    await addEvidenceItems(ready.id, [codeItem('e1')]);
    await attachImplementation(ready.id, implementation);
    await updateVerificationRow(ready.id, { criterionId: 'c1', evidenceIds: ['e1'], status: 'supported' });
    await updateVerificationRow(ready.id, { criterionId: 'c2', evidenceIds: [], status: 'unverified', note: 'ok' });
    await markVerified(ready.id);

    await expect(closeWorkspace(ready.id)).rejects.toThrow(/what you learned/);
    let change = await suggestLearned(ready.id, 'AI draft.');
    expect(change.learned?.text).toBe('');
    expect(change.learned?.aiSuggested).toBe('AI draft.');
    await expect(closeWorkspace(ready.id)).rejects.toThrow(/what you learned/);

    change = await updateLearned(ready.id, 'Scrolling belongs to ConversationsPage.');
    change = await closeWorkspace(ready.id);
    expect(change.state).toBe('closed');
    expect(change.closedAt).toBeInstanceOf(Date);
    await expect(addEvidenceItems(ready.id, [codeItem('e9')])).rejects.toThrow(/frozen/);
    await expect(updateLearned(ready.id, 'more')).rejects.toThrow(/frozen/);
  });

  it('refuses out-of-order transitions', async () => {
    const ready = await readyWorkspace();
    await expect(markVerified(ready.id)).rejects.toThrow(/Only an implementing workspace/);
    await expect(closeWorkspace(ready.id)).rejects.toThrow(/Only a verified workspace/);
    await expect(
      updateVerificationRow(ready.id, { criterionId: 'c1', evidenceIds: [], status: 'partial' })
    ).rejects.toThrow(/unavailable/);
  });

  it('records mode changes and question links', async () => {
    const ready = await readyWorkspace();
    let change = await setWorkspaceMode(ready.id, 'guided');
    change = await setWorkspaceMode(ready.id, 'guided');
    change = await setWorkspaceMode(ready.id, 'assisted');
    expect(change.modeHistory?.map((m) => m.mode)).toEqual(['guided', 'assisted']);
    change = await linkQuestion(ready.id, 'q-1');
    change = await linkQuestion(ready.id, 'q-1');
    expect(change.questionIds).toEqual(['q-1']);
    expect((await getPreparedChange(ready.id))?.mode).toBe('assisted');
  });
});

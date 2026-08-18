import { describe, it, expect, beforeEach } from 'vitest';
import {
  db,
  clearAllData,
  bulkPutConversations,
  bulkPutMessages,
  storeRawSources,
  getInvestigationCase,
  getRevisionsForCase,
} from '../db/index';
import { deriveAnchorsForConversation } from './anchors';
import {
  startInvestigation,
  pinTranscriptExhibit,
  pinToolEventExhibit,
  confirmReviewScope,
  removeDraftExhibit,
  removeDraftReviewScope,
  recordCaseSearch,
} from './cases';
import {
  saveVerdictDraft,
  validateVerdict,
  finalizeVerdict,
  reopenCase,
  listDecisionLedger,
  getInvestigationCoverage,
  getContinuationTargets,
} from './verdicts';
import type { ContentBlock, StoredConversation, StoredMessage } from '../../types/unified';
import type { InvestigationAnchor, VerdictDraft } from '../../types/investigation';

const CONV_ID = 'conv-verdicts-test';

function conv(): StoredConversation {
  const now = new Date('2026-02-04T08:00:00Z');
  return {
    id: CONV_ID,
    source: 'claude-code',
    name: 'verdicts fixture',
    summary: null,
    createdAt: now,
    updatedAt: now,
    importedAt: now,
    messageCount: 0,
    userMessageCount: 0,
    assistantMessageCount: 0,
    estimatedTokens: 0,
    fullText: '',
  };
}

let seq = 0;
function msg(sender: StoredMessage['sender'], blocks?: ContentBlock[], text = ''): StoredMessage {
  seq++;
  return {
    id: `v-msg-${seq}`,
    conversationId: CONV_ID,
    sender,
    text,
    contentBlocks: blocks,
    createdAt: new Date(Date.UTC(2026, 1, 4, 8, 0, seq)),
  };
}

function edit(path: string): ContentBlock {
  return {
    type: 'tool_use',
    toolName: 'Edit',
    toolInput: { file_path: path, old_string: 'a', new_string: 'b' },
  };
}

/** Two anchors in one conversation: /p/x.ts (step 1) and /p/y.ts (step 3). */
async function fixtureAnchors(): Promise<InvestigationAnchor[]> {
  await bulkPutConversations([conv()]);
  await storeRawSources([
    {
      kind: 'claude-code',
      filename: 'v.jsonl',
      rawText: 'raw-verdicts-payload',
      parserVersion: '1.1.0',
      conversationIds: [CONV_ID],
    },
  ]);
  await bulkPutMessages([
    msg('user', undefined, 'please fix both files'),
    msg('assistant', [edit('/p/x.ts')]),
    msg('assistant', undefined, 'now the second one'),
    msg('assistant', [edit('/p/y.ts')]),
  ]);
  return deriveAnchorsForConversation(CONV_ID);
}

const FULL_DRAFT: VerdictDraft = {
  origin: 'user_directed',
  status: 'active',
  confidence: 'high',
  rationale: 'I asked for exactly this change in the opening message.',
};

async function finalizableCase(anchor: InvestigationAnchor) {
  const caseRow = await startInvestigation(anchor);
  await pinToolEventExhibit(caseRow.id, anchor.stableKey);
  await pinTranscriptExhibit(caseRow.id, { stepIndex: 0, startOffset: 0, endOffset: 10 });
  await saveVerdictDraft(caseRow.id, FULL_DRAFT);
  return caseRow;
}

beforeEach(async () => {
  await clearAllData();
  seq = 0;
});

describe('validateVerdict — §8.8 evidence rules, reported exactly', () => {
  it('lists every missing requirement for an empty draft', async () => {
    const [anchor] = await fixtureAnchors();
    const caseRow = await startInvestigation(anchor);
    const missing = await validateVerdict(caseRow.id);
    expect(missing).toEqual([
      'Select an origin category',
      'Select a current status',
      'Select a confidence level',
      'Write your rationale in your own words',
      'Pin at least one code or tool exhibit',
    ]);
  });

  it('requires a transcript exhibit for explicit-direction categories', async () => {
    const [anchor] = await fixtureAnchors();
    const caseRow = await startInvestigation(anchor);
    await pinToolEventExhibit(caseRow.id, anchor.stableKey);
    await saveVerdictDraft(caseRow.id, FULL_DRAFT);
    // tool exhibit only → transcript requirement fires
    expect(await validateVerdict(caseRow.id)).toEqual([
      'This origin category requires at least one transcript exhibit',
    ]);
    await pinTranscriptExhibit(caseRow.id, { stepIndex: 0, startOffset: 0, endOffset: 6 });
    expect(await validateVerdict(caseRow.id)).toEqual([]);
  });

  it('requires a review scope for silence/indeterminate/inherited categories', async () => {
    const [anchor] = await fixtureAnchors();
    const caseRow = await startInvestigation(anchor);
    await pinToolEventExhibit(caseRow.id, anchor.stableKey);
    for (const origin of [
      'agent_implemented_without_recorded_discussion',
      'indeterminate',
      'inherited_default',
    ] as const) {
      await saveVerdictDraft(caseRow.id, { ...FULL_DRAFT, origin });
      expect(await validateVerdict(caseRow.id)).toEqual([
        'This origin category requires at least one confirmed review scope',
      ]);
    }
    await confirmReviewScope(caseRow.id, { startStepIndex: 0, endStepIndex: 3 });
    expect(await validateVerdict(caseRow.id)).toEqual([]);
  });
});

describe('finalize / reopen / refinalize — §8.9 immutability', () => {
  it('finalization snapshots evidence into revision 1 and adjudicates the case', async () => {
    const [anchor] = await fixtureAnchors();
    const caseRow = await finalizableCase(anchor);
    await recordCaseSearch(caseRow.id, { query: 'fix', resultCount: 3 });

    const revision = await finalizeVerdict(caseRow.id);
    expect(revision.revisionNumber).toBe(1);
    expect(revision.origin).toBe('user_directed');
    expect(revision.rationale).toBe(FULL_DRAFT.rationale);
    expect(revision.exhibitIds).toHaveLength(2);
    expect(revision.searchRecordIds).toHaveLength(1);
    expect((await getInvestigationCase(caseRow.id))?.state).toBe('adjudicated');

    // Adjudicated cases refuse further mutation until reopened.
    await expect(finalizeVerdict(caseRow.id)).rejects.toThrow('reopen');
    await expect(saveVerdictDraft(caseRow.id, { confidence: 'low' })).rejects.toThrow(
      'reopen'
    );
  });

  it('rejects finalization while requirements are missing', async () => {
    const [anchor] = await fixtureAnchors();
    const caseRow = await startInvestigation(anchor);
    await expect(finalizeVerdict(caseRow.id)).rejects.toThrow('not finalizable');
    expect(await getRevisionsForCase(caseRow.id)).toHaveLength(0);
  });

  it('reopen + refinalize creates revision 2 without mutating revision 1', async () => {
    const [anchor] = await fixtureAnchors();
    const caseRow = await finalizableCase(anchor);
    const rev1 = await finalizeVerdict(caseRow.id);

    await reopenCase(caseRow.id);
    expect((await getInvestigationCase(caseRow.id))?.state).toBe('reopened');

    await saveVerdictDraft(caseRow.id, {
      origin: 'agent_proposed_user_adopted',
      confidence: 'medium',
      rationale: 'On rereading, the agent proposed this and I said yes.',
    });
    const rev2 = await finalizeVerdict(caseRow.id);
    expect(rev2.revisionNumber).toBe(2);

    const stored = await getRevisionsForCase(caseRow.id);
    expect(stored).toHaveLength(2);
    expect(stored[0]).toEqual(rev1); // revision 1 byte-identical
    expect(stored[1].origin).toBe('agent_proposed_user_adopted');
  });

  it('reopen rejects non-adjudicated cases', async () => {
    const [anchor] = await fixtureAnchors();
    const caseRow = await startInvestigation(anchor);
    await expect(reopenCase(caseRow.id)).rejects.toThrow('adjudicated');
  });

  it('evidence referenced by a finalized revision cannot be removed after reopen', async () => {
    const [anchor] = await fixtureAnchors();
    const caseRow = await finalizableCase(anchor);
    await confirmReviewScope(caseRow.id, { startStepIndex: 0, endStepIndex: 1 });
    const rev = await finalizeVerdict(caseRow.id);
    await reopenCase(caseRow.id);

    await expect(removeDraftExhibit(caseRow.id, rev.exhibitIds[0])).rejects.toThrow(
      'finalized verdict revision'
    );
    await expect(
      removeDraftReviewScope(caseRow.id, rev.reviewScopeIds[0])
    ).rejects.toThrow('finalized verdict revision');
    expect(await db.caseExhibits.count()).toBe(2);
    expect(await db.reviewScopes.count()).toBe(1);
  });
});

describe('decision ledger — §9, finalized human verdicts only', () => {
  it('lists finalized cases with latest revision and counts; drafts never appear', async () => {
    const [anchorX, anchorY] = await fixtureAnchors();
    const adjudicated = await finalizableCase(anchorX);
    await finalizeVerdict(adjudicated.id);
    await startInvestigation(anchorY); // draft — must not appear

    const ledger = await listDecisionLedger();
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({
      caseId: adjudicated.id,
      revisionCount: 1,
      caseState: 'adjudicated',
      filePaths: ['/p/x.ts'],
      exhibitCount: 2,
    });
    expect(ledger[0].latest.rationale).toBe(FULL_DRAFT.rationale);
  });
});

describe('coverage — §10, factual counts only', () => {
  it('counts anchors per file path by derived state with last adjudication time', async () => {
    const [anchorX, anchorY] = await fixtureAnchors();
    const caseRow = await finalizableCase(anchorX);
    const rev = await finalizeVerdict(caseRow.id);
    await startInvestigation(anchorY); // open

    const coverage = await getInvestigationCoverage();
    expect(coverage.totals).toEqual({
      totalAnchors: 2,
      uninvestigated: 0,
      open: 1,
      adjudicated: 1,
    });
    const x = coverage.files.find((f) => f.filePath === '/p/x.ts');
    const y = coverage.files.find((f) => f.filePath === '/p/y.ts');
    expect(x).toMatchObject({ totalAnchors: 1, adjudicated: 1, open: 0, uninvestigated: 0 });
    expect(x?.lastAdjudicatedAt).toEqual(rev.finalizedAt);
    expect(y).toMatchObject({ totalAnchors: 1, open: 1 });
    expect(y?.lastAdjudicatedAt).toBeUndefined();
  });
});

describe('continuation — §8.10, real neighbors only', () => {
  it('finds chronological uninvestigated neighbors and same-file anchors', async () => {
    const [anchorX, anchorY] = await fixtureAnchors();
    const targets = await getContinuationTargets(anchorX);
    expect(targets.nextUninvestigated?.id).toBe(anchorY.id);
    expect(targets.previousUninvestigated).toBeUndefined();
    expect(targets.sameFile).toHaveLength(0); // different files in this fixture

    const caseRow = await finalizableCase(anchorY);
    await finalizeVerdict(caseRow.id);
    const after = await getContinuationTargets(anchorX);
    expect(after.nextUninvestigated).toBeUndefined(); // y is adjudicated now
  });
});

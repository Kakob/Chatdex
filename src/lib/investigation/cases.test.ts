import { describe, it, expect, beforeEach } from 'vitest';
import {
  db,
  clearAllData,
  bulkPutConversations,
  bulkPutMessages,
  storeRawSources,
  putInvestigationCase,
  getInvestigationCase,
} from '../db/index';
import { deriveAnchorsForConversation } from './anchors';
import {
  startInvestigation,
  caseTitleTemplate,
  updateCaseHumanFields,
  pinTranscriptExhibit,
  pinToolEventExhibit,
  pinCodeExhibit,
  removeDraftExhibit,
  recordCaseSearch,
  confirmReviewScope,
  removeDraftReviewScope,
  resolveExhibit,
  getCaseStatesByAnchor,
} from './cases';
import { stepDisplayText } from './search';
import { normalizeSession } from '../detection/normalize';
import { getMessagesForConversation } from '../db/messages';
import type { ContentBlock, StoredConversation, StoredMessage } from '../../types/unified';
import type { InvestigationAnchor } from '../../types/investigation';

const CONV_ID = 'conv-cases-test';

function conv(): StoredConversation {
  const now = new Date('2026-02-03T08:00:00Z');
  return {
    id: CONV_ID,
    source: 'claude-code',
    name: 'cases fixture',
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
    id: `case-msg-${seq}`,
    conversationId: CONV_ID,
    sender,
    text,
    contentBlocks: blocks,
    createdAt: new Date(Date.UTC(2026, 1, 3, 8, 0, seq)),
  };
}

async function fixtureAnchor(): Promise<InvestigationAnchor> {
  await bulkPutConversations([conv()]);
  await storeRawSources([
    {
      kind: 'claude-code',
      filename: 'cases.jsonl',
      rawText: 'raw-cases-payload',
      parserVersion: '1.1.0',
      conversationIds: [CONV_ID],
    },
  ]);
  await bulkPutMessages([
    msg('user', undefined, 'please rename the handler function'),
    msg('assistant', [
      {
        type: 'tool_use',
        toolName: 'MultiEdit',
        toolInput: {
          file_path: '/p/handler.ts',
          edits: [
            { old_string: 'line one\nline two\nline three', new_string: 'ONE\nTWO' },
            { old_string: 'other', new_string: 'OTHER' },
          ],
        },
        toolUseId: 'toolu_cases',
      },
    ]),
    msg('assistant', undefined, 'done, renamed everywhere'),
  ]);
  const [anchor] = await deriveAnchorsForConversation(CONV_ID);
  return anchor;
}

async function displayTexts(): Promise<string[]> {
  const messages = await getMessagesForConversation(CONV_ID);
  return normalizeSession(CONV_ID, messages).steps.map(stepDisplayText);
}

beforeEach(async () => {
  await clearAllData();
  seq = 0;
});

describe('startInvestigation (SPEC §8.3)', () => {
  it('creates a draft case with the deterministic literal title template', async () => {
    const anchor = await fixtureAnchor();
    const caseRow = await startInvestigation(anchor);
    expect(caseRow.state).toBe('draft');
    expect(caseRow.title).toBe(caseTitleTemplate(anchor));
    expect(caseRow.title).toBe('Investigate MultiEdit: /p/handler.ts');
    expect(caseRow.primaryAnchorStableKey).toBe(anchor.stableKey);
    expect(caseRow.notes).toBe('');
    expect(caseRow.searchRecords).toEqual([]);
  });

  it('is idempotent per anchor — starting again returns the existing case', async () => {
    const anchor = await fixtureAnchor();
    const first = await startInvestigation(anchor);
    const second = await startInvestigation(anchor);
    expect(second.id).toBe(first.id);
    expect(await db.investigationCases.count()).toBe(1);
  });
});

describe('updateCaseHumanFields', () => {
  it('updates title and notes, rejects empty titles', async () => {
    const anchor = await fixtureAnchor();
    const caseRow = await startInvestigation(anchor);
    const updated = await updateCaseHumanFields(caseRow.id, {
      title: 'Why was the handler renamed?',
      notes: 'my own words',
    });
    expect(updated.title).toBe('Why was the handler renamed?');
    expect(updated.notes).toBe('my own words');
    await expect(updateCaseHumanFields(caseRow.id, { title: '  ' })).rejects.toThrow(
      'empty'
    );
  });

  it('rejects edits to adjudicated cases', async () => {
    const anchor = await fixtureAnchor();
    const caseRow = await startInvestigation(anchor);
    await putInvestigationCase({ ...caseRow, state: 'adjudicated' });
    await expect(updateCaseHumanFields(caseRow.id, { notes: 'x' })).rejects.toThrow(
      'adjudicated'
    );
  });
});

describe('pinTranscriptExhibit (SPEC §8.4)', () => {
  it('recomputes selected text and hash from the source, never trusting the caller', async () => {
    const anchor = await fixtureAnchor();
    const caseRow = await startInvestigation(anchor);
    const texts = await displayTexts();
    // Step 0 is the user's message.
    const exhibit = await pinTranscriptExhibit(caseRow.id, {
      stepIndex: 0,
      startOffset: 7,
      endOffset: 13,
    });
    expect(exhibit.selectedText).toBe(texts[0].slice(7, 13));
    expect(exhibit.selectedContentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(exhibit.offsetEncoding).toBe('utf16');
    expect(exhibit.sourceContentHash).toBe(anchor.sourceContentHash);
  });

  it('rejects out-of-bounds, inverted, and empty spans', async () => {
    const anchor = await fixtureAnchor();
    const caseRow = await startInvestigation(anchor);
    const texts = await displayTexts();
    await expect(
      pinTranscriptExhibit(caseRow.id, { stepIndex: 0, startOffset: 0, endOffset: texts[0].length + 1 })
    ).rejects.toThrow('Invalid span');
    await expect(
      pinTranscriptExhibit(caseRow.id, { stepIndex: 0, startOffset: 5, endOffset: 5 })
    ).rejects.toThrow('Invalid span');
    await expect(
      pinTranscriptExhibit(caseRow.id, { stepIndex: 99, startOffset: 0, endOffset: 1 })
    ).rejects.toThrow('No source event');
  });
});

describe('code exhibits (SPEC §8.5)', () => {
  it('pins a whole tool event with the exact rendered payload', async () => {
    const anchor = await fixtureAnchor();
    const caseRow = await startInvestigation(anchor);
    const texts = await displayTexts();
    const exhibit = await pinToolEventExhibit(caseRow.id, anchor.stableKey);
    expect(exhibit.kind).toBe('tool_event');
    expect(exhibit.selectedText).toBe(texts[anchor.stepIndex]);
  });

  it('pins a line range within a hunk side and validates bounds', async () => {
    const anchor = await fixtureAnchor();
    const caseRow = await startInvestigation(anchor);
    const exhibit = await pinCodeExhibit(caseRow.id, {
      anchorStableKey: anchor.stableKey,
      changeIndex: 0,
      codeSide: 'before',
      startLine: 2,
      endLine: 3,
    });
    expect(exhibit.selectedText).toBe('line two\nline three');
    expect(exhibit.filePath).toBe('/p/handler.ts');

    await expect(
      pinCodeExhibit(caseRow.id, {
        anchorStableKey: anchor.stableKey,
        changeIndex: 0,
        codeSide: 'before',
        startLine: 2,
        endLine: 99,
      })
    ).rejects.toThrow('Invalid line range');
    await expect(
      pinCodeExhibit(caseRow.id, {
        anchorStableKey: anchor.stableKey,
        changeIndex: 7,
        codeSide: 'after',
      })
    ).rejects.toThrow('No file change');
  });
});

describe('exhibit resolution (SPEC §8.4 — source is the authority)', () => {
  it('resolves an intact exhibit from source and flags tampered content', async () => {
    const anchor = await fixtureAnchor();
    const caseRow = await startInvestigation(anchor);
    const texts = await displayTexts();
    const exhibit = await pinTranscriptExhibit(caseRow.id, {
      stepIndex: 0,
      startOffset: 0,
      endOffset: 6,
    });

    expect(await resolveExhibit(exhibit, texts)).toEqual({
      status: 'ok',
      text: texts[0].slice(0, 6),
    });

    // Source changed under the exhibit → mismatch, cached copy retained,
    // never silently relocated.
    const tampered = [...texts];
    tampered[0] = 'entirely different text';
    const resolution = await resolveExhibit(exhibit, tampered);
    expect(resolution.status).toBe('source_mismatch');
    if (resolution.status === 'source_mismatch') {
      expect(resolution.cachedText).toBe(exhibit.selectedText);
    }
  });
});

describe('search records and review scopes (SPEC §8.6–§8.7)', () => {
  it('appends verbatim search records', async () => {
    const anchor = await fixtureAnchor();
    const caseRow = await startInvestigation(anchor);
    await recordCaseSearch(caseRow.id, { query: 'rename.*handler', resultCount: 0 });
    const updated = await getInvestigationCase(caseRow.id);
    expect(updated?.searchRecords).toHaveLength(1);
    expect(updated?.searchRecords[0]).toMatchObject({
      query: 'rename.*handler', // literal text, exactly as typed
      mode: 'literal',
      resultCount: 0,
    });
  });

  it('confirms ordered review scopes and captures prior search records', async () => {
    const anchor = await fixtureAnchor();
    const caseRow = await startInvestigation(anchor);
    await recordCaseSearch(caseRow.id, { query: 'rename', resultCount: 2 });
    const scope = await confirmReviewScope(caseRow.id, {
      startStepIndex: 0,
      endStepIndex: 2,
    });
    expect(scope.eventCount).toBe(3);
    expect(scope.startMessageId).toBe('case-msg-1');
    expect(scope.endMessageId).toBe('case-msg-3');
    expect(scope.includedSearchRecordIds).toHaveLength(1);

    await expect(
      confirmReviewScope(caseRow.id, { startStepIndex: 2, endStepIndex: 0 })
    ).rejects.toThrow('Invalid review range');
    await expect(
      confirmReviewScope(caseRow.id, { startStepIndex: 0, endStepIndex: 99 })
    ).rejects.toThrow('Invalid review range');
  });

  it('removes draft exhibits and scopes but verifies ownership', async () => {
    const anchor = await fixtureAnchor();
    const caseRow = await startInvestigation(anchor);
    const exhibit = await pinToolEventExhibit(caseRow.id, anchor.stableKey);
    const scope = await confirmReviewScope(caseRow.id, {
      startStepIndex: 0,
      endStepIndex: 1,
    });

    await expect(removeDraftExhibit(caseRow.id, 'nope')).rejects.toThrow('belong');
    await removeDraftExhibit(caseRow.id, exhibit.id);
    await removeDraftReviewScope(caseRow.id, scope.id);
    expect(await db.caseExhibits.count()).toBe(0);
    expect(await db.reviewScopes.count()).toBe(0);
  });
});

describe('getCaseStatesByAnchor', () => {
  it('maps primary and linked anchors to their case state', async () => {
    const anchor = await fixtureAnchor();
    const caseRow = await startInvestigation(anchor);
    await putInvestigationCase({
      ...caseRow,
      linkedAnchorStableKeys: ['other-anchor#s9'],
    });
    const map = await getCaseStatesByAnchor();
    expect(map.get(anchor.stableKey)).toBe('draft');
    expect(map.get('other-anchor#s9')).toBe('draft');
  });
});

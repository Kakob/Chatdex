import { describe, it, expect, beforeEach } from 'vitest';
import {
  db,
  clearAllData,
  bulkPutConversations,
  bulkPutMessages,
  storeRawSources,
  listInvestigationAnchors,
  getInvestigationAnchorsForFile,
  deleteConversation,
} from '../db/index';
import { deriveAnchorsForConversation, ANCHOR_DERIVER_VERSION } from './anchors';
import { sha256Hex } from '../utils/hash';
import type { ContentBlock, StoredConversation, StoredMessage } from '../../types/unified';

const CONV_ID = 'conv-anchor-test';

function conv(id = CONV_ID): StoredConversation {
  const now = new Date('2026-02-01T10:00:00Z');
  return {
    id,
    source: 'claude-code',
    name: 'anchor fixture',
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

let msgSeq = 0;
function msg(
  sender: StoredMessage['sender'],
  blocks: ContentBlock[] | undefined,
  text = '',
  conversationId = CONV_ID
): StoredMessage {
  msgSeq++;
  return {
    id: `msg-${msgSeq}`,
    conversationId,
    sender,
    text,
    contentBlocks: blocks,
    createdAt: new Date(Date.UTC(2026, 1, 1, 10, 0, msgSeq)),
  };
}

const editBlock: ContentBlock = {
  type: 'tool_use',
  toolName: 'Edit',
  toolInput: { file_path: '/proj/src/a.ts', old_string: 'x', new_string: 'y' },
  toolUseId: 'toolu_edit_1',
};

beforeEach(async () => {
  await clearAllData();
  msgSeq = 0;
  await bulkPutConversations([conv()]);
});

describe('deriveAnchorsForConversation — deterministic anchors (SPEC §7.3)', () => {
  it('creates one anchor per structured edit, keyed to the raw source hash', async () => {
    const rawText = 'raw-jsonl-payload';
    await storeRawSources([
      {
        kind: 'claude-code',
        filename: 's.jsonl',
        rawText,
        parserVersion: '1.1.0',
        conversationIds: [CONV_ID],
      },
    ]);
    await bulkPutMessages([
      msg('user', undefined, 'please edit'),
      msg('assistant', [editBlock]),
    ]);

    const anchors = await deriveAnchorsForConversation(CONV_ID);
    expect(anchors).toHaveLength(1);

    const anchor = anchors[0];
    const rawHash = await sha256Hex(rawText);
    expect(anchor.stableKey).toBe(`${rawHash}#s1`);
    expect(anchor.id).toBe(anchor.stableKey);
    expect(anchor.sourceProvenance).toBe('raw');
    expect(anchor.sourceContentHash).toBe(rawHash);
    expect(anchor.kind).toBe('edit');
    expect(anchor.toolUseId).toBe('toolu_edit_1');
    expect(anchor.deriverVersion).toBe(ANCHOR_DERIVER_VERSION);
    expect(anchor.fileChanges).toEqual([
      {
        path: '/proj/src/a.ts',
        changeIndex: 0,
        oldString: 'x',
        newString: 'y',
        contentHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      },
    ]);
    expect(anchor.occurredAt).toEqual(new Date(Date.UTC(2026, 1, 1, 10, 0, 2)));
  });

  it('falls back to conversation-keyed legacy identity when no raw source exists', async () => {
    await bulkPutMessages([msg('assistant', [editBlock])]);
    const [anchor] = await deriveAnchorsForConversation(CONV_ID);
    expect(anchor.stableKey).toBe(`conv:${CONV_ID}#s0`);
    expect(anchor.sourceProvenance).toBe('legacy');
    expect(anchor.sourceContentHash).toBeUndefined();
  });

  it('represents a MultiEdit as one anchor with ordered child file changes', async () => {
    await bulkPutMessages([
      msg('assistant', [
        {
          type: 'tool_use',
          toolName: 'MultiEdit',
          toolInput: {
            file_path: '/proj/src/b.ts',
            edits: [
              { old_string: 'one', new_string: 'ONE' },
              { old_string: 'two', new_string: 'TWO' },
            ],
          },
        },
      ]),
    ]);
    const anchors = await deriveAnchorsForConversation(CONV_ID);
    expect(anchors).toHaveLength(1);
    expect(anchors[0].kind).toBe('multi_edit');
    expect(anchors[0].fileChanges.map((c) => c.changeIndex)).toEqual([0, 1]);
    expect(anchors[0].filePaths).toEqual(['/proj/src/b.ts']);
  });

  it('distinguishes a Write (no oldString) from an Edit to empty-old-string', async () => {
    await bulkPutMessages([
      msg('assistant', [
        {
          type: 'tool_use',
          toolName: 'Write',
          toolInput: { file_path: '/proj/c.ts', content: 'body' },
        },
        {
          type: 'tool_use',
          toolName: 'Edit',
          toolInput: { file_path: '/proj/c.ts', old_string: '', new_string: 'body' },
        },
      ]),
    ]);
    const anchors = await deriveAnchorsForConversation(CONV_ID);
    expect(anchors).toHaveLength(2);
    const [write, edit] = anchors;
    expect(write.kind).toBe('write');
    expect(edit.kind).toBe('edit');
    expect(write.fileChanges[0].contentHash).not.toBe(edit.fileChanges[0].contentHash);
  });

  it('never anchors shell commands or non-edit tools (SPEC §7.3)', async () => {
    await bulkPutMessages([
      msg('assistant', [
        {
          type: 'tool_use',
          toolName: 'Bash',
          toolInput: { command: 'echo pwned > /proj/src/a.ts' },
        },
        { type: 'tool_use', toolName: 'Read', toolInput: { file_path: '/proj/src/a.ts' } },
      ]),
    ]);
    expect(await deriveAnchorsForConversation(CONV_ID)).toHaveLength(0);
  });

  it('is idempotent: re-deriving produces identical ids and no duplicates', async () => {
    await bulkPutMessages([msg('assistant', [editBlock])]);
    const first = await deriveAnchorsForConversation(CONV_ID);
    const second = await deriveAnchorsForConversation(CONV_ID);
    expect(second.map((a) => a.id)).toEqual(first.map((a) => a.id));
    expect(await db.investigationAnchors.count()).toBe(1);
  });

  it('lists anchors chronologically and looks them up by file path', async () => {
    await bulkPutMessages([
      msg('assistant', [editBlock]),
      msg('assistant', [
        {
          type: 'tool_use',
          toolName: 'Write',
          toolInput: { file_path: '/proj/src/z.ts', content: 'zzz' },
        },
      ]),
    ]);
    await deriveAnchorsForConversation(CONV_ID);

    const asc = await listInvestigationAnchors({ conversationId: CONV_ID });
    expect(asc.map((a) => a.stepIndex)).toEqual([0, 1]);
    const desc = await listInvestigationAnchors({ order: 'desc' });
    expect(desc.map((a) => a.stepIndex)).toEqual([1, 0]);

    const byFile = await getInvestigationAnchorsForFile('/proj/src/z.ts');
    expect(byFile).toHaveLength(1);
    expect(byFile[0].kind).toBe('write');
  });

  it('cascades derived anchors on conversation deletion', async () => {
    await bulkPutMessages([msg('assistant', [editBlock])]);
    await deriveAnchorsForConversation(CONV_ID);
    expect(await db.investigationAnchors.count()).toBe(1);
    await deleteConversation(CONV_ID);
    expect(await db.investigationAnchors.count()).toBe(0);
  });
});

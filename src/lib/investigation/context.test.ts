import { describe, it, expect, beforeEach } from 'vitest';
import { clearAllData, bulkPutConversations, bulkPutMessages } from '../db/index';
import { deriveAnchorsForConversation } from './anchors';
import { getInvestigationContext } from './context';
import type { ContentBlock, StoredConversation, StoredMessage } from '../../types/unified';

const CONV_ID = 'conv-ctx-test';

function conv(): StoredConversation {
  const now = new Date('2026-02-02T09:00:00Z');
  return {
    id: CONV_ID,
    source: 'claude-code',
    name: 'context fixture',
    summary: null,
    createdAt: now,
    updatedAt: now,
    importedAt: now,
    messageCount: 3,
    userMessageCount: 1,
    assistantMessageCount: 1,
    estimatedTokens: 0,
    fullText: '',
  };
}

let seq = 0;
function msg(sender: StoredMessage['sender'], blocks?: ContentBlock[], text = ''): StoredMessage {
  seq++;
  return {
    id: `ctx-msg-${seq}`,
    conversationId: CONV_ID,
    sender,
    text,
    contentBlocks: blocks,
    createdAt: new Date(Date.UTC(2026, 1, 2, 9, 0, seq)),
  };
}

beforeEach(async () => {
  await clearAllData();
  seq = 0;
  await bulkPutConversations([conv()]);
  await bulkPutMessages([
    msg('user', undefined, 'please change the file'),
    msg('assistant', [
      {
        type: 'tool_use',
        toolName: 'Edit',
        toolInput: { file_path: '/p/a.ts', old_string: 'x', new_string: 'y' },
        toolUseId: 'toolu_ctx',
      },
    ]),
    msg('assistant', undefined, 'done'),
  ]);
});

describe('getInvestigationContext (SPEC §12)', () => {
  it('returns the anchor, conversation, full step stream, and siblings', async () => {
    const [anchor] = await deriveAnchorsForConversation(CONV_ID);
    const ctx = await getInvestigationContext(anchor.id);

    expect(ctx).not.toBeNull();
    expect(ctx!.anchor.id).toBe(anchor.id);
    expect(ctx!.conversation.id).toBe(CONV_ID);
    // The entire source is reachable — every step, in order.
    expect(ctx!.steps.map((ws) => ws.step.index)).toEqual([0, 1, 2]);
    // The anchor's step is the tool call, and alignment holds.
    const anchorStep = ctx!.steps[ctx!.anchor.stepIndex].step;
    expect(anchorStep.kind).toBe('tool_call');
    expect(anchorStep.toolUseId).toBe('toolu_ctx');
    expect(anchorStep.editHunks).toHaveLength(1);
    // Timestamps come from the backing messages.
    expect(ctx!.steps[0].occurredAt).toEqual(new Date(Date.UTC(2026, 1, 2, 9, 0, 1)));
    expect(ctx!.siblingAnchors.map((a) => a.id)).toEqual([anchor.id]);
  });

  it('returns null for an unknown anchor id', async () => {
    expect(await getInvestigationContext('nope#s0')).toBeNull();
  });

  it('returns null when the anchored conversation was deleted out from under it', async () => {
    const [anchor] = await deriveAnchorsForConversation(CONV_ID);
    // Simulate a stale anchor row (normally cascaded) pointing at a gone conversation.
    const { db } = await import('../db/index');
    await db.conversations.delete(CONV_ID);
    expect(await getInvestigationContext(anchor.id)).toBeNull();
  });
});

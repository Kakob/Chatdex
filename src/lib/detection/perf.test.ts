import { beforeEach, describe, expect, it } from 'vitest';
import { clearAllData, bulkPutConversations, bulkPutMessages } from '../db';
import { registerAllDetectors } from './registerAll';
import { computeDetectorRun } from './pipeline';
import type { StoredConversation, StoredMessage } from '../../types/unified';

// SPEC §4 / §9: a full three-detector pass over a 10k-step session must
// finish in under 5 seconds. This uses the REAL detector suite (the Phase 2
// perf test used a stub) over a session with representative structure:
// task blocks with reads, edits, repeated failing tests (loop work),
// revert pairs (reversion work), and unverified tails (verification work).

const SESSION_ID = 'perf-10k';

function makeConversation(): StoredConversation {
  const now = new Date('2026-07-01T10:00:00Z');
  return {
    id: SESSION_ID,
    source: 'claude-code',
    name: 'perf session',
    summary: null,
    createdAt: now,
    updatedAt: now,
    importedAt: now,
    messageCount: 10_000,
    userMessageCount: 400,
    assistantMessageCount: 2000,
    estimatedTokens: 1,
    fullText: '',
  };
}

function makeSteps(total: number): StoredMessage[] {
  const base = new Date('2026-07-01T10:00:00Z').getTime();
  const messages: StoredMessage[] = [];
  let block = 0;

  const push = (partial: Omit<StoredMessage, 'id' | 'conversationId' | 'createdAt'>) => {
    messages.push({
      id: `m${messages.length}`,
      conversationId: SESSION_ID,
      createdAt: new Date(base + messages.length * 1000),
      ...partial,
    });
  };
  const tool = (name: string, input: Record<string, unknown>) =>
    push({
      sender: 'tool',
      text: `[Tool: ${name}]`,
      contentBlocks: [{ type: 'tool_use', toolName: name, toolInput: input }],
    });
  const result = (name: string, text: string) =>
    push({
      sender: 'tool',
      text: `[Tool Result: ${name}]`,
      contentBlocks: [{ type: 'tool_result', toolName: name, toolResult: text }],
    });

  while (messages.length < total) {
    block++;
    push({ sender: 'user', text: `task ${block}` });
    // Reads with varying paths.
    for (let i = 0; i < 3 && messages.length < total; i++) {
      tool('Read', { file_path: `/app/src/mod${block % 40}/file${i}.ts` });
      result('Read', 'export const x = 1'.repeat(5));
    }
    // A repeated failing test — loop candidates within the block.
    for (let i = 0; i < 3 && messages.length < total; i++) {
      tool('Bash', { command: `npm test -- block${block % 7}` });
      result('Bash', 'FAIL expected 1 to be 2');
    }
    // An edit and, every third block, its exact revert (reversion work).
    tool('Edit', {
      file_path: `/app/src/mod${block % 40}/file0.ts`,
      old_string: `const v = ${block}`,
      new_string: `const v = ${block + 1}`,
    });
    result('Edit', 'Edit applied');
    if (block % 3 === 0 && messages.length < total) {
      tool('Edit', {
        file_path: `/app/src/mod${block % 40}/file0.ts`,
        old_string: `const v = ${block + 1}`,
        new_string: `const v = ${block}`,
      });
      result('Edit', 'Edit applied');
    }
    // Half the blocks verify; half leave the edit unverified until the next
    // user message (verification-absence work).
    if (block % 2 === 0 && messages.length < total) {
      tool('Bash', { command: 'npm run typecheck' });
      result('Bash', 'no errors');
    } else {
      push({ sender: 'assistant', text: 'That should fix it for this block.' });
    }
  }
  return messages.slice(0, total);
}

beforeEach(async () => {
  await clearAllData();
  registerAllDetectors();
  await bulkPutConversations([makeConversation()]);
  await bulkPutMessages(makeSteps(10_000));
});

describe('performance — real detector suite over 10k steps', () => {
  it('completes a full three-detector pass in under 5 seconds', async () => {
    const started = performance.now();
    const result = await computeDetectorRun(SESSION_ID);
    const elapsed = performance.now() - started;

    expect(result.skipped).toBe(false);
    expect(result.run?.errors).toBeUndefined();
    // Real work happened: all three detectors produced findings.
    const detectors = new Set(result.findings.map((f) => f.detector));
    expect(detectors).toEqual(
      new Set(['loop', 'verification_absence', 'silent_reversion'])
    );
    expect(elapsed).toBeLessThan(5_000);
  }, 30_000);
});

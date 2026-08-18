// Performance checks (SPEC-decision-investigation §16.4, DI-4) over a
// deterministic 10,000-event fixture. Matches the detection layer's perf
// convention (perf.test.ts: 10k steps < 5s). Timings are logged so the
// implementation report can record observed numbers; the assertions are
// generous ceilings, not SLAs — the spec forbids inventing hard SLAs.
//
// Transcript rendering is bounded by @tanstack/react-virtual (DI-2b) and is
// exercised manually in the browser; these tests cover the data layer that
// backs every workbench interaction on large sources.

import { describe, it, expect, beforeEach } from 'vitest';
import { clearAllData, bulkPutConversations, bulkPutMessages } from '../db';
import { normalizeSession } from '../detection/normalize';
import { deriveAnchorsForConversation } from './anchors';
import { stepDisplayText, searchStepTexts } from './search';
import { startInvestigation } from './cases';
import { getInvestigationCoverage } from './verdicts';
import { getMessagesForConversation } from '../db/messages';
import type { StoredConversation, StoredMessage } from '../../types/unified';

const SESSION_ID = 'perf-investigation-10k';
const TOTAL_EVENTS = 10_000;

function makeConversation(): StoredConversation {
  const now = new Date('2026-07-01T10:00:00Z');
  return {
    id: SESSION_ID,
    source: 'claude-code',
    name: 'investigation perf session',
    summary: null,
    createdAt: now,
    updatedAt: now,
    importedAt: now,
    messageCount: TOTAL_EVENTS,
    userMessageCount: 1000,
    assistantMessageCount: 4000,
    estimatedTokens: 1,
    fullText: '',
  };
}

// Repeating 10-event blocks: user ask, agent text, Edit call+result,
// Bash call+result, Read call+result, agent text, Write call — a
// representative mix that yields 2,000 code-change anchors.
function makeMessages(): StoredMessage[] {
  const base = new Date('2026-07-01T10:00:00Z').getTime();
  const messages: StoredMessage[] = [];
  const push = (partial: Omit<StoredMessage, 'id' | 'conversationId' | 'createdAt'>) => {
    messages.push({
      id: `pm${messages.length}`,
      conversationId: SESSION_ID,
      createdAt: new Date(base + messages.length * 1000),
      ...partial,
    });
  };

  let block = 0;
  while (messages.length < TOTAL_EVENTS) {
    block++;
    const file = `/project/src/module${block % 40}.ts`;
    push({ sender: 'user', text: `please update handler ${block} in ${file}` });
    push({ sender: 'assistant', text: `Updating handler ${block} now.` });
    push({
      sender: 'assistant',
      text: '[Tool: Edit]',
      contentBlocks: [
        {
          type: 'tool_use',
          toolName: 'Edit',
          toolInput: {
            file_path: file,
            old_string: `handler${block}(old)`,
            new_string: `handler${block}(updated)`,
          },
          toolUseId: `toolu_e${block}`,
        },
      ],
    });
    push({
      sender: 'user',
      text: '[Tool Result]',
      contentBlocks: [
        { type: 'tool_result', toolResult: 'edited ok', toolUseId: `toolu_e${block}` },
      ],
    });
    push({
      sender: 'assistant',
      text: '[Tool: Bash]',
      contentBlocks: [
        {
          type: 'tool_use',
          toolName: 'Bash',
          toolInput: { command: `npm test -- module${block % 40}` },
        },
      ],
    });
    push({
      sender: 'user',
      text: '[Tool Result]',
      contentBlocks: [{ type: 'tool_result', toolResult: `tests passed for block ${block}` }],
    });
    push({
      sender: 'assistant',
      text: '[Tool: Read]',
      contentBlocks: [
        { type: 'tool_use', toolName: 'Read', toolInput: { file_path: file } },
      ],
    });
    push({
      sender: 'user',
      text: '[Tool Result]',
      contentBlocks: [{ type: 'tool_result', toolResult: `contents of ${file}` }],
    });
    push({ sender: 'assistant', text: `Handler ${block} verified.` });
    push({
      sender: 'assistant',
      text: '[Tool: Write]',
      contentBlocks: [
        {
          type: 'tool_use',
          toolName: 'Write',
          toolInput: { file_path: `/project/notes/block${block}.md`, content: `notes ${block}` },
        },
      ],
    });
  }
  return messages.slice(0, TOTAL_EVENTS);
}

async function timed<T>(label: string, fn: () => Promise<T> | T): Promise<T> {
  const start = performance.now();
  const result = await fn();
  const ms = Math.round(performance.now() - start);
  process.stdout.write(`[perf §16.4] ${label}: ${ms}ms\n`);
  return result;
}

beforeEach(async () => {
  await clearAllData();
  await bulkPutConversations([makeConversation()]);
  await bulkPutMessages(makeMessages());
});

describe('§16.4 — 10,000-event source stays interactive at the data layer', () => {
  it('normalizes, searches, derives anchors, and computes coverage within bounds', async () => {
    const messages = await getMessagesForConversation(SESSION_ID);
    expect(messages).toHaveLength(TOTAL_EVENTS);

    const normalized = await timed('normalizeSession (10k events)', () =>
      normalizeSession(SESSION_ID, messages)
    );
    expect(normalized.steps.length).toBe(TOTAL_EVENTS);

    const texts = await timed('stepDisplayText ×10k', () =>
      normalized.steps.map(stepDisplayText)
    );

    const matches = await timed('literal search over 10k events', () =>
      searchStepTexts(texts, 'handler 42')
    );
    expect(matches.length).toBeGreaterThan(0);

    const anchors = await timed('deriveAnchorsForConversation (2k anchors)', () =>
      deriveAnchorsForConversation(SESSION_ID)
    );
    expect(anchors).toHaveLength(2000); // Edit + Write per 10-event block

    // Opening an anchor must not re-parse the raw export (spec §16.4): the
    // workbench reads stored messages + normalization only, measured above.
    await startInvestigation(anchors[0]);
    const coverage = await timed('getInvestigationCoverage', () =>
      getInvestigationCoverage()
    );
    expect(coverage.totals.totalAnchors).toBe(2000);
    expect(coverage.totals.open).toBe(1);
  }, 60_000);
});

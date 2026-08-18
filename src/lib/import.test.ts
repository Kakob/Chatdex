import { describe, expect, it, beforeEach } from 'vitest';
import { importFiles, selectAutoAnalyzeIds } from './import';
import { db, clearAllData, getRawSourcesForConversation } from './db/index';
import type { DataSource, StoredConversation } from '../types';

function conv(id: string, source: DataSource): StoredConversation {
  const now = new Date();
  return {
    id,
    source,
    name: id,
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

describe('selectAutoAnalyzeIds — auto-analysis is gated to agent sessions', () => {
  it('keeps claude-code sessions and drops chat-only sources', () => {
    const conversations = [
      conv('cc-1', 'claude-code'),
      conv('ai-1', 'claude.ai'),
      conv('gpt-1', 'chatgpt'),
      conv('cdx-1', 'codex'),
    ];
    const added = ['cc-1', 'ai-1', 'gpt-1', 'cdx-1'];
    expect(selectAutoAnalyzeIds(conversations, added)).toEqual(['cc-1']);
  });

  it('only analyzes newly added conversations, not re-imported duplicates', () => {
    const conversations = [conv('cc-1', 'claude-code'), conv('cc-2', 'claude-code')];
    expect(selectAutoAnalyzeIds(conversations, ['cc-2'])).toEqual(['cc-2']);
  });

  it('returns empty for a chat-only import batch', () => {
    const conversations = [conv('ai-1', 'claude.ai'), conv('gpt-1', 'chatgpt')];
    expect(selectAutoAnalyzeIds(conversations, ['ai-1', 'gpt-1'])).toEqual([]);
  });
});

// DI-1a (SPEC-decision-investigation §7.1): the import flow retains the
// verbatim payload, content-hash-deduped, independently of conversation dedup.
describe('importFiles — raw source retention', () => {
  const entry = (type: string, extra: Record<string, unknown>) =>
    JSON.stringify({ type, timestamp: '2026-01-15T10:00:00Z', ...extra });

  const baseLines = [
    entry('user', {
      sessionId: 'session-raw-1',
      cwd: '/project',
      message: { content: 'Please edit the file' },
    }),
    entry('assistant', {
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'toolu_raw_1',
            name: 'Edit',
            input: { file_path: '/a.ts', old_string: 'x', new_string: 'y' },
          },
        ],
      },
    }),
  ];

  function jsonlFile(lines: string[], name = 'session.jsonl'): File {
    return new File([lines.join('\n')], name, { type: 'application/x-jsonlines' });
  }

  beforeEach(async () => {
    await clearAllData();
  });

  it('retains the raw payload once and dedups a byte-identical re-import', async () => {
    const first = await importFiles([jsonlFile(baseLines)]);
    expect(first.conversationsAdded).toBe(1);
    expect(first.rawSourcesAdded).toBe(1);

    const second = await importFiles([jsonlFile(baseLines)]);
    expect(second.conversationsAdded).toBe(0);
    expect(second.conversationsSkipped).toBe(1);
    expect(second.rawSourcesAdded).toBe(0);
    expect(await db.rawSources.count()).toBe(1);

    const sources = await getRawSourcesForConversation('session-raw-1');
    expect(sources).toHaveLength(1);
    expect(sources[0].rawText).toBe(baseLines.join('\n'));
    expect(sources[0].parserVersion).toBeTruthy();
    expect(sources[0].contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('records a grown session file as a new raw version even though the conversation is skipped', async () => {
    await importFiles([jsonlFile(baseLines)]);

    const grownLines = [
      ...baseLines,
      entry('user', {
        message: {
          content: [{ type: 'tool_result', tool_use_id: 'toolu_raw_1', content: 'ok' }],
        },
      }),
    ];
    const result = await importFiles([jsonlFile(grownLines)]);

    // Conversation dedup still skips (frozen-at-import, spec §7.3)…
    expect(result.conversationsAdded).toBe(0);
    expect(result.conversationsSkipped).toBe(1);
    // …but the changed payload is retained as a second immutable version.
    expect(result.rawSourcesAdded).toBe(1);
    expect(await getRawSourcesForConversation('session-raw-1')).toHaveLength(2);
  });

  it('derives investigation anchors during import, keyed to the raw source (DI-1b)', async () => {
    await importFiles([jsonlFile(baseLines)]);
    const anchors = await db.investigationAnchors
      .where('conversationId')
      .equals('session-raw-1')
      .toArray();
    expect(anchors).toHaveLength(1);
    expect(anchors[0].kind).toBe('edit');
    expect(anchors[0].toolUseId).toBe('toolu_raw_1');
    expect(anchors[0].sourceProvenance).toBe('raw');
    expect(anchors[0].stableKey).toMatch(/^[0-9a-f]{64}#s\d+$/);
    expect(anchors[0].fileChanges[0].path).toBe('/a.ts');
  });

  it('stores tool ids end-to-end on imported message content blocks', async () => {
    await importFiles([jsonlFile(baseLines)]);
    const messages = await db.messages
      .where('conversationId')
      .equals('session-raw-1')
      .toArray();
    const toolUse = messages
      .flatMap((m) => m.contentBlocks ?? [])
      .find((b) => b.type === 'tool_use');
    expect(toolUse?.toolUseId).toBe('toolu_raw_1');
  });
});

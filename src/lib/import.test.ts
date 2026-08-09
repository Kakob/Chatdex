import { describe, expect, it } from 'vitest';
import { selectAutoAnalyzeIds } from './import';
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

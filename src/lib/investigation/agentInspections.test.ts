import { describe, it, expect, beforeEach } from 'vitest';
import {
  db,
  clearAllData,
  bulkPutConversations,
  bulkPutMessages,
  storeRawSources,
  listAgentInspections,
  inspectedPathsForConversation,
  conversationsThatInspected,
  deleteConversation,
} from '../db/index';
import {
  deriveAgentInspectionsForConversation,
  deriveAgentInspectionsForAllAgentSessions,
  buildAgentInspections,
  relativize,
  INSPECTION_DERIVER_VERSION,
} from './agentInspections';
import { sha256Hex } from '../utils/hash';
import type { ContentBlock, StoredConversation, StoredMessage } from '../../types/unified';

const CONV_ID = 'conv-inspection-test';

function conv(id = CONV_ID): StoredConversation {
  const now = new Date('2026-09-01T10:00:00Z');
  return {
    id,
    source: 'claude-code',
    name: 'inspection fixture',
    summary: null,
    createdAt: now,
    updatedAt: now,
    importedAt: now,
    messageCount: 0,
    userMessageCount: 0,
    assistantMessageCount: 0,
    estimatedTokens: 0,
    fullText: '',
    projectPath: '/Users/dev/chatdex',
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
    createdAt: new Date(Date.UTC(2026, 8, 1, 10, 0, msgSeq)),
  };
}

const tool = (toolName: string, toolInput: Record<string, unknown>, id: string): ContentBlock => ({
  type: 'tool_use',
  toolName,
  toolInput,
  toolUseId: id,
});

beforeEach(async () => {
  await clearAllData();
  msgSeq = 0;
  await bulkPutConversations([conv()]);
});

describe('deriveAgentInspectionsForConversation (SPEC-decision-recovery §8.1)', () => {
  it('derives one row per Read / Grep / Glob / LS call, repo-relative, keyed like anchors', async () => {
    const rawText = 'raw-payload';
    await storeRawSources([
      { kind: 'claude-code', filename: 's.jsonl', rawText, parserVersion: '1.1.0', conversationIds: [CONV_ID] },
    ]);
    await bulkPutMessages([
      msg('user', undefined, 'add project deletion'),
      msg('assistant', [
        tool('Read', { file_path: '/Users/dev/chatdex/src/lib/db/conversations.ts' }, 't1'),
        tool('Grep', { pattern: 'deleteConversation', path: '/Users/dev/chatdex/src' }, 't2'),
        tool('Glob', { pattern: 'src/**/*.test.ts' }, 't3'),
        tool('LS', { path: '/Users/dev/chatdex/src/lib' }, 't4'),
        tool('Edit', { file_path: '/Users/dev/chatdex/src/x.ts', old_string: 'a', new_string: 'b' }, 't5'),
        tool('Bash', { command: 'npm test' }, 't6'),
      ]),
    ]);

    const rows = await deriveAgentInspectionsForConversation(CONV_ID);
    const rawHash = await sha256Hex(rawText);
    expect(rows.map((r) => [r.toolName, r.kind, r.path, r.pattern])).toEqual([
      ['Read', 'read', 'src/lib/db/conversations.ts', undefined],
      ['Grep', 'search', 'src', 'deleteConversation'],
      ['Glob', 'search', undefined, 'src/**/*.test.ts'],
      ['LS', 'list', 'src/lib', undefined],
    ]);
    expect(rows[0].id).toBe(`${rawHash}#s1`);
    expect(rows[0].deriverVersion).toBe(INSPECTION_DERIVER_VERSION);
    expect(rows[0].occurredAt).toEqual(new Date(Date.UTC(2026, 8, 1, 10, 0, 2)));

    expect(await inspectedPathsForConversation(CONV_ID)).toEqual([
      'src/lib/db/conversations.ts',
      'src',
      'src/lib',
    ]);
    expect(await conversationsThatInspected('src/lib/db/conversations.ts')).toEqual([CONV_ID]);
  });

  it('is idempotent and cascades with the conversation', async () => {
    await bulkPutMessages([msg('assistant', [tool('Read', { file_path: 'README.md' }, 't1')])]);
    await deriveAgentInspectionsForConversation(CONV_ID);
    await deriveAgentInspectionsForConversation(CONV_ID);
    expect(await listAgentInspections(CONV_ID)).toHaveLength(1);

    await deleteConversation(CONV_ID);
    expect(await db.agentInspections.count()).toBe(0);
  });

  it('backfills every claude-code session and counts failures without throwing', async () => {
    await bulkPutMessages([msg('assistant', [tool('Read', { file_path: 'a.ts' }, 't1')])]);
    const result = await deriveAgentInspectionsForAllAgentSessions();
    expect(result).toEqual({ conversationsProcessed: 1, inspectionsDerived: 1, failures: 0 });
  });
});

describe('buildAgentInspections / relativize (pure)', () => {
  it('keeps relative paths, strips known roots, keeps unknown absolutes', () => {
    const roots = ['/Users/dev/chatdex/'];
    expect(relativize('src/a.ts', roots)).toBe('src/a.ts');
    expect(relativize('./src/a.ts', roots)).toBe('src/a.ts');
    expect(relativize('/Users/dev/chatdex/src/a.ts', roots)).toBe('src/a.ts');
    expect(relativize('/etc/hosts', roots)).toBe('/etc/hosts');
  });

  it('never derives from non-inspection tools', () => {
    const rows = buildAgentInspections(
      CONV_ID,
      [msg('assistant', [tool('Edit', { file_path: 'a.ts', old_string: 'a', new_string: 'b' }, 't1')])],
      { ref: 'conv:x', provenance: 'legacy' },
      []
    );
    expect(rows).toEqual([]);
  });
});

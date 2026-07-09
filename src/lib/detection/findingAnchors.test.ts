import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseClaudeCodeContent } from '../parsers/claude-code';
import { normalizeSession } from './normalize';
import { mapMessagesToStepLabels } from './findingAnchors';
import type { StoredMessage } from '../../types/unified';

const GOLDEN_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../tests/golden-traces'
);

describe('mapMessagesToStepLabels', () => {
  it('labels flat-trace messages 1:1 with their step index', () => {
    const jsonl = readFileSync(join(GOLDEN_DIR, 'mixed-session.jsonl'), 'utf-8');
    const { conversations, messages } = parseClaudeCodeContent(jsonl, 'mixed-session.jsonl');
    const session = normalizeSession(conversations[0].id, messages);

    const labels = mapMessagesToStepLabels(session);
    expect(labels.size).toBe(23);
    expect(labels.get(messages[0].id)).toBe('#0');
    expect(labels.get(messages[5].id)).toBe('#5');
    expect(labels.get(messages[22].id)).toBe('#22');
  });

  it('renders a range when one message expands to multiple steps', () => {
    const message: StoredMessage = {
      id: 'm1',
      conversationId: 'c1',
      sender: 'assistant',
      text: 'Let me check. [Tool: Read]',
      contentBlocks: [
        { type: 'text', text: 'Let me check.' },
        { type: 'tool_use', toolName: 'Read', toolInput: { file_path: '/a.ts' } },
      ],
      createdAt: new Date('2026-07-01T10:00:00Z'),
    };
    const session = normalizeSession('c1', [message]);
    expect(mapMessagesToStepLabels(session).get('m1')).toBe('#0–1');
  });
});

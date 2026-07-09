import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseClaudeCodeContent } from '../parsers/claude-code';
import { normalizeSession, type StepKind } from './normalize';
import type { StoredMessage } from '../../types/unified';

const GOLDEN_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../tests/golden-traces'
);

function loadGoldenSession(name: string) {
  const jsonl = readFileSync(join(GOLDEN_DIR, `${name}.jsonl`), 'utf-8');
  const { conversations, messages } = parseClaudeCodeContent(jsonl, `${name}.jsonl`);
  return normalizeSession(conversations[0].id, messages);
}

describe('normalizeSession — golden-trace step mapping', () => {
  it('preserves the 1:1 step-index convention on mixed-session', () => {
    const session = loadGoldenSession('mixed-session');
    expect(session.sessionId).toBe('golden-mixed-session');
    expect(session.steps).toHaveLength(23);

    const kinds: StepKind[] = session.steps.map((s) => s.kind);
    expect(kinds).toEqual([
      'user_msg',      // 0
      'tool_call',     // 1  Read config.ts
      'tool_result',   // 2
      'tool_call',     // 3  Edit → async
      'tool_result',   // 4
      'tool_call',     // 5  npm test
      'tool_result',   // 6
      'tool_call',     // 7  npm test
      'tool_result',   // 8
      'tool_call',     // 9  npm test
      'tool_result',   // 10
      'agent_text',    // 11
      'tool_call',     // 12 Read config.ts
      'tool_result',   // 13
      'tool_call',     // 14 Edit → revert
      'tool_result',   // 15
      'tool_call',     // 16 npm test
      'tool_result',   // 17
      'agent_text',    // 18
      'user_msg',      // 19
      'tool_call',     // 20 Edit cache.ts
      'tool_result',   // 21
      'agent_text',    // 22
    ]);
    session.steps.forEach((step, i) => expect(step.index).toBe(i));
  });

  it('attaches signatures and classes to tool_call steps', () => {
    const session = loadGoldenSession('mixed-session');
    const testRuns = session.steps.filter(
      (s) => s.kind === 'tool_call' && s.toolName === 'Bash'
    );
    expect(testRuns).toHaveLength(4); // steps 5, 7, 9, 16
    const signatures = new Set(testRuns.map((s) => s.signature));
    expect(signatures.size).toBe(1); // identical npm test signature
    for (const run of testRuns) {
      expect(run.toolClass).toBe('verification_shaped');
    }
    const edits = session.steps.filter((s) => s.editHunks);
    expect(edits.map((s) => s.index)).toEqual([3, 14, 20]);
    for (const edit of edits) expect(edit.toolClass).toBe('state_changing');
  });
});

describe('normalizeSession — edit timelines (acceptance d)', () => {
  it('reconstructs per-file timelines from mixed-session', () => {
    const session = loadGoldenSession('mixed-session');
    expect([...session.editTimelines.keys()].sort()).toEqual([
      '/home/user/project/src/cache.ts',
      '/home/user/project/src/config.ts',
    ]);

    const config = session.editTimelines.get('/home/user/project/src/config.ts')!;
    expect(config.map((e) => e.stepIndex)).toEqual([3, 14]);
    expect(config[0].hunk).toEqual({
      filePath: '/home/user/project/src/config.ts',
      oldString: 'export function loadConfig',
      newString: 'export async function loadConfig',
    });
    // The step-14 hunk exactly inverts the step-3 hunk — the raw material
    // for the Phase 5 reversion detector.
    expect(config[1].hunk.oldString).toBe(config[0].hunk.newString);
    expect(config[1].hunk.newString).toBe(config[0].hunk.oldString!);

    const cache = session.editTimelines.get('/home/user/project/src/cache.ts')!;
    expect(cache.map((e) => e.stepIndex)).toEqual([20]);
  });
});

describe('normalizeSession — message expansion and edge cases', () => {
  const msg = (partial: Partial<StoredMessage>): StoredMessage => ({
    id: partial.id ?? 'm1',
    conversationId: 'c1',
    sender: partial.sender ?? 'user',
    text: partial.text ?? '',
    createdAt: new Date('2026-07-01T10:00:00Z'),
    ...partial,
  });

  it('expands an assistant message with embedded tool_use blocks', () => {
    const session = normalizeSession('s', [
      msg({
        id: 'm1',
        sender: 'assistant',
        text: 'Let me check. [Tool: Read]',
        contentBlocks: [
          { type: 'text', text: 'Let me check.' },
          { type: 'tool_use', toolName: 'Read', toolInput: { file_path: '/a.ts' } },
        ],
      }),
    ]);
    expect(session.steps.map((s) => s.kind)).toEqual(['agent_text', 'tool_call']);
    expect(session.steps[1].signature).toBe('Read:{"file_path":"/a.ts"}');
    expect(session.steps[1].messageId).toBe('m1');
  });

  it('skips system messages without disturbing indices', () => {
    const session = normalizeSession('s', [
      msg({ id: 'm1', sender: 'user', text: 'hi' }),
      msg({ id: 'm2', sender: 'system', text: 'meta' }),
      msg({ id: 'm3', sender: 'assistant', text: 'hello' }),
    ]);
    expect(session.steps.map((s) => s.kind)).toEqual(['user_msg', 'agent_text']);
    expect(session.steps[1].index).toBe(1);
  });

  it('tolerates malformed stored tool input', () => {
    const session = normalizeSession('s', [
      msg({
        id: 'm1',
        sender: 'tool',
        text: '[Tool: Bash]',
        toolName: 'Bash',
        toolInput: '{not json',
      }),
    ]);
    expect(session.steps[0].kind).toBe('tool_call');
    expect(session.steps[0].toolInput).toEqual({});
    expect(session.steps[0].signature).toBe('Bash:{}');
  });

  it('collects MultiEdit hunks in order on one timeline', () => {
    const session = normalizeSession('s', [
      msg({
        id: 'm1',
        sender: 'tool',
        text: '[Tool: MultiEdit]',
        contentBlocks: [{
          type: 'tool_use',
          toolName: 'MultiEdit',
          toolInput: {
            file_path: '/app//src/a.ts',
            edits: [
              { old_string: 'x', new_string: 'y' },
              { old_string: 'p', new_string: 'q' },
            ],
          },
        }],
      }),
    ]);
    const timeline = session.editTimelines.get('/app/src/a.ts')!;
    expect(timeline).toHaveLength(2);
    expect(timeline.map((e) => e.hunk.newString)).toEqual(['y', 'q']);
  });
});

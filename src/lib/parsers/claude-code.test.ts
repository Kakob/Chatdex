import { describe, it, expect } from 'vitest';
import { parseClaudeCodeContent } from './claude-code';

function makeEntry(type: string, extra: Record<string, unknown> = {}) {
  return JSON.stringify({ type, timestamp: '2026-01-15T10:00:00Z', ...extra });
}

describe('parseClaudeCodeContent', () => {
  it('parses a basic conversation with system, user, and assistant', () => {
    const content = [
      makeEntry('system', { cwd: '/project', git_branch: 'main' }),
      makeEntry('user', { message: { content: 'Hello Claude' } }),
      makeEntry('assistant', { message: { content: 'Hi there!' } }),
    ].join('\n');

    const result = parseClaudeCodeContent(content, 'test.jsonl');
    expect(result.conversations).toHaveLength(1);
    expect(result.messages.length).toBeGreaterThanOrEqual(2);
    expect(result.conversations[0].source).toBe('claude-code');
  });

  it('throws on empty input', () => {
    expect(() => parseClaudeCodeContent('', 'empty.jsonl')).toThrow('No valid entries');
  });

  it('throws on all malformed lines', () => {
    expect(() => parseClaudeCodeContent('not json\nalso not json', 'bad.jsonl')).toThrow('No valid entries');
  });

  it('skips malformed lines and parses valid ones', () => {
    const content = [
      'invalid json here',
      makeEntry('system', { cwd: '/project' }),
      makeEntry('user', { message: { content: 'test' } }),
      makeEntry('assistant', { message: { content: 'response' } }),
    ].join('\n');

    const result = parseClaudeCodeContent(content, 'mixed.jsonl');
    expect(result.conversations).toHaveLength(1);
  });

  it('extracts user and assistant messages', () => {
    const content = [
      makeEntry('system', { cwd: '/project' }),
      makeEntry('user', { message: { content: 'Question?' } }),
      makeEntry('assistant', { message: { content: 'Answer.' } }),
    ].join('\n');

    const result = parseClaudeCodeContent(content, 'test.jsonl');
    const userMsgs = result.messages.filter((m) => m.sender === 'user');
    const assistantMsgs = result.messages.filter((m) => m.sender === 'assistant');
    expect(userMsgs.length).toBeGreaterThanOrEqual(1);
    expect(assistantMsgs.length).toBeGreaterThanOrEqual(1);
  });

  it('handles tool_use entries', () => {
    const content = [
      makeEntry('system', { cwd: '/project' }),
      makeEntry('user', { message: { content: 'Do something' } }),
      makeEntry('tool_use', { tool_name: 'read_file', tool_input: { path: '/test.ts' } }),
      makeEntry('tool_result', { tool_name: 'read_file', result: 'file contents' }),
      makeEntry('assistant', { message: { content: 'Done' } }),
    ].join('\n');

    const result = parseClaudeCodeContent(content, 'tools.jsonl');
    expect(result.messages.length).toBeGreaterThanOrEqual(2);
  });

  it('sets conversation metadata from system entry', () => {
    const content = [
      makeEntry('system', { cwd: '/my/project', git_branch: 'feature-x' }),
      makeEntry('user', { message: { content: 'test' } }),
      makeEntry('assistant', { message: { content: 'ok' } }),
    ].join('\n');

    const result = parseClaudeCodeContent(content, 'test.jsonl');
    const conv = result.conversations[0];
    expect(conv.gitBranch).toBe('feature-x');
  });

  it('extracts metadata from camelCase fields on non-system entries', () => {
    // Mirrors the real Claude Code JSONL shape: no leading `system` entry,
    // metadata attached to user/assistant entries instead.
    const content = [
      makeEntry('file-history-snapshot', {}),
      makeEntry('user', {
        message: { content: 'hi' },
        cwd: '/Users/jacie/dev/apps/chatdex',
        sessionId: 'a38aa66-real-session',
        gitBranch: 'main',
      }),
      makeEntry('assistant', { message: { content: 'hello' } }),
    ].join('\n');

    const result = parseClaudeCodeContent(content, 'a38aa66.jsonl');
    const conv = result.conversations[0];
    expect(conv.name).toBe('chatdex');
    expect(conv.id).toBe('a38aa66-real-session');
    expect(conv.gitBranch).toBe('main');
    expect(conv.workingDirectory).toBe('/Users/jacie/dev/apps/chatdex');
  });

  it('extracts tool_use and tool_result content blocks from real assistant/user messages', () => {
    const content = [
      makeEntry('user', {
        message: { content: 'run a command' },
        cwd: '/proj',
        sessionId: 's1',
      }),
      makeEntry('assistant', {
        message: {
          content: [
            { type: 'thinking', thinking: 'I should run ls' },
            { type: 'tool_use', id: 'tu_1', name: 'Bash', input: { command: 'ls' } },
          ],
        },
      }),
      makeEntry('user', {
        message: {
          content: [
            { type: 'tool_result', tool_use_id: 'tu_1', content: 'file.txt' },
          ],
        },
      }),
      makeEntry('assistant', { message: { content: [{ type: 'text', text: 'done' }] } }),
    ].join('\n');

    const result = parseClaudeCodeContent(content, 'tools-inline.jsonl');
    const assistantMsgs = result.messages.filter((m) => m.sender === 'assistant');
    const toolUseAsst = assistantMsgs[0];
    expect(toolUseAsst.contentBlocks?.some((b) => b.type === 'tool_use' && b.toolName === 'Bash')).toBe(true);
    expect(toolUseAsst.text).toContain('[Tool: Bash]');

    const userMsgs = result.messages.filter((m) => m.sender === 'user');
    const toolResultUser = userMsgs[1];
    expect(toolResultUser.contentBlocks?.some((b) => b.type === 'tool_result' && b.toolResult === 'file.txt')).toBe(true);
  });

  it('handles content blocks array format', () => {
    const content = [
      makeEntry('system', { cwd: '/project' }),
      makeEntry('user', { message: { content: [{ type: 'text', text: 'Hello' }] } }),
      makeEntry('assistant', { message: { content: [{ type: 'text', text: 'World' }] } }),
    ].join('\n');

    const result = parseClaudeCodeContent(content, 'blocks.jsonl');
    expect(result.messages.length).toBeGreaterThanOrEqual(2);
  });

  // SPEC-decision-investigation §7.2/§7.5: source-provided tool ids are the
  // first-precedence alignment key between tool calls and their results.
  it('preserves tool_use id and tool_result tool_use_id on content blocks', () => {
    const content = [
      makeEntry('user', { cwd: '/project', message: { content: 'Edit the file' } }),
      makeEntry('assistant', {
        message: {
          content: [
            {
              type: 'tool_use',
              id: 'toolu_abc123',
              name: 'Edit',
              input: { file_path: '/a.ts', old_string: 'x', new_string: 'y' },
            },
          ],
        },
      }),
      makeEntry('user', {
        message: {
          content: [
            { type: 'tool_result', tool_use_id: 'toolu_abc123', content: 'edited ok' },
          ],
        },
      }),
    ].join('\n');

    const result = parseClaudeCodeContent(content, 'tool-ids.jsonl');
    const blocks = result.messages.flatMap((m) => m.contentBlocks ?? []);
    const toolUse = blocks.find((b) => b.type === 'tool_use');
    const toolResult = blocks.find((b) => b.type === 'tool_result');

    expect(toolUse?.toolUseId).toBe('toolu_abc123');
    expect(toolUse?.toolName).toBe('Edit');
    expect(toolUse?.toolInput).toEqual({ file_path: '/a.ts', old_string: 'x', new_string: 'y' });
    expect(toolResult?.toolUseId).toBe('toolu_abc123');
  });

  it('leaves toolUseId undefined when the source carries no ids', () => {
    const content = [
      makeEntry('user', { cwd: '/project', message: { content: 'go' } }),
      makeEntry('assistant', {
        message: {
          content: [{ type: 'tool_use', name: 'Bash', input: { command: 'ls' } }],
        },
      }),
    ].join('\n');

    const result = parseClaudeCodeContent(content, 'no-ids.jsonl');
    const toolUse = result.messages
      .flatMap((m) => m.contentBlocks ?? [])
      .find((b) => b.type === 'tool_use');
    expect(toolUse).toBeDefined();
    expect(toolUse?.toolUseId).toBeUndefined();
  });
});

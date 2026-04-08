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

  it('handles content blocks array format', () => {
    const content = [
      makeEntry('system', { cwd: '/project' }),
      makeEntry('user', { message: { content: [{ type: 'text', text: 'Hello' }] } }),
      makeEntry('assistant', { message: { content: [{ type: 'text', text: 'World' }] } }),
    ].join('\n');

    const result = parseClaudeCodeContent(content, 'blocks.jsonl');
    expect(result.messages.length).toBeGreaterThanOrEqual(2);
  });
});

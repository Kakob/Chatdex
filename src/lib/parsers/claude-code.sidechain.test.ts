// Parser 1.2.0 (SPEC-decision-recovery §8.3): entry identity and delegation.
import { describe, it, expect } from 'vitest';
import { parseClaudeCodeContent, CLAUDE_CODE_PARSER_VERSION } from './claude-code';

const PARENT = 'a5f18574-47b5-4d93-9059-985596769160';

function line(obj: Record<string, unknown>): string {
  return JSON.stringify({ timestamp: '2026-09-07T19:16:56.214Z', cwd: '/Users/dev/chatdex', sessionId: PARENT, ...obj });
}

describe('Claude Code parser 1.2.0 — sidechains and source meta', () => {
  it('is version 1.2.0', () => {
    expect(CLAUDE_CODE_PARSER_VERSION).toBe('1.2.0');
  });

  it('gives a subagent transcript its own conversation id, links the parent, and marks messages delegated', () => {
    const content = [
      line({ parentUuid: null, isSidechain: true, agentId: 'a003504829735f8ae', promptId: 'p1', type: 'user', uuid: 'u1', message: { role: 'user', content: 'Explore the repo' } }),
      line({ parentUuid: 'u1', isSidechain: true, agentId: 'a003504829735f8ae', type: 'assistant', uuid: 'u2', message: { role: 'assistant', content: [{ type: 'text', text: 'Looking.' }, { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/Users/dev/chatdex/README.md' } }] } }),
    ].join('\n');
    const result = parseClaudeCodeContent(content, 'agent-a003504829735f8ae.jsonl');
    const conv = result.conversations[0];
    expect(conv.id).toBe(`${PARENT}:agent:a003504829735f8ae`);
    expect(conv.id).not.toBe(PARENT);
    expect(conv.providerMeta).toEqual({
      sourceFilename: 'agent-a003504829735f8ae.jsonl',
      isSidechain: true,
      agentId: 'a003504829735f8ae',
      parentSessionId: PARENT,
    });
    expect(conv.name).toBe('chatdex · subagent a0035048');
    expect(conv.projectPath).toBe('/Users/dev/chatdex');
    expect(result.messages.every((m) => m.conversationId === conv.id)).toBe(true);
    expect(result.messages[0].sourceMeta).toEqual({ uuid: 'u1', isSidechain: true, agentId: 'a003504829735f8ae' });
    expect(result.messages[1].sourceMeta).toEqual({ uuid: 'u2', parentUuid: 'u1', isSidechain: true, agentId: 'a003504829735f8ae' });
  });

  it('keeps top-level sessions as before and records uuid chains without sidechain flags', () => {
    const content = [
      line({ parentUuid: null, isSidechain: false, type: 'user', uuid: 'u1', message: { role: 'user', content: 'Hi' }, userType: 'external', version: '2.1.261' }),
      line({ parentUuid: 'u1', isSidechain: false, type: 'assistant', uuid: 'u2', message: { role: 'assistant', content: 'Hello' } }),
    ].join('\n');
    const result = parseClaudeCodeContent(content, `${PARENT}.jsonl`);
    const conv = result.conversations[0];
    expect(conv.id).toBe(PARENT);
    expect(conv.providerMeta).toEqual({ sourceFilename: `${PARENT}.jsonl` });
    expect(conv.name).toBe('chatdex');
    expect(result.messages[0].sourceMeta).toEqual({ uuid: 'u1' });
    expect(result.messages[1].sourceMeta).toEqual({ uuid: 'u2', parentUuid: 'u1' });
  });

  it('adds no sourceMeta when the source has none (older fixtures unchanged)', () => {
    const content = [
      JSON.stringify({ type: 'user', timestamp: '2026-01-15T10:00:00Z', cwd: '/p', message: { content: 'x' } }),
      JSON.stringify({ type: 'assistant', timestamp: '2026-01-15T10:00:01Z', message: { content: 'y' } }),
    ].join('\n');
    const result = parseClaudeCodeContent(content, 's.jsonl');
    expect(result.messages.every((m) => !('sourceMeta' in m))).toBe(true);
    expect(result.conversations[0].providerMeta).toEqual({ sourceFilename: 's.jsonl' });
  });
});

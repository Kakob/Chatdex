import { describe, it, expect } from 'vitest';
import { parseClaudeAIJSON } from './claude-ai';
import { parseClaudeCodeContent } from './claude-code';
import { parseChatGPTJSON } from './chatgpt';

// PRD §4: every imported conversation retains a raw source reference
// sufficient for later inspection. v1 keeps a lightweight pointer (the
// import filename) rather than raw blobs — see assessment conflict #3.

describe('providerMeta.sourceFilename provenance', () => {
  it('claude-code conversations record the session filename', () => {
    const content = [
      JSON.stringify({ type: 'user', sessionId: 's1', cwd: '/p', message: { content: 'hi' } }),
      JSON.stringify({ type: 'assistant', message: { content: 'hello' } }),
    ].join('\n');
    const result = parseClaudeCodeContent(content, 'session-abc.jsonl');
    expect(result.conversations[0].providerMeta?.sourceFilename).toBe('session-abc.jsonl');
  });

  it('claude.ai conversations record the export filename when known', async () => {
    const data = [
      {
        uuid: 'u1',
        name: 'n',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        chat_messages: [
          { uuid: 'm1', sender: 'human', text: 'hi', created_at: '2024-01-01T00:00:00Z' },
        ],
      },
    ];
    const result = await parseClaudeAIJSON(JSON.stringify(data), 'claude-export.zip');
    expect(result.conversations[0].providerMeta?.sourceFilename).toBe('claude-export.zip');

    const withoutFilename = await parseClaudeAIJSON(JSON.stringify(data));
    expect(withoutFilename.conversations[0].providerMeta).toBeUndefined();
  });

  it('chatgpt conversations record the export filename alongside graph counts', async () => {
    const mapping = {
      root: { id: 'root', parent: null, children: ['n1'], message: null },
      n1: {
        id: 'n1',
        parent: 'root',
        children: [],
        message: {
          id: 'm1',
          author: { role: 'user' },
          create_time: 1_700_000_000,
          content: { content_type: 'text', parts: ['hi'] },
          metadata: {},
        },
      },
    };
    const data = [{ id: 'c1', title: 't', current_node: 'n1', mapping }];
    const result = await parseChatGPTJSON(JSON.stringify(data), 'chatgpt-export.zip');
    const meta = result.conversations[0].providerMeta;
    expect(meta?.sourceFilename).toBe('chatgpt-export.zip');
    expect(meta?.totalMappingNodes).toBe(2);
  });
});

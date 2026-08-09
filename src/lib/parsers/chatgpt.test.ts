import { describe, it, expect } from 'vitest';
import { parseChatGPTJSON } from './chatgpt';
import { sniffJSONContent } from './index';

// Fixture builder — mirrors tests/golden-traces/fixture-builder pattern.
// Each helper emits a schema-correct ChatGPT export node so tests stay
// readable and surgical (one scenario per fixture).

interface NodeSpec {
  id: string;
  parent: string | null;
  role?: 'user' | 'assistant' | 'system' | 'tool';
  contentType?: string;
  parts?: unknown[];
  text?: string;
  language?: string;
  thoughts?: Array<{ summary?: string; content?: string }>;
  createTime?: number;
  hidden?: boolean;
  children?: string[];
}

function buildMapping(nodes: NodeSpec[]): Record<string, unknown> {
  const mapping: Record<string, unknown> = {};
  for (const n of nodes) {
    const message = n.role
      ? {
          id: `msg-${n.id}`,
          author: { role: n.role },
          create_time: n.createTime ?? 1_700_000_000,
          content: buildContent(n),
          metadata: n.hidden ? { is_visually_hidden_from_conversation: true } : {},
        }
      : null;
    mapping[n.id] = {
      id: n.id,
      parent: n.parent,
      children: n.children ?? [],
      message,
    };
  }
  return mapping;
}

function buildContent(n: NodeSpec): Record<string, unknown> {
  const type = n.contentType ?? 'text';
  const content: Record<string, unknown> = { content_type: type };
  if (n.parts !== undefined) content.parts = n.parts;
  if (n.text !== undefined) content.text = n.text;
  if (n.language !== undefined) content.language = n.language;
  if (n.thoughts !== undefined) content.thoughts = n.thoughts;
  return content;
}

function buildConversation(overrides: Record<string, unknown> = {}): unknown[] {
  const mapping = buildMapping([
    { id: 'root', parent: null, children: ['n1'] },
    { id: 'n1', parent: 'root', role: 'user', parts: ['Hello'], createTime: 1_700_000_100, children: ['n2'] },
    { id: 'n2', parent: 'n1', role: 'assistant', parts: ['Hi!'], createTime: 1_700_000_200 },
  ]);
  return [
    {
      id: 'conv-1',
      title: 'Test Conversation',
      create_time: 1_700_000_000,
      update_time: 1_700_000_500,
      current_node: 'n2',
      mapping,
      ...overrides,
    },
  ];
}

describe('parseChatGPTJSON — canonical path traversal', () => {
  it('reconstructs the active branch from current_node', async () => {
    const data = buildConversation();
    const result = await parseChatGPTJSON(JSON.stringify(data));
    expect(result.conversations).toHaveLength(1);
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0].sender).toBe('user');
    expect(result.messages[1].sender).toBe('assistant');
  });

  it('sets source, name, and message counts on the conversation', async () => {
    const data = buildConversation();
    const result = await parseChatGPTJSON(JSON.stringify(data));
    const conv = result.conversations[0];
    expect(conv.source).toBe('chatgpt');
    expect(conv.name).toBe('Test Conversation');
    expect(conv.userMessageCount).toBe(1);
    expect(conv.assistantMessageCount).toBe(1);
    expect(conv.messageCount).toBe(2);
  });

  it('records pruned-branch counts in providerMeta so discarded edits stay visible', async () => {
    // Two siblings under root: one canonical (n2), one edit branch (n2b→n3b).
    const mapping = buildMapping([
      { id: 'root', parent: null, children: ['n1'] },
      { id: 'n1', parent: 'root', role: 'user', parts: ['q'], children: ['n2', 'n2b'] },
      { id: 'n2', parent: 'n1', role: 'assistant', parts: ['canonical answer'] },
      { id: 'n2b', parent: 'n1', role: 'assistant', parts: ['edited answer'], children: ['n3b'] },
      { id: 'n3b', parent: 'n2b', role: 'user', parts: ['follow-up on edit'] },
    ]);
    const data = [{ id: 'c1', title: 't', current_node: 'n2', mapping }];
    const result = await parseChatGPTJSON(JSON.stringify(data));
    expect(result.messages.map((m) => m.text)).toEqual(['q', 'canonical answer']);
    const meta = result.conversations[0].providerMeta;
    expect(meta?.canonicalNodeCount).toBe(3); // root + n1 + n2
    expect(meta?.totalMappingNodes).toBe(5);
    expect(meta?.prunedBranches).toBe(2); // n2b + n3b
  });

  it('skips hidden system nodes and null-message nodes', async () => {
    const mapping = buildMapping([
      { id: 'root', parent: null, children: ['sys'] },
      { id: 'sys', parent: 'root', role: 'system', parts: ['hidden'], hidden: true, children: ['n1'] },
      { id: 'n1', parent: 'sys', role: 'user', parts: ['visible'] },
    ]);
    const data = [{ id: 'c1', title: 't', current_node: 'n1', mapping }];
    const result = await parseChatGPTJSON(JSON.stringify(data));
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].text).toBe('visible');
  });

  it('rejects a conversation whose canonical path has zero visible messages', async () => {
    const mapping = buildMapping([{ id: 'root', parent: null }]);
    const data = [{ id: 'c1', title: 't', current_node: 'root', mapping }];
    await expect(parseChatGPTJSON(JSON.stringify(data))).rejects.toThrow(
      'No valid conversations'
    );
  });
});

describe('parseChatGPTJSON — content type variants', () => {
  it('parses code blocks with language into a code content block', async () => {
    const mapping = buildMapping([
      { id: 'root', parent: null, children: ['n1'] },
      { id: 'n1', parent: 'root', role: 'user', parts: ['run this'], children: ['n2'] },
      {
        id: 'n2',
        parent: 'n1',
        role: 'assistant',
        contentType: 'code',
        text: 'print("hi")',
        language: 'python',
      },
    ]);
    const data = [{ id: 'c1', title: 't', current_node: 'n2', mapping }];
    const result = await parseChatGPTJSON(JSON.stringify(data));
    const asst = result.messages.find((m) => m.sender === 'assistant')!;
    const codeBlock = asst.contentBlocks?.find((b) => b.type === 'code');
    expect(codeBlock?.language).toBe('python');
    expect(codeBlock?.text).toBe('print("hi")');
  });

  it('parses execution_output as a code block labelled output', async () => {
    const mapping = buildMapping([
      { id: 'root', parent: null, children: ['n1'] },
      { id: 'n1', parent: 'root', role: 'tool', contentType: 'execution_output', text: 'result: 42' },
    ]);
    const data = [{ id: 'c1', title: 't', current_node: 'n1', mapping }];
    const result = await parseChatGPTJSON(JSON.stringify(data));
    const block = result.messages[0].contentBlocks?.[0];
    expect(block?.type).toBe('code');
    expect(block?.language).toBe('output');
    expect(block?.text).toBe('result: 42');
  });

  it('parses multimodal_text with image pointers into text + unsupported blocks', async () => {
    const mapping = buildMapping([
      { id: 'root', parent: null, children: ['n1'] },
      {
        id: 'n1',
        parent: 'root',
        role: 'user',
        contentType: 'multimodal_text',
        parts: ['see the diagram', { content_type: 'image_asset_pointer', asset_pointer: 'file-xyz' }],
      },
    ]);
    const data = [{ id: 'c1', title: 't', current_node: 'n1', mapping }];
    const result = await parseChatGPTJSON(JSON.stringify(data));
    const blocks = result.messages[0].contentBlocks!;
    expect(blocks.map((b) => b.type)).toEqual(['text', 'unsupported']);
    expect(blocks[1].text).toBe('[image_asset_pointer]');
  });

  it('parses thoughts into a thinking block', async () => {
    const mapping = buildMapping([
      { id: 'root', parent: null, children: ['n1'] },
      {
        id: 'n1',
        parent: 'root',
        role: 'assistant',
        contentType: 'thoughts',
        thoughts: [{ summary: 'consider approach A', content: 'weigh tradeoffs' }],
      },
    ]);
    const data = [{ id: 'c1', title: 't', current_node: 'n1', mapping }];
    const result = await parseChatGPTJSON(JSON.stringify(data));
    const block = result.messages[0].contentBlocks?.[0];
    expect(block?.type).toBe('thinking');
    expect(block?.text).toContain('consider approach A');
  });

  it('falls back to parts for unknown content_type instead of dropping the message', async () => {
    const mapping = buildMapping([
      { id: 'root', parent: null, children: ['n1'] },
      { id: 'n1', parent: 'root', role: 'user', contentType: 'future_type_xyz', parts: ['still visible'] },
    ]);
    const data = [{ id: 'c1', title: 't', current_node: 'n1', mapping }];
    const result = await parseChatGPTJSON(JSON.stringify(data));
    expect(result.messages[0].text).toBe('still visible');
  });
});

describe('parseChatGPTJSON — timestamps and envelope handling', () => {
  it('converts unix-float timestamps to Date instances', async () => {
    const data = buildConversation();
    const result = await parseChatGPTJSON(JSON.stringify(data));
    const conv = result.conversations[0];
    // 1_700_000_000 (unix seconds) → 2023-11-14T22:13:20Z
    expect(conv.createdAt.getUTCFullYear()).toBe(2023);
    expect(result.messages[0].createdAt.getTime()).toBe(1_700_000_100 * 1000);
  });

  it('accepts an envelope object with a conversations array', async () => {
    const data = { conversations: buildConversation() };
    const result = await parseChatGPTJSON(JSON.stringify(data));
    expect(result.conversations).toHaveLength(1);
  });

  it('throws when no conversations array can be found', async () => {
    await expect(parseChatGPTJSON(JSON.stringify({}))).rejects.toThrow(
      'could not find conversations array'
    );
  });

  it('skips a malformed conversation and keeps parsing the rest', async () => {
    const good = buildConversation();
    const bad = { title: 'broken' /* no mapping */ };
    const data = [...good, bad];
    const result = await parseChatGPTJSON(JSON.stringify(data));
    expect(result.conversations).toHaveLength(1);
  });
});

describe('sniffJSONContent — routes ChatGPT and Claude.ai exports correctly', () => {
  it('detects a ChatGPT mapping-graph export', () => {
    const data = buildConversation();
    expect(sniffJSONContent(JSON.stringify(data))).toBe('chatgpt');
  });

  it('detects a Claude.ai flat-array export (regression: existing users)', () => {
    const data = [
      {
        uuid: 'abc',
        name: 'from claude.ai',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        chat_messages: [],
      },
    ];
    expect(sniffJSONContent(JSON.stringify(data))).toBe('claude-ai');
  });

  it('detects a Claude.ai export wrapped in a conversations envelope', () => {
    const data = {
      conversations: [
        { uuid: 'x', name: 'n', created_at: '2024-01-01', updated_at: '2024-01-01', chat_messages: [] },
      ],
    };
    expect(sniffJSONContent(JSON.stringify(data))).toBe('claude-ai');
  });

  it('returns unknown for invalid JSON', () => {
    expect(sniffJSONContent('not json')).toBe('unknown');
  });

  it('returns unknown for an empty array', () => {
    expect(sniffJSONContent('[]')).toBe('unknown');
  });
});

import { describe, it, expect } from 'vitest';
import { conversationToMarkdown } from './markdown';
import { makeConversation, makeMessage, makeConversationWithMessages } from '../../test/fixtures/conversations';

describe('conversationToMarkdown', () => {
  it('generates header with name, source, date, message count', () => {
    const { conversation, messages } = makeConversationWithMessages(2);
    const md = conversationToMarkdown(conversation, messages);

    expect(md).toContain('# Test Conversation');
    expect(md).toContain('**Source:** claude.ai');
    expect(md).toContain('**Messages:** 2');
  });

  it('includes estimated tokens when > 0', () => {
    const conv = makeConversation({ estimatedTokens: 5000 });
    const md = conversationToMarkdown(conv, []);
    expect(md).toContain('**Estimated tokens:** 5,000');
  });

  it('omits estimated tokens when 0', () => {
    const conv = makeConversation({ estimatedTokens: 0 });
    const md = conversationToMarkdown(conv, []);
    expect(md).not.toContain('Estimated tokens');
  });

  it('includes project path for Claude Code conversations', () => {
    const conv = makeConversation({
      source: 'claude-code',
      projectPath: '/home/user/project',
    });
    const md = conversationToMarkdown(conv, []);
    expect(md).toContain('**Project:** /home/user/project');
  });

  it('omits project path when undefined', () => {
    const conv = makeConversation({ projectPath: undefined });
    const md = conversationToMarkdown(conv, []);
    expect(md).not.toContain('**Project:**');
  });

  it('formats user messages with User heading', () => {
    const msg = makeMessage({ sender: 'user', text: 'Hello' });
    const md = conversationToMarkdown(makeConversation(), [msg]);
    expect(md).toContain('### **User**');
  });

  it('formats assistant messages with Claude heading', () => {
    const msg = makeMessage({ sender: 'assistant', text: 'Hi there' });
    const md = conversationToMarkdown(makeConversation(), [msg]);
    expect(md).toContain('### **Claude**');
  });

  it('skips system and tool messages', () => {
    const msgs = [
      makeMessage({ id: '1', sender: 'system', text: 'System init' }),
      makeMessage({ id: '2', sender: 'tool', text: 'Tool result' }),
      makeMessage({ id: '3', sender: 'user', text: 'Hello' }),
    ];
    const md = conversationToMarkdown(makeConversation(), msgs);
    expect(md).not.toContain('System init');
    expect(md).not.toContain('Tool result');
    expect(md).toContain('Hello');
  });

  it('handles empty messages array without crashing', () => {
    const md = conversationToMarkdown(makeConversation(), []);
    expect(md).toContain('# Test Conversation');
    expect(md).not.toContain('### **User**');
  });
});

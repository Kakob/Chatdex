import type { StoredConversation, StoredMessage } from '../../types';

export function makeConversation(overrides?: Partial<StoredConversation>): StoredConversation {
  return {
    id: 'conv-1',
    source: 'claude.ai',
    name: 'Test Conversation',
    summary: 'A test conversation',
    createdAt: new Date('2026-01-15T10:00:00Z'),
    updatedAt: new Date('2026-01-15T11:00:00Z'),
    importedAt: new Date('2026-01-16T10:00:00Z'),
    messageCount: 4,
    userMessageCount: 2,
    assistantMessageCount: 2,
    estimatedTokens: 1500,
    fullText: 'test full text',
    ...overrides,
  };
}

export function makeMessage(overrides?: Partial<StoredMessage>): StoredMessage {
  return {
    id: 'msg-1',
    conversationId: 'conv-1',
    sender: 'user',
    text: 'Hello, Claude!',
    createdAt: new Date('2026-01-15T10:00:00Z'),
    ...overrides,
  };
}

export function makeConversationWithMessages(count = 4) {
  const conversation = makeConversation({ messageCount: count });
  const messages: StoredMessage[] = [];

  for (let i = 0; i < count; i++) {
    const isUser = i % 2 === 0;
    messages.push(
      makeMessage({
        id: `msg-${i}`,
        sender: isUser ? 'user' : 'assistant',
        text: isUser ? `User message ${i}` : `Assistant response ${i}`,
        createdAt: new Date(Date.parse('2026-01-15T10:00:00Z') + i * 60000),
      })
    );
  }

  return { conversation, messages };
}

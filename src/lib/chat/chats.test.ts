import { describe, it, expect, beforeEach } from 'vitest';
import { clearAllData } from '../db';
import { getAssociationsForConversation } from '../db/understanding';
import {
  chatNameFromMessage,
  createChat,
  appendChatMessage,
  listChats,
  getChat,
  getChatMessages,
} from './chats';

beforeEach(async () => {
  await clearAllData();
});

describe('chatNameFromMessage', () => {
  it('uses the first line, trimmed', () => {
    expect(chatNameFromMessage('  Hello there \nsecond line')).toBe('Hello there');
  });

  it('ellipsizes long messages', () => {
    const name = chatNameFromMessage('x'.repeat(200));
    expect(name.length).toBeLessThanOrEqual(60);
    expect(name.endsWith('…')).toBe(true);
  });

  it('falls back for empty input', () => {
    expect(chatNameFromMessage('   \n  ')).toBe('New chat');
  });
});

describe('createChat', () => {
  it('creates a chatdex conversation seeded with the first user message', async () => {
    const conv = await createChat({
      provider: 'anthropic',
      firstUserMessage: 'What should I build next?',
    });

    const stored = await getChat(conv.id);
    expect(stored).toBeDefined();
    expect(stored!.source).toBe('chatdex');
    expect(stored!.name).toBe('What should I build next?');
    expect(stored!.messageCount).toBe(1);
    expect(stored!.userMessageCount).toBe(1);
    expect(stored!.assistantMessageCount).toBe(0);
    expect(stored!.fullText).toBe('What should I build next?');
    expect(stored!.estimatedTokens).toBeGreaterThan(0);
    expect(stored!.providerMeta).toEqual({ provider: 'anthropic' });

    const messages = await getChatMessages(conv.id);
    expect(messages).toHaveLength(1);
    expect(messages[0].sender).toBe('user');
    expect(messages[0].text).toBe('What should I build next?');
  });

  it('records an accepted user-origin association when started from a project', async () => {
    const conv = await createChat({
      provider: 'openai',
      projectId: 'proj-1',
      firstUserMessage: 'Project question',
    });

    const associations = await getAssociationsForConversation(conv.id);
    expect(associations).toHaveLength(1);
    expect(associations[0].projectId).toBe('proj-1');
    expect(associations[0].origin).toBe('user');
    expect(associations[0].reviewState).toBe('accepted');
    expect(associations[0].confidence).toBe(1);
    expect((conv.providerMeta as { projectId?: string }).projectId).toBe('proj-1');
  });
});

describe('appendChatMessage', () => {
  it('appends and keeps conversation aggregates consistent', async () => {
    const conv = await createChat({ provider: 'anthropic', firstUserMessage: 'Hi' });
    await appendChatMessage(conv.id, {
      sender: 'assistant',
      text: 'Hello! How can I help?',
      model: 'claude-opus-5',
    });
    await appendChatMessage(conv.id, { sender: 'user', text: 'Tell me more' });

    const stored = (await getChat(conv.id))!;
    expect(stored.messageCount).toBe(3);
    expect(stored.userMessageCount).toBe(2);
    expect(stored.assistantMessageCount).toBe(1);
    expect(stored.fullText).toBe('Hi\n\nHello! How can I help?\n\nTell me more');
    expect((stored.providerMeta as { model?: string }).model).toBe('claude-opus-5');
    expect(stored.updatedAt.getTime()).toBeGreaterThanOrEqual(stored.createdAt.getTime());

    const messages = await getChatMessages(conv.id);
    expect(messages.map((m) => m.sender)).toEqual(['user', 'assistant', 'user']);
  });

  it('keeps the last-used model when a later append has none', async () => {
    const conv = await createChat({ provider: 'anthropic', firstUserMessage: 'Hi' });
    await appendChatMessage(conv.id, { sender: 'assistant', text: 'A', model: 'm-1' });
    await appendChatMessage(conv.id, { sender: 'user', text: 'B' });
    expect(((await getChat(conv.id))!.providerMeta as { model?: string }).model).toBe('m-1');
  });

  it('rejects appends to non-chat conversations', async () => {
    await expect(
      appendChatMessage('missing-id', { sender: 'user', text: 'x' })
    ).rejects.toThrow('Chat conversation not found');
  });
});

describe('listChats', () => {
  it('lists chats newest-activity first, optionally filtered by project', async () => {
    const a = await createChat({ provider: 'anthropic', firstUserMessage: 'First chat' });
    const b = await createChat({
      provider: 'anthropic',
      projectId: 'proj-1',
      firstUserMessage: 'Second chat',
    });
    await appendChatMessage(a.id, { sender: 'assistant', text: 'Reply' });

    const all = await listChats();
    expect(all.map((c) => c.id)).toEqual([a.id, b.id]);

    const scoped = await listChats('proj-1');
    expect(scoped.map((c) => c.id)).toEqual([b.id]);
  });
});

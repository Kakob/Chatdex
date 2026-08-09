// Native Chatdex chat storage (U5.1, PRD §16/§18).
//
// Chats are sources: each chat is a StoredConversation with source 'chatdex'
// plus ordinary StoredMessages, so browse/search/export and encrypted sync
// apply with no extra plumbing. Provider/model live in providerMeta; a chat
// started from a project carries an accepted user-origin ProjectAssociation
// so it participates in that project's reconciliation set.

import { db } from '../db/schema';
import { getMessagesForConversation } from '../db/messages';
import { putProjectAssociation } from '../db/understanding';
import { estimateTokens } from '../utils/tokens';
import { invalidateIndex } from '../search';
import type { LLMProviderId } from '../providers';
import type { StoredConversation, StoredMessage } from '../../types';

/** providerMeta shape for source 'chatdex' conversations. */
export interface ChatProviderMeta {
  provider: LLMProviderId;
  /** Last model that answered in this chat (subscription mode resolves it lazily). */
  model?: string;
  /** Project this chat was started from, if any. */
  projectId?: string;
  /**
   * ISO timestamp of the user accepting the context-injection disclosure for
   * this chat (U5.2). Absent ⇒ the disclosure modal gates the next send that
   * would carry project understanding.
   */
  contextDisclosedAt?: string;
  [key: string]: unknown;
}

const CHAT_NAME_MAX = 60;

/** First user message, first line, ellipsized — the chat's display name. */
export function chatNameFromMessage(text: string): string {
  const firstLine = text.trim().split('\n', 1)[0].trim();
  if (firstLine.length === 0) return 'New chat';
  return firstLine.length > CHAT_NAME_MAX
    ? `${firstLine.slice(0, CHAT_NAME_MAX - 1).trimEnd()}…`
    : firstLine;
}

export interface CreateChatOptions {
  provider: LLMProviderId;
  /** Associates the chat with a project (user-asserted, pre-accepted). */
  projectId?: string;
  firstUserMessage: string;
}

/**
 * Create a chat conversation seeded with its first user message, atomically
 * with the project association when started from a project.
 */
export async function createChat(options: CreateChatOptions): Promise<StoredConversation> {
  const now = new Date();
  const meta: ChatProviderMeta = {
    provider: options.provider,
    ...(options.projectId ? { projectId: options.projectId } : {}),
  };
  const conversation: StoredConversation = {
    id: `chatdex-${crypto.randomUUID()}`,
    source: 'chatdex',
    name: chatNameFromMessage(options.firstUserMessage),
    summary: null,
    createdAt: now,
    updatedAt: now,
    importedAt: now,
    messageCount: 1,
    userMessageCount: 1,
    assistantMessageCount: 0,
    estimatedTokens: estimateTokens(options.firstUserMessage),
    fullText: options.firstUserMessage,
    providerMeta: meta,
  };
  const message: StoredMessage = {
    id: crypto.randomUUID(),
    conversationId: conversation.id,
    sender: 'user',
    text: options.firstUserMessage,
    conversationName: conversation.name,
    createdAt: now,
  };

  await db.transaction('rw', [db.conversations, db.messages, db.projectAssociations], async () => {
    await db.conversations.put(conversation);
    await db.messages.put(message);
    if (options.projectId) {
      await putProjectAssociation({
        id: crypto.randomUUID(),
        projectId: options.projectId,
        conversationId: conversation.id,
        confidence: 1,
        reason: 'Chat started from this project',
        origin: 'user',
        reviewState: 'accepted',
        createdAt: now,
        updatedAt: now,
      });
    }
  });
  await invalidateIndex();
  return conversation;
}

export interface AppendChatMessageOptions {
  sender: 'user' | 'assistant';
  text: string;
  /** Recorded on providerMeta as the chat's last-used model. */
  model?: string;
}

/**
 * Append one message and keep the conversation's aggregates (counts, fullText,
 * estimatedTokens, updatedAt) consistent with the import pipeline's rows.
 */
export async function appendChatMessage(
  conversationId: string,
  options: AppendChatMessageOptions
): Promise<StoredMessage> {
  const now = new Date();
  const message = await db.transaction('rw', [db.conversations, db.messages], async () => {
    const conversation = await db.conversations.get(conversationId);
    if (!conversation || conversation.source !== 'chatdex') {
      throw new Error(`Chat conversation not found: ${conversationId}`);
    }
    const row: StoredMessage = {
      id: crypto.randomUUID(),
      conversationId,
      sender: options.sender,
      text: options.text,
      conversationName: conversation.name,
      createdAt: now,
    };
    await db.messages.put(row);

    const meta = { ...(conversation.providerMeta ?? {}) };
    if (options.model) meta.model = options.model;
    const fullText = conversation.fullText
      ? `${conversation.fullText}\n\n${options.text}`
      : options.text;
    await db.conversations.put({
      ...conversation,
      messageCount: conversation.messageCount + 1,
      userMessageCount: conversation.userMessageCount + (options.sender === 'user' ? 1 : 0),
      assistantMessageCount:
        conversation.assistantMessageCount + (options.sender === 'assistant' ? 1 : 0),
      fullText,
      estimatedTokens: estimateTokens(fullText),
      updatedAt: now,
      providerMeta: meta,
    });
    return row;
  });
  await invalidateIndex();
  return message;
}

/** Record that the user accepted the context-injection disclosure (U5.2). */
export async function markChatContextDisclosed(conversationId: string): Promise<void> {
  await db.transaction('rw', [db.conversations], async () => {
    const conversation = await db.conversations.get(conversationId);
    if (!conversation || conversation.source !== 'chatdex') {
      throw new Error(`Chat conversation not found: ${conversationId}`);
    }
    await db.conversations.put({
      ...conversation,
      providerMeta: {
        ...(conversation.providerMeta ?? {}),
        contextDisclosedAt: new Date().toISOString(),
      },
    });
  });
}

/** All chats, most recently active first; optionally only one project's. */
export async function listChats(projectId?: string): Promise<StoredConversation[]> {
  const chats = await db.conversations.where('source').equals('chatdex').sortBy('updatedAt');
  chats.reverse();
  return projectId
    ? chats.filter((c) => (c.providerMeta as ChatProviderMeta | undefined)?.projectId === projectId)
    : chats;
}

export async function getChat(id: string): Promise<StoredConversation | undefined> {
  const conversation = await db.conversations.get(id);
  return conversation?.source === 'chatdex' ? conversation : undefined;
}

export { getMessagesForConversation as getChatMessages };

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
  /**
   * User-picked model for this chat (U5.3). Absent ⇒ provider/CLI default.
   * Distinct from `model`, which records what actually answered last.
   */
  modelOverride?: string;
  /**
   * ISO timestamp of the chat state last fed through reconciliation (U6.1),
   * written by the reconcile engine. A chat whose updatedAt is not newer
   * than this has nothing new to reconcile.
   */
  reconciledAt?: string;
  [key: string]: unknown;
}

const CHAT_NAME_MAX = 60;
let latestChatActivityMs = 0;

function nextChatActivityTime(minimumMs = 0): Date {
  latestChatActivityMs = Math.max(Date.now(), minimumMs, latestChatActivityMs + 1);
  return new Date(latestChatActivityMs);
}

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
  const now = nextChatActivityTime();
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
  const message = await db.transaction('rw', [db.conversations, db.messages], async () => {
    const conversation = await db.conversations.get(conversationId);
    if (!conversation || conversation.source !== 'chatdex') {
      throw new Error(`Chat conversation not found: ${conversationId}`);
    }
    // Message order is the [conversationId+createdAt] index; two appends in
    // the same millisecond would tie and sort by random id, garbling the
    // history (including what gets sent back to the model). Keep timestamps
    // strictly increasing per conversation.
    const existing = await getMessagesForConversation(conversationId);
    const lastAt = existing[existing.length - 1]?.createdAt.getTime() ?? 0;
    const now = nextChatActivityTime(lastAt + 1);
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

/** Set or clear (null) the chat's user-picked model (U5.3). */
export async function setChatModelOverride(
  conversationId: string,
  model: string | null
): Promise<void> {
  await db.transaction('rw', [db.conversations], async () => {
    const conversation = await db.conversations.get(conversationId);
    if (!conversation || conversation.source !== 'chatdex') {
      throw new Error(`Chat conversation not found: ${conversationId}`);
    }
    const meta = { ...(conversation.providerMeta ?? {}) };
    if (model) meta.modelOverride = model;
    else delete meta.modelOverride;
    await db.conversations.put({ ...conversation, providerMeta: meta });
  });
}

/**
 * Remove the chat's last message if it is an assistant message (regenerate,
 * U5.3), recomputing the conversation aggregates from what remains. Returns
 * true when a message was removed.
 */
export async function deleteLastAssistantMessage(conversationId: string): Promise<boolean> {
  const removed = await db.transaction('rw', [db.conversations, db.messages], async () => {
    const conversation = await db.conversations.get(conversationId);
    if (!conversation || conversation.source !== 'chatdex') {
      throw new Error(`Chat conversation not found: ${conversationId}`);
    }
    const messages = await getMessagesForConversation(conversationId);
    const last = messages[messages.length - 1];
    if (!last || last.sender !== 'assistant') return false;

    await db.messages.delete(last.id);
    const remaining = messages.slice(0, -1);
    const fullText = remaining.map((m) => m.text).join('\n\n');
    await db.conversations.put({
      ...conversation,
      messageCount: remaining.length,
      userMessageCount: remaining.filter((m) => m.sender === 'user').length,
      assistantMessageCount: remaining.filter((m) => m.sender === 'assistant').length,
      fullText,
      estimatedTokens: estimateTokens(fullText),
      updatedAt: new Date(),
    });
    return true;
  });
  if (removed) await invalidateIndex();
  return removed;
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

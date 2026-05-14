import { db } from './schema';
import type { StoredConversation, DataSource } from '../../types';

export async function putConversation(conv: StoredConversation): Promise<void> {
  await db.conversations.put(conv);
}

export async function bulkPutConversations(convs: StoredConversation[]): Promise<void> {
  if (convs.length === 0) return;
  await db.conversations.bulkPut(convs);
}

export async function getConversation(id: string): Promise<StoredConversation | undefined> {
  return db.conversations.get(id);
}

export async function getConversations(options?: {
  source?: DataSource;
  limit?: number;
  offset?: number;
}): Promise<StoredConversation[]> {
  const { source, limit, offset = 0 } = options || {};

  const collection = source
    ? db.conversations.where('source').equals(source)
    : db.conversations.toCollection();

  const sorted = await collection.sortBy('updatedAt');
  sorted.reverse();
  return limit !== undefined ? sorted.slice(offset, offset + limit) : sorted.slice(offset);
}

export async function getConversationCount(source?: DataSource): Promise<number> {
  if (source) {
    return db.conversations.where('source').equals(source).count();
  }
  return db.conversations.count();
}

export async function deleteConversation(id: string): Promise<void> {
  await db.transaction('rw', db.conversations, db.messages, db.anchors, async () => {
    await db.conversations.delete(id);
    await db.messages.where('conversationId').equals(id).delete();
    await db.anchors.where('conversationId').equals(id).delete();
  });
}

export async function deleteConversationsBySource(source: DataSource): Promise<void> {
  const ids = await db.conversations
    .where('source')
    .equals(source)
    .primaryKeys();
  await db.transaction('rw', db.conversations, db.messages, db.anchors, async () => {
    await db.conversations.bulkDelete(ids);
    await db.messages.where('conversationId').anyOf(ids).delete();
    await db.anchors.where('conversationId').anyOf(ids).delete();
  });
}

export async function clearConversations(): Promise<void> {
  await db.transaction('rw', db.conversations, db.messages, db.anchors, async () => {
    await db.conversations.clear();
    await db.messages.clear();
    await db.anchors.clear();
  });
}

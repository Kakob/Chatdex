import { db } from './schema';
import type { StoredMessage } from '../../types';

export async function putMessage(msg: StoredMessage): Promise<void> {
  await db.messages.put(msg);
}

export async function bulkPutMessages(msgs: StoredMessage[]): Promise<void> {
  if (msgs.length === 0) return;
  await db.messages.bulkPut(msgs);
}

export async function getMessage(id: string): Promise<StoredMessage | undefined> {
  return db.messages.get(id);
}

export async function getMessagesForConversation(
  conversationId: string
): Promise<StoredMessage[]> {
  return db.messages
    .where('[conversationId+createdAt]')
    .between([conversationId, new Date(0)], [conversationId, new Date(8.64e15)])
    .toArray();
}

export async function getMessageCount(): Promise<number> {
  return db.messages.count();
}

export async function deleteMessagesForConversation(conversationId: string): Promise<void> {
  await db.messages.where('conversationId').equals(conversationId).delete();
}

import { db } from './schema';
import type { AnchoredItem } from '../aipkms/types';

export interface AnchorQuery {
  conversationId?: string;
  priority?: string;
  folder?: string;
  workspaceId?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export async function putAnchor(anchor: AnchoredItem): Promise<void> {
  await db.anchors.put(anchor);
}

export async function getAnchor(id: string): Promise<AnchoredItem | undefined> {
  return db.anchors.get(id);
}

export async function listAnchors(
  query: AnchorQuery = {}
): Promise<{ data: AnchoredItem[]; total: number }> {
  let collection = db.anchors.orderBy('createdAt').reverse();

  if (query.conversationId) {
    const cid = query.conversationId;
    collection = collection.filter((a) => a.conversationId === cid);
  }
  if (query.priority) {
    const p = query.priority;
    collection = collection.filter((a) => a.priority === p);
  }
  if (query.folder) {
    const f = query.folder;
    collection = collection.filter((a) => a.folder === f);
  }
  if (query.workspaceId) {
    const w = query.workspaceId;
    collection = collection.filter((a) => a.workspaceId === w);
  }
  if (query.search) {
    const needle = query.search.toLowerCase();
    collection = collection.filter(
      (a) =>
        a.userPrompt.toLowerCase().includes(needle) ||
        a.claudeResponse.toLowerCase().includes(needle) ||
        (a.annotation?.toLowerCase().includes(needle) ?? false) ||
        (a.selectedText?.toLowerCase().includes(needle) ?? false)
    );
  }

  const all = await collection.toArray();
  const offset = query.offset ?? 0;
  const limit = query.limit ?? all.length;
  return {
    data: all.slice(offset, offset + limit),
    total: all.length,
  };
}

export async function getAnchorsByConversation(conversationId: string): Promise<AnchoredItem[]> {
  return db.anchors.where('conversationId').equals(conversationId).toArray();
}

export async function getAnchorsByMessage(messageId: string): Promise<AnchoredItem[]> {
  return db.anchors.where('messageId').equals(messageId).toArray();
}

export async function updateAnchorRow(
  id: string,
  updates: Partial<AnchoredItem>
): Promise<AnchoredItem | undefined> {
  await db.anchors.update(id, { ...updates, updatedAt: new Date() });
  return db.anchors.get(id);
}

export async function deleteAnchor(id: string): Promise<void> {
  await db.anchors.delete(id);
}

import { db } from './schema';
import type { KnowledgeFolderRow } from './schema';

export async function listFolders(): Promise<string[]> {
  const rows = await db.knowledgeFolders.toArray();
  return rows.map((r) => r.name).sort();
}

export async function createFolder(name: string): Promise<KnowledgeFolderRow> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Folder name is required');
  const existing = await db.knowledgeFolders.where('name').equals(trimmed).first();
  if (existing) return existing;
  const row: KnowledgeFolderRow = {
    id: crypto.randomUUID(),
    name: trimmed,
    createdAt: new Date(),
  };
  await db.knowledgeFolders.put(row);
  return row;
}

export async function deleteFolder(name: string): Promise<void> {
  await db.transaction('rw', db.knowledgeFolders, db.anchors, async () => {
    await db.knowledgeFolders.where('name').equals(name).delete();
    const anchors = await db.anchors.where('folder').equals(name).toArray();
    for (const a of anchors) {
      await db.anchors.update(a.id, { folder: null, updatedAt: new Date() });
    }
  });
}

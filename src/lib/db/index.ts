// Local-first storage barrel.
// Every read/write of user data should go through this module — IndexedDB is
// the source of truth. Cloud sync (Phase 2) will replicate from here.

export { db, type ChatdexDB, type KnowledgeFolderRow } from './schema';
export * from './conversations';
export * from './messages';
export * from './activities';
export * from './anchors';
export * from './tags';
export * from './folders';
export * from './dailyStats';
export * from './metadata';

import { db } from './schema';

export async function clearAllData(): Promise<void> {
  await db.transaction(
    'rw',
    [
      db.conversations,
      db.messages,
      db.activities,
      db.anchors,
      db.tags,
      db.entityTags,
      db.knowledgeFolders,
      db.dailyStats,
      db.metadata,
    ],
    async () => {
      await db.conversations.clear();
      await db.messages.clear();
      await db.activities.clear();
      await db.anchors.clear();
      await db.tags.clear();
      await db.entityTags.clear();
      await db.knowledgeFolders.clear();
      await db.dailyStats.clear();
      await db.metadata.clear();
    }
  );
}

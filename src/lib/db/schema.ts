// Dexie (IndexedDB) schema for Chatdex local-first storage.
// Source of truth for all user data. Cloud sync (Phase 2) replicates this layer.

import Dexie, { type Table } from 'dexie';
import type {
  StoredConversation,
  StoredMessage,
  StoredActivity,
  Tag,
  EntityTag,
  AppMetadata,
  DailyStats,
} from '../../types';
import type { AnchoredItem } from '../aipkms/types';

export interface KnowledgeFolderRow {
  id: string;
  name: string;
  createdAt: Date;
}

export class ChatdexDB extends Dexie {
  conversations!: Table<StoredConversation, string>;
  messages!: Table<StoredMessage, string>;
  activities!: Table<StoredActivity, string>;
  anchors!: Table<AnchoredItem, string>;
  tags!: Table<Tag, string>;
  entityTags!: Table<EntityTag, string>;
  knowledgeFolders!: Table<KnowledgeFolderRow, string>;
  dailyStats!: Table<DailyStats, string>;
  metadata!: Table<AppMetadata, string>;

  constructor() {
    super('chatdex');
    this.version(1).stores({
      conversations: '&id, source, updatedAt, importedAt, [source+updatedAt]',
      messages: '&id, conversationId, [conversationId+createdAt], createdAt',
      activities: '&id, timestamp, source, conversationId, [source+timestamp]',
      anchors:
        '&id, conversationId, messageId, priority, folder, workspaceId, createdAt, updatedAt',
      tags: '&id, &name, category',
      entityTags:
        '&id, &[tagId+entityId+entityType], [entityType+entityId], tagId',
      knowledgeFolders: '&id, &name',
      dailyStats: '&date',
      metadata: '&key',
    });
  }
}

export const db = new ChatdexDB();

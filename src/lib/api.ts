// Local-first API surface, backed by IndexedDB (Dexie).
// Existing components import { api, tagApi, anchorApi, ApiTag, ApiAnchor, ... }
// from this module — those names are preserved as a stable client surface.
// Cloud sync (Phase 2) will sit underneath this layer, encrypting data on its
// way out to the backend; the in-app surface stays the same.

import {
  db,
  bulkPutConversations,
  getConversation as dbGetConversation,
  getConversations as dbGetConversations,
  deleteConversation as dbDeleteConversation,
  deleteConversationsBySource as dbDeleteConversationsBySource,
  bulkPutMessages,
  getMessagesForConversation as dbGetMessagesForConversation,
  addActivity as dbAddActivity,
  getActivities as dbGetActivities,
  clearActivities as dbClearActivities,
  putAnchor,
  getAnchor as dbGetAnchor,
  listAnchors as dbListAnchors,
  getAnchorsByConversation as dbGetAnchorsByConversation,
  getAnchorsByMessage as dbGetAnchorsByMessage,
  updateAnchorRow,
  deleteAnchor as dbDeleteAnchor,
  putTag,
  getTag,
  listTags as dbListTags,
  updateTag as dbUpdateTag,
  deleteTag as dbDeleteTag,
  tagEntity as dbTagEntity,
  untagEntity as dbUntagEntity,
  getEntityTags as dbGetEntityTags,
  getEntityIdsForTag,
  listFolders as dbListFolders,
  createFolder as dbCreateFolder,
  deleteFolder as dbDeleteFolder,
  getDailyStats as dbGetDailyStats,
  updateDailyStats as dbUpdateDailyStats,
  clearDailyStats,
  getMetadata as dbGetMetadata,
  setMetadata as dbSetMetadata,
  deleteMetadata as dbDeleteMetadata,
  clearMetadata as dbClearMetadata,
} from './db';
import type { StoredConversation, StoredMessage, StoredActivity, EntityType } from '../types';
import type { AnchoredItem, Priority, ContentType } from './aipkms/types';

// Errors
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

// Wire-style shapes — kept stable for components consuming them.
export interface ApiConversation {
  id: string;
  source: 'claude.ai' | 'claude-code';
  name: string;
  summary: string | null;
  createdAt: string;
  updatedAt: string;
  importedAt: string;
  messageCount: number;
  userMessageCount: number;
  assistantMessageCount: number;
  estimatedTokens: number;
  fullText: string;
  projectPath?: string;
  gitBranch?: string;
  workingDirectory?: string;
}

export interface ApiMessage {
  id: string;
  conversationId: string;
  sender: 'user' | 'assistant' | 'system' | 'tool';
  text: string;
  contentBlocks?: Array<{
    type: 'text' | 'code' | 'thinking' | 'tool_use' | 'tool_result' | 'artifact' | 'unsupported';
    text?: string;
    language?: string;
    toolName?: string;
    toolInput?: Record<string, unknown>;
    toolResult?: string;
    artifactTitle?: string;
    artifactType?: string;
  }>;
  conversationName?: string;
  createdAt: string;
  toolName?: string;
  toolInput?: string;
  toolResult?: string;
}

export interface ApiActivity {
  id: string;
  type: 'message_sent' | 'message_received' | 'artifact_created' | 'code_block' | 'tool_use' | 'tool_result';
  source: 'claude.ai' | 'extension';
  conversationId: string | null;
  conversationTitle: string | null;
  model: string | null;
  timestamp: string;
  tokens: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationTokens?: number;
    cacheReadTokens?: number;
  } | null;
  metadata: {
    messageRole?: 'user' | 'assistant';
    messagePreview?: string;
    fullContent?: string;
    userMessage?: string;
    artifactTitle?: string;
    artifactType?: string;
    codeLanguage?: string;
    codeContent?: string;
    toolName?: string;
  };
}

export interface ApiDailyStats {
  date: string;
  inputTokens: number;
  outputTokens: number;
  messageCount: number;
  artifactCount: number;
  toolUseCount: number;
  modelUsage: Record<string, number>;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

export interface ImportResult {
  conversationsAdded: number;
  conversationsSkipped: number;
  messagesAdded: number;
  source: 'claude.ai' | 'claude-code';
}

export interface ApiTag {
  id: string;
  name: string;
  color: string | null;
  category: string | null;
  usageCount: number;
  createdAt: string;
}

export interface ApiAnchor {
  id: string;
  contentType: ContentType;
  userPrompt: string;
  claudeResponse: string;
  selectedText: string | null;
  conversationId: string;
  conversationName: string | null;
  messageId: string | null;
  conversationUrl: string | null;
  messageIndex: number;
  annotation: string | null;
  priority: Priority;
  workspaceId: string | null;
  folder: string | null;
  autoTags: string[];
  relatedItemIds: string[];
  tags: ApiTag[];
  createdAt: string;
  updatedAt: string;
}

// --- shape converters ---

function toApiConversation(c: StoredConversation): ApiConversation {
  return {
    id: c.id,
    source: c.source,
    name: c.name,
    summary: c.summary,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    importedAt: c.importedAt.toISOString(),
    messageCount: c.messageCount,
    userMessageCount: c.userMessageCount,
    assistantMessageCount: c.assistantMessageCount,
    estimatedTokens: c.estimatedTokens,
    fullText: c.fullText,
    projectPath: c.projectPath,
    gitBranch: c.gitBranch,
    workingDirectory: c.workingDirectory,
  };
}

function toApiMessage(m: StoredMessage): ApiMessage {
  return {
    id: m.id,
    conversationId: m.conversationId,
    sender: m.sender,
    text: m.text,
    contentBlocks: m.contentBlocks,
    conversationName: m.conversationName,
    createdAt: m.createdAt.toISOString(),
    toolName: m.toolName,
    toolInput: m.toolInput,
    toolResult: m.toolResult,
  };
}

function toApiActivity(a: StoredActivity): ApiActivity {
  return {
    id: a.id,
    type: a.type,
    source: a.source,
    conversationId: a.conversationId,
    conversationTitle: a.conversationTitle,
    model: a.model,
    timestamp: a.timestamp.toISOString(),
    tokens: a.tokens,
    metadata: a.metadata,
  };
}

function toApiTag(t: { id: string; name: string; color: string | null; category: string | null; usageCount: number; createdAt: Date }): ApiTag {
  return {
    id: t.id,
    name: t.name,
    color: t.color,
    category: t.category,
    usageCount: t.usageCount,
    createdAt: t.createdAt.toISOString(),
  };
}

async function toApiAnchor(a: AnchoredItem): Promise<ApiAnchor> {
  const [conv, tags] = await Promise.all([
    dbGetConversation(a.conversationId),
    dbGetEntityTags('anchor', a.id),
  ]);
  return {
    id: a.id,
    contentType: a.contentType,
    userPrompt: a.userPrompt,
    claudeResponse: a.claudeResponse,
    selectedText: a.selectedText,
    conversationId: a.conversationId,
    conversationName: conv?.name ?? null,
    messageId: a.messageId,
    conversationUrl: a.conversationUrl,
    messageIndex: a.messageIndex,
    annotation: a.annotation,
    priority: a.priority,
    workspaceId: a.workspaceId,
    folder: a.folder,
    autoTags: a.autoTags,
    relatedItemIds: a.relatedItemIds,
    tags: tags.map(toApiTag),
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}

// --- conversations / messages / activities / stats / metadata / import ---

export const api = {
  async getConversations(options?: {
    source?: 'claude.ai' | 'claude-code';
    limit?: number;
    offset?: number;
  }): Promise<PaginatedResponse<ApiConversation>> {
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;
    const total = await db.conversations.count();
    const all = await dbGetConversations({ source: options?.source });
    const data = all.slice(offset, offset + limit).map(toApiConversation);
    return {
      data,
      pagination: { total, limit, offset, hasMore: offset + data.length < all.length },
    };
  },

  async getConversation(id: string): Promise<ApiConversation> {
    const c = await dbGetConversation(id);
    if (!c) throw new ApiError(404, 'Conversation not found');
    return toApiConversation(c);
  },

  async getMessagesForConversation(conversationId: string): Promise<ApiMessage[]> {
    const msgs = await dbGetMessagesForConversation(conversationId);
    return msgs.map(toApiMessage);
  },

  async deleteConversations(source?: 'claude.ai' | 'claude-code'): Promise<void> {
    if (source) {
      await dbDeleteConversationsBySource(source);
    } else {
      await db.transaction('rw', [db.conversations, db.messages, db.anchors], async () => {
        await db.conversations.clear();
        await db.messages.clear();
        await db.anchors.clear();
      });
    }
  },

  async deleteConversation(id: string): Promise<void> {
    await dbDeleteConversation(id);
  },

  async getMessages(conversationId: string): Promise<ApiMessage[]> {
    return api.getMessagesForConversation(conversationId);
  },

  async getActivities(filters?: {
    source?: 'claude.ai' | 'extension';
    types?: string;
    startDate?: string;
    endDate?: string;
    conversationId?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }): Promise<ApiActivity[]> {
    const f = {
      source: filters?.source,
      types: filters?.types ? (filters.types.split(',') as ApiActivity['type'][]) : undefined,
      dateRange:
        filters?.startDate && filters?.endDate
          ? { start: new Date(filters.startDate), end: new Date(filters.endDate) }
          : undefined,
      conversationId: filters?.conversationId,
      search: filters?.search,
    };
    const all = await dbGetActivities(f);
    const offset = filters?.offset ?? 0;
    const limit = filters?.limit ?? all.length;
    return all.slice(offset, offset + limit).map(toApiActivity);
  },

  async addActivity(activity: Omit<ApiActivity, 'id'> & { id?: string }): Promise<{ id: string }> {
    const id = activity.id || crypto.randomUUID();
    await dbAddActivity({
      id,
      type: activity.type,
      source: activity.source,
      conversationId: activity.conversationId,
      conversationTitle: activity.conversationTitle,
      model: activity.model,
      timestamp: new Date(activity.timestamp),
      tokens: activity.tokens,
      metadata: activity.metadata,
    });
    return { id };
  },

  async clearActivities(): Promise<void> {
    await dbClearActivities();
  },

  async getDailyStats(startDate: string, endDate: string): Promise<ApiDailyStats[]> {
    return dbGetDailyStats(startDate, endDate);
  },

  async recomputeStats(): Promise<{ success: boolean; daysUpdated: number }> {
    const messages = await db.messages.toArray();
    await clearDailyStats();
    const buckets = new Map<string, ApiDailyStats>();

    for (const m of messages) {
      const date = m.createdAt.toISOString().split('T')[0];
      const bucket = buckets.get(date) ?? {
        date,
        inputTokens: 0,
        outputTokens: 0,
        messageCount: 0,
        artifactCount: 0,
        toolUseCount: 0,
        modelUsage: {},
      };
      bucket.messageCount += 1;
      const estTokens = Math.ceil(m.text.length / 4);
      if (m.sender === 'user') bucket.inputTokens += estTokens;
      else if (m.sender === 'assistant') bucket.outputTokens += estTokens;
      for (const block of m.contentBlocks ?? []) {
        if (block.type === 'artifact') bucket.artifactCount += 1;
        if (block.type === 'tool_use') bucket.toolUseCount += 1;
      }
      buckets.set(date, bucket);
    }

    for (const stat of buckets.values()) {
      await dbUpdateDailyStats(stat.date, stat);
    }
    return { success: true, daysUpdated: buckets.size };
  },

  async updateDailyStats(date: string, updates: Partial<Omit<ApiDailyStats, 'date'>>): Promise<void> {
    await dbUpdateDailyStats(date, updates);
  },

  async getMetadata<T>(key: string): Promise<T | undefined> {
    return dbGetMetadata<T>(key);
  },

  async setMetadata(key: string, value: unknown): Promise<void> {
    await dbSetMetadata(key, value);
  },

  async deleteMetadata(key: string): Promise<void> {
    await dbDeleteMetadata(key);
  },

  async importData(payload: {
    conversations: Array<{
      id: string;
      source: 'claude.ai' | 'claude-code';
      name: string;
      summary?: string | null;
      createdAt: string;
      updatedAt: string;
      importedAt?: string;
      messageCount?: number;
      userMessageCount?: number;
      assistantMessageCount?: number;
      estimatedTokens?: number;
      fullText?: string;
      projectPath?: string;
      gitBranch?: string;
      workingDirectory?: string;
    }>;
    messages: Array<{
      id: string;
      conversationId: string;
      sender: 'user' | 'assistant' | 'system' | 'tool';
      text: string;
      contentBlocks?: ApiMessage['contentBlocks'];
      conversationName?: string;
      createdAt: string;
      toolName?: string;
      toolInput?: string;
      toolResult?: string;
    }>;
    source: 'claude.ai' | 'claude-code';
  }): Promise<ImportResult> {
    let added = 0;
    let skipped = 0;

    const incomingIds = payload.conversations.map((c) => c.id);
    const existing = await db.conversations.bulkGet(incomingIds);
    const existingIds = new Set(existing.filter(Boolean).map((c) => (c as StoredConversation).id));

    const toInsert: StoredConversation[] = [];
    for (const c of payload.conversations) {
      if (existingIds.has(c.id)) {
        skipped += 1;
        continue;
      }
      added += 1;
      toInsert.push({
        id: c.id,
        source: c.source,
        name: c.name,
        summary: c.summary ?? null,
        createdAt: new Date(c.createdAt),
        updatedAt: new Date(c.updatedAt),
        importedAt: c.importedAt ? new Date(c.importedAt) : new Date(),
        messageCount: c.messageCount ?? 0,
        userMessageCount: c.userMessageCount ?? 0,
        assistantMessageCount: c.assistantMessageCount ?? 0,
        estimatedTokens: c.estimatedTokens ?? 0,
        fullText: c.fullText ?? '',
        projectPath: c.projectPath,
        gitBranch: c.gitBranch,
        workingDirectory: c.workingDirectory,
      });
    }

    const insertedIds = new Set(toInsert.map((c) => c.id));
    const newMessages: StoredMessage[] = payload.messages
      .filter((m) => insertedIds.has(m.conversationId))
      .map((m) => ({
        id: m.id,
        conversationId: m.conversationId,
        sender: m.sender,
        text: m.text,
        contentBlocks: m.contentBlocks,
        conversationName: m.conversationName,
        createdAt: new Date(m.createdAt),
        toolName: m.toolName,
        toolInput: m.toolInput,
        toolResult: m.toolResult,
      }));

    await bulkPutConversations(toInsert);
    await bulkPutMessages(newMessages);

    return {
      conversationsAdded: added,
      conversationsSkipped: skipped,
      messagesAdded: newMessages.length,
      source: payload.source,
    };
  },

  async getCounts(): Promise<{
    conversations: number;
    messages: number;
    activities: number;
  }> {
    const [conversations, messages, activities] = await Promise.all([
      db.conversations.count(),
      db.messages.count(),
      db.activities.count(),
    ]);
    return { conversations, messages, activities };
  },

  async clearAllData(): Promise<void> {
    await db.transaction(
      'rw',
      [db.conversations, db.messages, db.activities, db.anchors, db.metadata],
      async () => {
        await db.conversations.clear();
        await db.messages.clear();
        await db.activities.clear();
        await db.anchors.clear();
        await db.metadata.clear();
      }
    );
  },

  async clearDataBySource(source: 'claude.ai' | 'claude-code'): Promise<void> {
    await dbDeleteConversationsBySource(source);
  },
};

// --- tags ---

export const tagApi = {
  async getTags(query?: string, category?: string): Promise<ApiTag[]> {
    const tags = await dbListTags(query, category as EntityType | undefined);
    return tags.map(toApiTag);
  },

  async createTag(input: { name: string; color?: string; category?: string }): Promise<ApiTag> {
    const id = crypto.randomUUID();
    const tag = {
      id,
      name: input.name.trim(),
      color: input.color ?? null,
      category: (input.category as EntityType | null) ?? null,
      usageCount: 0,
      createdAt: new Date(),
    };
    await putTag(tag);
    return toApiTag(tag);
  },

  async updateTag(
    id: string,
    updates: { name?: string; color?: string; category?: string }
  ): Promise<ApiTag> {
    const updated = await dbUpdateTag(id, {
      name: updates.name,
      color: updates.color,
      category: updates.category as EntityType | undefined,
    });
    if (!updated) throw new ApiError(404, 'Tag not found');
    return toApiTag(updated);
  },

  async deleteTag(id: string): Promise<void> {
    await dbDeleteTag(id);
  },

  async tagEntity(tagId: string, entityId: string, entityType: string): Promise<void> {
    await dbTagEntity(tagId, entityId, entityType as EntityType);
  },

  async untagEntity(tagId: string, entityId: string, entityType: string): Promise<void> {
    await dbUntagEntity(tagId, entityId, entityType as EntityType);
  },

  async getEntityTags(entityType: string, entityId: string): Promise<ApiTag[]> {
    const tags = await dbGetEntityTags(entityType as EntityType, entityId);
    return tags.map(toApiTag);
  },
};

// --- anchors ---

export const anchorApi = {
  async getAnchors(options?: {
    conversationId?: string;
    tagId?: string;
    priority?: string;
    folder?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }): Promise<PaginatedResponse<ApiAnchor>> {
    let anchorIdFilter: Set<string> | null = null;
    if (options?.tagId) {
      const ids = await getEntityIdsForTag(options.tagId, 'anchor');
      anchorIdFilter = new Set(ids);
    }

    const result = await dbListAnchors({
      conversationId: options?.conversationId,
      priority: options?.priority,
      folder: options?.folder,
      search: options?.search,
      limit: options?.limit,
      offset: options?.offset,
    });

    let filtered = result.data;
    if (anchorIdFilter) {
      filtered = filtered.filter((a) => anchorIdFilter!.has(a.id));
    }

    const data = await Promise.all(filtered.map(toApiAnchor));
    const limit = options?.limit ?? data.length;
    const offset = options?.offset ?? 0;
    return {
      data,
      pagination: {
        total: result.total,
        limit,
        offset,
        hasMore: offset + data.length < result.total,
      },
    };
  },

  async getAnchor(id: string): Promise<ApiAnchor> {
    const a = await dbGetAnchor(id);
    if (!a) throw new ApiError(404, 'Anchor not found');
    return toApiAnchor(a);
  },

  async getConversationAnchors(conversationId: string): Promise<Array<{
    id: string;
    messageId: string | null;
    contentType: string;
    createdAt: string;
  }>> {
    const items = await dbGetAnchorsByConversation(conversationId);
    return items.map((a) => ({
      id: a.id,
      messageId: a.messageId,
      contentType: a.contentType,
      createdAt: a.createdAt.toISOString(),
    }));
  },

  async checkAnchor(messageId: string): Promise<{ anchored: boolean; anchorIds: string[] }> {
    const items = await dbGetAnchorsByMessage(messageId);
    return {
      anchored: items.length > 0,
      anchorIds: items.map((a) => a.id),
    };
  },

  async createAnchor(data: {
    contentType: string;
    userPrompt?: string;
    claudeResponse?: string;
    selectedText?: string;
    conversationId: string;
    messageId?: string;
    conversationUrl?: string;
    messageIndex?: number;
    annotation?: string;
    priority?: string;
    workspaceId?: string;
    folder?: string;
    tagIds?: string[];
  }): Promise<ApiAnchor> {
    const now = new Date();
    const anchor: AnchoredItem = {
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
      contentType: data.contentType as ContentType,
      userPrompt: data.userPrompt ?? '',
      claudeResponse: data.claudeResponse ?? '',
      selectedText: data.selectedText ?? null,
      conversationId: data.conversationId,
      conversationUrl: data.conversationUrl ?? null,
      messageId: data.messageId ?? null,
      messageIndex: data.messageIndex ?? 0,
      tags: [],
      annotation: data.annotation ?? null,
      priority: (data.priority as Priority) ?? 'medium',
      workspaceId: data.workspaceId ?? null,
      folder: data.folder ?? null,
      autoTags: [],
      relatedItemIds: [],
    };
    await putAnchor(anchor);
    if (data.tagIds && data.tagIds.length > 0) {
      for (const tagId of data.tagIds) {
        await dbTagEntity(tagId, anchor.id, 'anchor');
      }
    }
    return toApiAnchor(anchor);
  },

  async updateAnchor(
    id: string,
    data: {
      annotation?: string;
      priority?: string;
      workspaceId?: string;
      folder?: string;
    }
  ): Promise<ApiAnchor> {
    const updates: Partial<AnchoredItem> = {};
    if (data.annotation !== undefined) updates.annotation = data.annotation;
    if (data.priority !== undefined) updates.priority = data.priority as Priority;
    if (data.workspaceId !== undefined) updates.workspaceId = data.workspaceId;
    if (data.folder !== undefined) updates.folder = data.folder;
    const updated = await updateAnchorRow(id, updates);
    if (!updated) throw new ApiError(404, 'Anchor not found');
    return toApiAnchor(updated);
  },

  async deleteAnchor(id: string): Promise<void> {
    await dbDeleteAnchor(id);
  },

  async getFolders(): Promise<string[]> {
    return dbListFolders();
  },

  async createFolder(name: string): Promise<{ success: boolean; name: string }> {
    const row = await dbCreateFolder(name);
    return { success: true, name: row.name };
  },

  async deleteFolder(name: string): Promise<void> {
    await dbDeleteFolder(name);
  },
};

// Re-export storage layer for direct access where needed.
export { db };

// Compatibility: some code imports `getTag` directly via api
export { getTag };

// Stub for the old metadata wipe path (cleanup helpers may still call it)
export async function clearAllMetadata(): Promise<void> {
  await dbClearMetadata();
}

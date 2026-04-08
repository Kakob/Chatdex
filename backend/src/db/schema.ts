import {
  pgTable,
  text,
  timestamp,
  integer,
  jsonb,
  index,
  primaryKey,
  varchar,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// Custom types for JSONB columns
export type ContentBlock = {
  type: 'text' | 'code' | 'thinking' | 'tool_use' | 'tool_result' | 'artifact' | 'unsupported';
  text?: string;
  language?: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolResult?: string;
  artifactTitle?: string;
  artifactType?: string;
};

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
};

export type ActivityMetadata = {
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

// Conversations table
export const conversations = pgTable(
  'conversations',
  {
    id: text('id').primaryKey(),
    source: varchar('source', { length: 20 }).notNull().$type<'claude.ai' | 'claude-code'>(),
    name: text('name').notNull(),
    summary: text('summary'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    importedAt: timestamp('imported_at', { withTimezone: true }).notNull().defaultNow(),
    messageCount: integer('message_count').notNull().default(0),
    userMessageCount: integer('user_message_count').notNull().default(0),
    assistantMessageCount: integer('assistant_message_count').notNull().default(0),
    estimatedTokens: integer('estimated_tokens').notNull().default(0),
    fullText: text('full_text').notNull().default(''),
    // Claude Code specific
    projectPath: text('project_path'),
    gitBranch: text('git_branch'),
    workingDirectory: text('working_directory'),
    // Full-text search vector
    searchVector: text('search_vector')
      .generatedAlwaysAs(
        sql`to_tsvector('english', coalesce(name, '') || ' ' || coalesce(summary, '') || ' ' || coalesce(full_text, ''))`
      ),
  },
  (table) => [
    index('conversations_source_idx').on(table.source),
    index('conversations_updated_at_idx').on(table.updatedAt),
    index('conversations_search_idx').using('gin', sql`to_tsvector('english', coalesce(${table.name}, '') || ' ' || coalesce(${table.summary}, '') || ' ' || coalesce(${table.fullText}, ''))`),
  ]
);

// Messages table
export const messages = pgTable(
  'messages',
  {
    id: text('id').primaryKey(),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    sender: varchar('sender', { length: 20 }).notNull().$type<'user' | 'assistant' | 'system' | 'tool'>(),
    text: text('text').notNull(),
    contentBlocks: jsonb('content_blocks').$type<ContentBlock[]>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    conversationName: text('conversation_name'),
    // Tool use fields for backward compat
    toolName: text('tool_name'),
    toolInput: text('tool_input'),
    toolResult: text('tool_result'),
  },
  (table) => [
    index('messages_conversation_id_created_at_idx').on(table.conversationId, table.createdAt),
  ]
);

// Activities table
export const activities = pgTable(
  'activities',
  {
    id: text('id').primaryKey(),
    type: varchar('type', { length: 30 }).notNull().$type<
      'message_sent' | 'message_received' | 'artifact_created' | 'code_block' | 'tool_use' | 'tool_result'
    >(),
    source: varchar('source', { length: 20 }).notNull().$type<'claude.ai' | 'extension'>(),
    conversationId: text('conversation_id'),
    conversationTitle: text('conversation_title'),
    model: text('model'),
    timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),
    tokens: jsonb('tokens').$type<TokenUsage>(),
    metadata: jsonb('metadata').$type<ActivityMetadata>().notNull().default({}),
  },
  (table) => [
    index('activities_timestamp_idx').on(table.timestamp),
    index('activities_source_timestamp_idx').on(table.source, table.timestamp),
    index('activities_conversation_id_idx').on(table.conversationId),
  ]
);

// Daily stats table
export const dailyStats = pgTable(
  'daily_stats',
  {
    date: varchar('date', { length: 10 }).primaryKey(), // YYYY-MM-DD
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    messageCount: integer('message_count').notNull().default(0),
    artifactCount: integer('artifact_count').notNull().default(0),
    toolUseCount: integer('tool_use_count').notNull().default(0),
    modelUsage: jsonb('model_usage').$type<Record<string, number>>().notNull().default({}),
  }
);

// Metadata table (key-value store)
export const metadata = pgTable('metadata', {
  key: text('key').primaryKey(),
  value: jsonb('value'),
});

// Prompts table
export const prompts = pgTable(
  'prompts',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    content: text('content').notNull(),
    description: text('description').notNull().default(''),
    folder: text('folder'),
    tags: text('tags').array().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    usageCount: integer('usage_count').notNull().default(0),
  },
  (table) => [
    index('prompts_folder_idx').on(table.folder),
    index('prompts_created_at_idx').on(table.createdAt),
  ]
);

// Anchored items table (AIPKMS)
export const anchoredItems = pgTable(
  'anchored_items',
  {
    id: text('id').primaryKey(),
    contentType: varchar('content_type', { length: 30 })
      .notNull()
      .$type<'full_response' | 'selection' | 'prompt_response_pair'>(),
    userPrompt: text('user_prompt').notNull().default(''),
    claudeResponse: text('claude_response').notNull().default(''),
    selectedText: text('selected_text'),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    messageId: text('message_id')
      .references(() => messages.id, { onDelete: 'cascade' }),
    conversationUrl: text('conversation_url'),
    messageIndex: integer('message_index').notNull().default(0),
    annotation: text('annotation'),
    priority: varchar('priority', { length: 10 })
      .notNull()
      .default('medium')
      .$type<'low' | 'medium' | 'high'>(),
    knowledgeType: text('knowledge_type'),
    workspaceId: text('workspace_id'),
    folder: text('folder'),
    autoTags: text('auto_tags').array().notNull().default([]),
    relatedItemIds: text('related_item_ids').array().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('anchored_items_conversation_id_idx').on(table.conversationId),
    index('anchored_items_knowledge_type_idx').on(table.knowledgeType),
    index('anchored_items_priority_idx').on(table.priority),
    index('anchored_items_created_at_idx').on(table.createdAt),
    index('anchored_items_folder_idx').on(table.folder),
  ]
);

// Knowledge folders table
export const knowledgeFolders = pgTable(
  'knowledge_folders',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull().unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  }
);

// Tags table (shared across prompts, conversations, anchors, threads)
export const tags = pgTable(
  'tags',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull().unique(),
    color: text('color'), // hex color e.g. '#7c3aed'
    category: varchar('category', { length: 20 }).$type<'prompt' | 'conversation' | 'anchor' | 'thread'>(),
    usageCount: integer('usage_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('tags_name_idx').on(table.name),
    index('tags_category_idx').on(table.category),
  ]
);

// Entity tags join table (polymorphic tagging)
export const entityTags = pgTable(
  'entity_tags',
  {
    id: text('id').primaryKey(),
    tagId: text('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
    entityId: text('entity_id').notNull(),
    entityType: varchar('entity_type', { length: 20 })
      .notNull()
      .$type<'prompt' | 'conversation' | 'anchor' | 'thread'>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('entity_tags_unique_idx').on(table.tagId, table.entityId, table.entityType),
    index('entity_tags_entity_idx').on(table.entityType, table.entityId),
    index('entity_tags_tag_id_idx').on(table.tagId),
  ]
);

// Type exports for use in routes
export type Conversation = typeof conversations.$inferSelect;
export type NewConversation = typeof conversations.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type Activity = typeof activities.$inferSelect;
export type NewActivity = typeof activities.$inferInsert;
export type DailyStat = typeof dailyStats.$inferSelect;
export type NewDailyStat = typeof dailyStats.$inferInsert;
export type Metadata = typeof metadata.$inferSelect;
export type Prompt = typeof prompts.$inferSelect;
export type NewPrompt = typeof prompts.$inferInsert;
export type AnchoredItemRow = typeof anchoredItems.$inferSelect;
export type NewAnchoredItemRow = typeof anchoredItems.$inferInsert;
export type Tag = typeof tags.$inferSelect;
export type NewTag = typeof tags.$inferInsert;
export type EntityTag = typeof entityTags.$inferSelect;
export type NewEntityTag = typeof entityTags.$inferInsert;

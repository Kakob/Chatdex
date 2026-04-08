import { FastifyPluginAsync } from 'fastify';
import { db, conversations, messages, metadata, type NewConversation, type NewMessage } from '../db/index.js';
import { sql, inArray } from 'drizzle-orm';
import { recomputeDailyStats } from '../utils/statsComputer.js';
import { z } from 'zod';

const contentBlockSchema = z.object({
  type: z.enum(['text', 'code', 'thinking', 'tool_use', 'tool_result', 'artifact', 'unsupported']),
  text: z.string().optional(),
  language: z.string().optional(),
  toolName: z.string().optional(),
  toolInput: z.record(z.unknown()).optional(),
  toolResult: z.string().optional(),
  artifactTitle: z.string().optional(),
  artifactType: z.string().optional(),
});

const importConversationSchema = z.object({
  id: z.string(),
  source: z.enum(['claude.ai', 'claude-code']),
  name: z.string(),
  summary: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  importedAt: z.string().optional(),
  messageCount: z.number().default(0),
  userMessageCount: z.number().default(0),
  assistantMessageCount: z.number().default(0),
  estimatedTokens: z.number().default(0),
  fullText: z.string().default(''),
  projectPath: z.string().optional(),
  gitBranch: z.string().optional(),
  workingDirectory: z.string().optional(),
});

const importMessageSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  sender: z.enum(['user', 'assistant', 'system', 'tool']),
  text: z.string(),
  contentBlocks: z.array(contentBlockSchema).optional(),
  createdAt: z.string(),
  conversationName: z.string().optional(),
  toolName: z.string().optional(),
  toolInput: z.string().optional(),
  toolResult: z.string().optional(),
});

const importPayloadSchema = z.object({
  conversations: z.array(importConversationSchema),
  messages: z.array(importMessageSchema),
  source: z.enum(['claude.ai', 'claude-code']),
});

export const importRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /api/import - Bulk import conversations and messages
  fastify.post('/', async (request, reply) => {
    const payload = importPayloadSchema.parse(request.body);

    // Get existing conversation IDs to detect duplicates
    const existingIds = new Set(
      (await db
        .select({ id: conversations.id })
        .from(conversations)
        .where(
          inArray(
            conversations.id,
            payload.conversations.map((c) => c.id)
          )
        )
      ).map((c) => c.id)
    );

    // Build conversation name lookup
    const conversationNameMap = new Map(
      payload.conversations.map((c) => [c.id, c.name])
    );

    // Filter out duplicates
    const newConversations = payload.conversations.filter((c) => !existingIds.has(c.id));
    const newConversationIds = new Set(newConversations.map((c) => c.id));
    const newMessages = payload.messages.filter((m) => newConversationIds.has(m.conversationId));

    // Insert conversations
    if (newConversations.length > 0) {
      const conversationValues: NewConversation[] = newConversations.map((c) => ({
        id: c.id,
        source: c.source,
        name: c.name,
        summary: c.summary ?? null,
        createdAt: new Date(c.createdAt),
        updatedAt: new Date(c.updatedAt),
        importedAt: c.importedAt ? new Date(c.importedAt) : new Date(),
        messageCount: c.messageCount,
        userMessageCount: c.userMessageCount,
        assistantMessageCount: c.assistantMessageCount,
        estimatedTokens: c.estimatedTokens,
        fullText: c.fullText,
        projectPath: c.projectPath,
        gitBranch: c.gitBranch,
        workingDirectory: c.workingDirectory,
      }));

      // Insert in chunks to avoid query size limits
      const chunkSize = 100;
      for (let i = 0; i < conversationValues.length; i += chunkSize) {
        const chunk = conversationValues.slice(i, i + chunkSize);
        await db.insert(conversations).values(chunk).onConflictDoNothing();
      }
    }

    // Insert messages
    if (newMessages.length > 0) {
      const messageValues: NewMessage[] = newMessages.map((m) => ({
        id: m.id,
        conversationId: m.conversationId,
        sender: m.sender,
        text: m.text,
        contentBlocks: m.contentBlocks,
        conversationName: m.conversationName || conversationNameMap.get(m.conversationId),
        createdAt: new Date(m.createdAt),
        toolName: m.toolName,
        toolInput: m.toolInput,
        toolResult: m.toolResult,
      }));

      // Insert in chunks
      const chunkSize = 100;
      for (let i = 0; i < messageValues.length; i += chunkSize) {
        const chunk = messageValues.slice(i, i + chunkSize);
        await db.insert(messages).values(chunk).onConflictDoNothing();
      }
    }

    // Recompute daily stats for the imported date range
    if (newMessages.length > 0) {
      const dates = newMessages.map((m) => m.createdAt.split('T')[0]);
      const minDate = dates.reduce((a, b) => (a < b ? a : b));
      const maxDate = dates.reduce((a, b) => (a > b ? a : b));
      await recomputeDailyStats(minDate, maxDate).catch(() => {
        // Stats recomputation is best-effort, don't fail the import
      });
    }

    // Update last sync metadata
    const syncKey = `lastSync.${payload.source}`;
    await db
      .insert(metadata)
      .values({ key: syncKey, value: new Date().toISOString() })
      .onConflictDoUpdate({
        target: metadata.key,
        set: { value: new Date().toISOString() },
      });

    return {
      conversationsAdded: newConversations.length,
      conversationsSkipped: payload.conversations.length - newConversations.length,
      messagesAdded: newMessages.length,
      source: payload.source,
    };
  });
};

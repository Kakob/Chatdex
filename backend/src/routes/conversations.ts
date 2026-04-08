import { FastifyPluginAsync } from 'fastify';
import { db, conversations, messages, type Conversation, type NewConversation } from '../db/index.js';
import { eq, desc, and, sql, count } from 'drizzle-orm';
import { z } from 'zod';

const querySchema = z.object({
  source: z.enum(['claude.ai', 'claude-code']).optional(),
  limit: z.coerce.number().min(1).max(10000).default(50),
  offset: z.coerce.number().min(0).default(0),
});

const conversationSchema = z.object({
  id: z.string(),
  source: z.enum(['claude.ai', 'claude-code']),
  name: z.string(),
  summary: z.string().nullable().optional(),
  createdAt: z.string().or(z.date()),
  updatedAt: z.string().or(z.date()),
  importedAt: z.string().or(z.date()).optional(),
  messageCount: z.number().default(0),
  userMessageCount: z.number().default(0),
  assistantMessageCount: z.number().default(0),
  estimatedTokens: z.number().default(0),
  fullText: z.string().default(''),
  projectPath: z.string().optional(),
  gitBranch: z.string().optional(),
  workingDirectory: z.string().optional(),
});

export const conversationsRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/conversations - List conversations with pagination and filtering
  fastify.get('/', async (request, reply) => {
    const query = querySchema.parse(request.query);

    let whereClause = undefined;
    if (query.source) {
      whereClause = eq(conversations.source, query.source);
    }

    const results = await db
      .select()
      .from(conversations)
      .where(whereClause)
      .orderBy(desc(conversations.updatedAt))
      .limit(query.limit)
      .offset(query.offset);

    // Get total count for pagination
    const [{ total }] = await db
      .select({ total: count() })
      .from(conversations)
      .where(whereClause);

    return {
      data: results.map(toApiConversation),
      pagination: {
        total,
        limit: query.limit,
        offset: query.offset,
        hasMore: query.offset + results.length < total,
      },
    };
  });

  // GET /api/conversations/:id - Get single conversation
  fastify.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { id } = request.params;

    const [conversation] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, id))
      .limit(1);

    if (!conversation) {
      return reply.status(404).send({ error: 'Conversation not found' });
    }

    return toApiConversation(conversation);
  });

  // GET /api/conversations/:id/messages - Get messages for conversation
  fastify.get<{ Params: { id: string } }>('/:id/messages', async (request, reply) => {
    const { id } = request.params;

    const results = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, id))
      .orderBy(messages.createdAt);

    return results.map((msg) => ({
      ...msg,
      createdAt: msg.createdAt.toISOString(),
    }));
  });

  // POST /api/conversations - Create conversations (bulk)
  fastify.post('/', async (request, reply) => {
    const body = z.array(conversationSchema).or(conversationSchema).parse(request.body);
    const conversationsToInsert = Array.isArray(body) ? body : [body];

    const newConversations: NewConversation[] = conversationsToInsert.map((c) => ({
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

    // Upsert conversations
    await db
      .insert(conversations)
      .values(newConversations)
      .onConflictDoUpdate({
        target: conversations.id,
        set: {
          name: sql`EXCLUDED.name`,
          summary: sql`EXCLUDED.summary`,
          updatedAt: sql`EXCLUDED.updated_at`,
          messageCount: sql`EXCLUDED.message_count`,
          userMessageCount: sql`EXCLUDED.user_message_count`,
          assistantMessageCount: sql`EXCLUDED.assistant_message_count`,
          estimatedTokens: sql`EXCLUDED.estimated_tokens`,
          fullText: sql`EXCLUDED.full_text`,
          projectPath: sql`EXCLUDED.project_path`,
          gitBranch: sql`EXCLUDED.git_branch`,
          workingDirectory: sql`EXCLUDED.working_directory`,
        },
      });

    return { inserted: newConversations.length };
  });

  // DELETE /api/conversations - Delete all or by source
  fastify.delete('/', async (request, reply) => {
    const query = z.object({
      source: z.enum(['claude.ai', 'claude-code']).optional(),
    }).parse(request.query);

    if (query.source) {
      await db.delete(conversations).where(eq(conversations.source, query.source));
    } else {
      await db.delete(conversations);
    }

    return { success: true };
  });

  // DELETE /api/conversations/:id - Delete single conversation
  fastify.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { id } = request.params;
    await db.delete(conversations).where(eq(conversations.id, id));
    return { success: true };
  });
};

// Helper to convert DB conversation to API format
function toApiConversation(conv: Conversation) {
  return {
    id: conv.id,
    source: conv.source,
    name: conv.name,
    summary: conv.summary,
    createdAt: conv.createdAt.toISOString(),
    updatedAt: conv.updatedAt.toISOString(),
    importedAt: conv.importedAt.toISOString(),
    messageCount: conv.messageCount,
    userMessageCount: conv.userMessageCount,
    assistantMessageCount: conv.assistantMessageCount,
    estimatedTokens: conv.estimatedTokens,
    fullText: conv.fullText,
    projectPath: conv.projectPath,
    gitBranch: conv.gitBranch,
    workingDirectory: conv.workingDirectory,
  };
}

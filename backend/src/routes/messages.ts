import { FastifyPluginAsync } from 'fastify';
import { db, messages, type NewMessage } from '../db/index.js';
import { eq, sql, count } from 'drizzle-orm';
import { z } from 'zod';

const messageSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  sender: z.enum(['user', 'assistant', 'system', 'tool']),
  text: z.string(),
  contentBlocks: z.array(z.object({
    type: z.enum(['text', 'code', 'thinking', 'tool_use', 'tool_result', 'artifact', 'unsupported']),
    text: z.string().optional(),
    language: z.string().optional(),
    toolName: z.string().optional(),
    toolInput: z.record(z.unknown()).optional(),
    toolResult: z.string().optional(),
    artifactTitle: z.string().optional(),
    artifactType: z.string().optional(),
  })).optional(),
  conversationName: z.string().optional(),
  createdAt: z.string().or(z.date()),
  toolName: z.string().optional(),
  toolInput: z.string().optional(),
  toolResult: z.string().optional(),
});

export const messagesRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/messages - Get messages by conversation ID
  fastify.get('/', async (request, reply) => {
    const query = z.object({
      conversationId: z.string(),
    }).parse(request.query);

    const results = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, query.conversationId))
      .orderBy(messages.createdAt);

    return results.map((msg) => ({
      ...msg,
      createdAt: msg.createdAt.toISOString(),
    }));
  });

  // POST /api/messages - Create messages (bulk)
  fastify.post('/', async (request, reply) => {
    const body = z.array(messageSchema).or(messageSchema).parse(request.body);
    const messagesToInsert = Array.isArray(body) ? body : [body];

    const newMessages: NewMessage[] = messagesToInsert.map((m) => ({
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

    // Upsert messages
    await db
      .insert(messages)
      .values(newMessages)
      .onConflictDoUpdate({
        target: messages.id,
        set: {
          text: sql`EXCLUDED.text`,
          contentBlocks: sql`EXCLUDED.content_blocks`,
          conversationName: sql`EXCLUDED.conversation_name`,
          toolName: sql`EXCLUDED.tool_name`,
          toolInput: sql`EXCLUDED.tool_input`,
          toolResult: sql`EXCLUDED.tool_result`,
        },
      });

    return { inserted: newMessages.length };
  });

  // DELETE /api/messages - Delete messages by conversation ID
  fastify.delete('/', async (request, reply) => {
    const query = z.object({
      conversationId: z.string().optional(),
    }).parse(request.query);

    if (query.conversationId) {
      await db.delete(messages).where(eq(messages.conversationId, query.conversationId));
    } else {
      await db.delete(messages);
    }

    return { success: true };
  });

  // GET /api/messages/count - Get total message count
  fastify.get('/count', async () => {
    const [{ total }] = await db.select({ total: count() }).from(messages);
    return { count: total };
  });
};

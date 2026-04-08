import { FastifyPluginAsync } from 'fastify';
import { db, anchoredItems, conversations, messages, entityTags, tags, knowledgeFolders } from '../db/index.js';
import { eq, and, ilike, or, desc, count, sql, inArray } from 'drizzle-orm';

function toApiAnchor(
  row: typeof anchoredItems.$inferSelect,
  conversationName?: string | null,
  anchorTags?: Array<{ id: string; name: string; color: string | null; category: string | null; usageCount: number; createdAt: Date }>
) {
  return {
    id: row.id,
    contentType: row.contentType,
    userPrompt: row.userPrompt,
    claudeResponse: row.claudeResponse,
    selectedText: row.selectedText,
    conversationId: row.conversationId,
    conversationName: conversationName || null,
    messageId: row.messageId,
    conversationUrl: row.conversationUrl,
    messageIndex: row.messageIndex,
    annotation: row.annotation,
    priority: row.priority,
    workspaceId: row.workspaceId,
    folder: row.folder,
    autoTags: row.autoTags,
    relatedItemIds: row.relatedItemIds,
    tags: anchorTags || [],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function getTagsForAnchor(anchorId: string) {
  return db
    .select({
      id: tags.id,
      name: tags.name,
      color: tags.color,
      category: tags.category,
      usageCount: tags.usageCount,
      createdAt: tags.createdAt,
    })
    .from(entityTags)
    .innerJoin(tags, eq(entityTags.tagId, tags.id))
    .where(and(eq(entityTags.entityType, 'anchor'), eq(entityTags.entityId, anchorId)))
    .orderBy(tags.name);
}

export const anchorRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/anchors - List with pagination + filters
  fastify.get<{
    Querystring: {
      conversationId?: string;
      tagId?: string;
      priority?: string;
      folder?: string;
      search?: string;
      limit?: string;
      offset?: string;
    };
  }>('/', async (request) => {
    const { conversationId, tagId, priority, folder, search, limit: limitStr, offset: offsetStr } = request.query;
    const limit = parseInt(limitStr || '50', 10);
    const offset = parseInt(offsetStr || '0', 10);

    const conditions = [];
    if (conversationId) conditions.push(eq(anchoredItems.conversationId, conversationId));
    if (tagId) {
      const taggedIds = db
        .select({ entityId: entityTags.entityId })
        .from(entityTags)
        .where(and(eq(entityTags.tagId, tagId), eq(entityTags.entityType, 'anchor')));
      conditions.push(inArray(anchoredItems.id, taggedIds));
    }
    if (priority) conditions.push(sql`${anchoredItems.priority} = ${priority}`);
    if (folder) conditions.push(eq(anchoredItems.folder, folder));
    if (search) {
      conditions.push(
        or(
          ilike(anchoredItems.annotation, `%${search}%`),
          ilike(anchoredItems.userPrompt, `%${search}%`),
          ilike(anchoredItems.claudeResponse, `%${search}%`)
        )
      );
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, [{ total }]] = await Promise.all([
      db
        .select({ anchor: anchoredItems, conversationName: conversations.name })
        .from(anchoredItems)
        .leftJoin(conversations, eq(anchoredItems.conversationId, conversations.id))
        .where(where)
        .orderBy(desc(anchoredItems.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ total: count() }).from(anchoredItems).where(where),
    ]);

    // Batch-fetch tags for all anchors
    const anchorsWithTags = await Promise.all(
      rows.map(async (r) => {
        const anchorTags = await getTagsForAnchor(r.anchor.id);
        return toApiAnchor(r.anchor, r.conversationName, anchorTags);
      })
    );

    return {
      data: anchorsWithTags,
      pagination: {
        total: Number(total),
        limit,
        offset,
        hasMore: offset + rows.length < Number(total),
      },
    };
  });

  // GET /api/anchors/folders - All folder names (registered + in-use)
  fastify.get('/folders', async () => {
    const [registered, inUse] = await Promise.all([
      db.select({ name: knowledgeFolders.name }).from(knowledgeFolders).orderBy(knowledgeFolders.name),
      db.selectDistinct({ folder: anchoredItems.folder }).from(anchoredItems)
        .where(sql`${anchoredItems.folder} IS NOT NULL AND ${anchoredItems.folder} != ''`),
    ]);
    const names = new Set(registered.map((r) => r.name));
    for (const r of inUse) if (r.folder) names.add(r.folder);
    return [...names].sort();
  });

  // POST /api/anchors/folders - Create a folder
  fastify.post<{ Body: { name: string } }>('/folders', async (request, reply) => {
    const name = request.body.name?.trim();
    if (!name) return reply.status(400).send({ error: 'Folder name is required' });
    const id = crypto.randomUUID();
    await db.insert(knowledgeFolders).values({ id, name }).onConflictDoNothing();
    return { success: true, name };
  });

  // DELETE /api/anchors/folders/:name - Delete a folder
  fastify.delete<{ Params: { name: string } }>('/folders/:name', async (request, reply) => {
    const { name } = request.params;
    const [deleted] = await db.delete(knowledgeFolders).where(eq(knowledgeFolders.name, name)).returning();
    if (!deleted) return reply.status(404).send({ error: 'Folder not found' });
    return { success: true };
  });

  // GET /api/anchors/check/:messageId - Check if message has anchors
  fastify.get<{ Params: { messageId: string } }>(
    '/check/:messageId',
    async (request) => {
      const { messageId } = request.params;
      const rows = await db
        .select({ id: anchoredItems.id })
        .from(anchoredItems)
        .where(eq(anchoredItems.messageId, messageId));

      return {
        anchored: rows.length > 0,
        anchorIds: rows.map((r) => r.id),
      };
    }
  );

  // GET /api/anchors/conversation/:conversationId - All anchors for a conversation
  fastify.get<{ Params: { conversationId: string } }>(
    '/conversation/:conversationId',
    async (request) => {
      const { conversationId } = request.params;
      const rows = await db
        .select()
        .from(anchoredItems)
        .where(eq(anchoredItems.conversationId, conversationId))
        .orderBy(desc(anchoredItems.createdAt));

      return rows.map((r) => ({
        id: r.id,
        messageId: r.messageId,
        contentType: r.contentType,
        createdAt: r.createdAt.toISOString(),
      }));
    }
  );

  // GET /api/anchors/:id - Get single anchor
  fastify.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { id } = request.params;
    const [row] = await db
      .select({ anchor: anchoredItems, conversationName: conversations.name })
      .from(anchoredItems)
      .leftJoin(conversations, eq(anchoredItems.conversationId, conversations.id))
      .where(eq(anchoredItems.id, id))
      .limit(1);

    if (!row) {
      return reply.status(404).send({ error: 'Anchor not found' });
    }

    const anchorTags = await getTagsForAnchor(id);
    return toApiAnchor(row.anchor, row.conversationName, anchorTags);
  });

  // POST /api/anchors - Create anchor
  fastify.post<{
    Body: {
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
    };
  }>('/', async (request, reply) => {
    const body = request.body;

    if (!body.conversationId || !body.contentType) {
      return reply.status(400).send({ error: 'conversationId and contentType are required' });
    }

    const id = crypto.randomUUID();
    const now = new Date();

    const [row] = await db
      .insert(anchoredItems)
      .values({
        id,
        contentType: body.contentType as 'full_response' | 'selection' | 'prompt_response_pair',
        userPrompt: body.userPrompt || '',
        claudeResponse: body.claudeResponse || '',
        selectedText: body.selectedText || null,
        conversationId: body.conversationId,
        messageId: body.messageId || null,
        conversationUrl: body.conversationUrl || null,
        messageIndex: body.messageIndex || 0,
        annotation: body.annotation || null,
        priority: (body.priority as 'low' | 'medium' | 'high') || 'medium',
        workspaceId: body.workspaceId || null,
        folder: body.folder?.trim() || null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    // Link tags via entity_tags
    if (body.tagIds && body.tagIds.length > 0) {
      await Promise.all(
        body.tagIds.map(async (tagId) => {
          await db
            .insert(entityTags)
            .values({ id: crypto.randomUUID(), tagId, entityId: id, entityType: 'anchor' })
            .onConflictDoNothing();
          await db
            .update(tags)
            .set({ usageCount: sql`${tags.usageCount} + 1` })
            .where(eq(tags.id, tagId));
        })
      );
    }

    const anchorTags = await getTagsForAnchor(id);
    return toApiAnchor(row, null, anchorTags);
  });

  // PUT /api/anchors/:id - Update anchor metadata
  fastify.put<{
    Params: { id: string };
    Body: {
      annotation?: string;
      priority?: string;
      workspaceId?: string;
      folder?: string;
    };
  }>('/:id', async (request, reply) => {
    const { id } = request.params;
    const body = request.body;

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (body.annotation !== undefined) updates.annotation = body.annotation || null;
    if (body.priority !== undefined) updates.priority = body.priority;
    if (body.workspaceId !== undefined) updates.workspaceId = body.workspaceId || null;
    if (body.folder !== undefined) updates.folder = body.folder?.trim() || null;

    const [row] = await db
      .update(anchoredItems)
      .set(updates)
      .where(eq(anchoredItems.id, id))
      .returning();

    if (!row) {
      return reply.status(404).send({ error: 'Anchor not found' });
    }

    const anchorTags = await getTagsForAnchor(id);
    return toApiAnchor(row, null, anchorTags);
  });

  // DELETE /api/anchors/:id - Delete anchor
  fastify.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { id } = request.params;

    // Clean up entity tags
    await db
      .delete(entityTags)
      .where(and(eq(entityTags.entityId, id), eq(entityTags.entityType, 'anchor')));

    const [deleted] = await db.delete(anchoredItems).where(eq(anchoredItems.id, id)).returning();

    if (!deleted) {
      return reply.status(404).send({ error: 'Anchor not found' });
    }

    return { success: true };
  });
};

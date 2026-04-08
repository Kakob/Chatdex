import { FastifyPluginAsync } from 'fastify';
import { db, tags, entityTags } from '../db/index.js';
import { eq, and, ilike, sql } from 'drizzle-orm';

export const tagRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/tags - List tags with optional search/filter
  fastify.get<{
    Querystring: { q?: string; category?: string };
  }>('/', async (request) => {
    const { q, category } = request.query;

    let query = db.select().from(tags).$dynamic();

    const conditions = [];
    if (q) {
      conditions.push(ilike(tags.name, `%${q}%`));
    }
    if (category) {
      conditions.push(eq(tags.category, category as 'prompt' | 'conversation' | 'anchor' | 'thread'));
    }

    if (conditions.length > 0) {
      query = query.where(and(...conditions));
    }

    const results = await query.orderBy(tags.name);
    return results;
  });

  // POST /api/tags - Create a tag
  fastify.post<{
    Body: { name: string; color?: string; category?: string };
  }>('/', async (request, reply) => {
    const { name, color, category } = request.body;

    if (!name || !name.trim()) {
      return reply.status(400).send({ error: 'Tag name is required' });
    }

    const id = crypto.randomUUID();
    const [tag] = await db
      .insert(tags)
      .values({
        id,
        name: name.trim().toLowerCase(),
        color: color || null,
        category: (category as 'prompt' | 'conversation' | 'anchor' | 'thread') || null,
      })
      .onConflictDoNothing({ target: tags.name })
      .returning();

    if (!tag) {
      // Tag already exists, return existing
      const [existing] = await db
        .select()
        .from(tags)
        .where(eq(tags.name, name.trim().toLowerCase()))
        .limit(1);
      return existing;
    }

    return tag;
  });

  // PUT /api/tags/:id - Update a tag
  fastify.put<{
    Params: { id: string };
    Body: { name?: string; color?: string; category?: string };
  }>('/:id', async (request, reply) => {
    const { id } = request.params;
    const { name, color, category } = request.body;

    const updates: Record<string, unknown> = {};
    if (name !== undefined) updates.name = name.trim().toLowerCase();
    if (color !== undefined) updates.color = color;
    if (category !== undefined) updates.category = category;

    if (Object.keys(updates).length === 0) {
      return reply.status(400).send({ error: 'No fields to update' });
    }

    const [updated] = await db
      .update(tags)
      .set(updates)
      .where(eq(tags.id, id))
      .returning();

    if (!updated) {
      return reply.status(404).send({ error: 'Tag not found' });
    }

    return updated;
  });

  // DELETE /api/tags/:id - Delete a tag (cascades to entity_tags)
  fastify.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { id } = request.params;
    const [deleted] = await db.delete(tags).where(eq(tags.id, id)).returning();

    if (!deleted) {
      return reply.status(404).send({ error: 'Tag not found' });
    }

    return { success: true };
  });

  // POST /api/tags/entity - Attach tag to entity
  fastify.post<{
    Body: { tagId: string; entityId: string; entityType: string };
  }>('/entity', async (request, reply) => {
    const { tagId, entityId, entityType } = request.body;

    if (!tagId || !entityId || !entityType) {
      return reply.status(400).send({ error: 'tagId, entityId, and entityType are required' });
    }

    const id = crypto.randomUUID();
    const [result] = await db
      .insert(entityTags)
      .values({
        id,
        tagId,
        entityId,
        entityType: entityType as 'prompt' | 'conversation' | 'anchor' | 'thread',
      })
      .onConflictDoNothing()
      .returning();

    // Increment usage count
    if (result) {
      await db
        .update(tags)
        .set({ usageCount: sql`${tags.usageCount} + 1` })
        .where(eq(tags.id, tagId));
    }

    return result || { success: true, existing: true };
  });

  // DELETE /api/tags/entity - Detach tag from entity
  fastify.delete<{
    Body: { tagId: string; entityId: string; entityType: string };
  }>('/entity', async (request, reply) => {
    const { tagId, entityId, entityType } = request.body;

    if (!tagId || !entityId || !entityType) {
      return reply.status(400).send({ error: 'tagId, entityId, and entityType are required' });
    }

    const [deleted] = await db
      .delete(entityTags)
      .where(
        and(
          eq(entityTags.tagId, tagId),
          eq(entityTags.entityId, entityId),
          eq(entityTags.entityType, entityType as 'prompt' | 'conversation' | 'anchor' | 'thread')
        )
      )
      .returning();

    // Decrement usage count
    if (deleted) {
      await db
        .update(tags)
        .set({ usageCount: sql`GREATEST(${tags.usageCount} - 1, 0)` })
        .where(eq(tags.id, tagId));
    }

    return { success: true };
  });

  // GET /api/tags/entity/:entityType/:entityId - Get tags for an entity
  fastify.get<{
    Params: { entityType: string; entityId: string };
  }>('/entity/:entityType/:entityId', async (request) => {
    const { entityType, entityId } = request.params;

    const results = await db
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
      .where(
        and(
          eq(entityTags.entityType, entityType as 'prompt' | 'conversation' | 'anchor' | 'thread'),
          eq(entityTags.entityId, entityId)
        )
      )
      .orderBy(tags.name);

    return results;
  });
};

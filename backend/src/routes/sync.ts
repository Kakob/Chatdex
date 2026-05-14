import type { FastifyInstance } from 'fastify';
import { and, eq, gt, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db, syncRecords, type SyncRecord } from '../db/index.js';
import { b64ToBuf, bufToB64 } from '../utils/binary.js';

const KindSchema = z.enum([
  'conversation',
  'message',
  'activity',
  'anchor',
  'tag',
  'entity_tag',
  'folder',
  'daily_stats',
  'metadata',
]);

const PushRecordSchema = z.object({
  id: z.string().min(1),
  kind: KindSchema,
  parentId: z.string().min(1).nullable().optional(),
  iv: z.string().min(1),
  ciphertext: z.string().min(1),
  updatedAt: z.string().min(1),
  deleted: z.boolean().optional(),
});

const PushSchema = z.object({
  records: z.array(PushRecordSchema).max(1000),
});

const MAX_PULL = 1000;

function rowToWire(r: SyncRecord) {
  return {
    id: r.id,
    kind: r.kind,
    parentId: r.parentId,
    iv: bufToB64(r.iv),
    ciphertext: bufToB64(r.ciphertext),
    updatedAt: r.updatedAt.toISOString(),
    deleted: r.deleted,
  };
}

export async function syncRoutes(app: FastifyInstance) {
  // Push a batch of upserts. Last-write-wins by updatedAt: existing rows with
  // a newer updatedAt are kept; older incoming records are ignored.
  app.post('/push', { preHandler: app.authenticate }, async (req, reply) => {
    const parsed = PushSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.message });
    }
    const { records } = parsed.data;
    if (records.length === 0) {
      return { accepted: 0, serverTime: new Date().toISOString() };
    }

    const incomingIds = records.map((r) => r.id);
    const existing = await db
      .select({ id: syncRecords.id, updatedAt: syncRecords.updatedAt })
      .from(syncRecords)
      .where(
        and(eq(syncRecords.userId, req.userId), inArray(syncRecords.id, incomingIds))
      );
    const existingMap = new Map(existing.map((r) => [r.id, r.updatedAt]));

    let accepted = 0;
    for (const rec of records) {
      const incomingDate = new Date(rec.updatedAt);
      const existingDate = existingMap.get(rec.id);
      if (existingDate && existingDate >= incomingDate) {
        continue; // server has newer or equal — skip
      }
      const row = {
        id: rec.id,
        userId: req.userId,
        kind: rec.kind,
        parentId: rec.parentId ?? null,
        iv: b64ToBuf(rec.iv),
        ciphertext: b64ToBuf(rec.ciphertext),
        updatedAt: incomingDate,
        deleted: rec.deleted ?? false,
      };
      await db
        .insert(syncRecords)
        .values(row)
        .onConflictDoUpdate({
          target: [syncRecords.userId, syncRecords.id],
          set: {
            kind: row.kind,
            parentId: row.parentId,
            iv: row.iv,
            ciphertext: row.ciphertext,
            updatedAt: row.updatedAt,
            deleted: row.deleted,
          },
        });
      accepted += 1;
    }

    return { accepted, serverTime: new Date().toISOString() };
  });

  // Pull all records updated after `since`, scoped to the authenticated user.
  // Returns up to `limit` records ordered by updatedAt asc, plus a cursor
  // (the updatedAt of the last record) so the client can resume.
  app.get('/pull', { preHandler: app.authenticate }, async (req, reply) => {
    const params = req.query as { since?: string; limit?: string };
    const since = params.since ? new Date(params.since) : new Date(0);
    if (Number.isNaN(since.getTime())) {
      return reply.code(400).send({ error: 'Invalid since timestamp' });
    }
    const limit = Math.min(Number(params.limit ?? MAX_PULL), MAX_PULL);

    const rows = await db
      .select()
      .from(syncRecords)
      .where(and(eq(syncRecords.userId, req.userId), gt(syncRecords.updatedAt, since)))
      .orderBy(syncRecords.updatedAt)
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;
    const cursor =
      data.length > 0 ? data[data.length - 1].updatedAt.toISOString() : params.since ?? null;

    return {
      records: data.map(rowToWire),
      cursor,
      hasMore,
    };
  });

  // Authenticated: delete every record for this user. Used by the
  // "disable cloud sync and wipe server data" settings flow.
  app.delete('/all', { preHandler: app.authenticate }, async (req) => {
    await db.delete(syncRecords).where(eq(syncRecords.userId, req.userId));
    return { success: true };
  });
}

import { FastifyPluginAsync } from 'fastify';
import { db, dailyStats } from '../db/index.js';
import { eq, and, gte, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { recomputeDailyStats } from '../utils/statsComputer.js';

const dateRangeSchema = z.object({
  startDate: z.string(), // YYYY-MM-DD
  endDate: z.string(),   // YYYY-MM-DD
});

const dailyStatsSchema = z.object({
  inputTokens: z.number().optional(),
  outputTokens: z.number().optional(),
  messageCount: z.number().optional(),
  artifactCount: z.number().optional(),
  toolUseCount: z.number().optional(),
  modelUsage: z.record(z.number()).optional(),
});

export const statsRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/stats/daily - Get daily stats by date range
  fastify.get('/daily', async (request, reply) => {
    const query = dateRangeSchema.parse(request.query);

    const results = await db
      .select()
      .from(dailyStats)
      .where(
        and(
          gte(dailyStats.date, query.startDate),
          lte(dailyStats.date, query.endDate)
        )
      )
      .orderBy(dailyStats.date);

    return results;
  });

  // PUT /api/stats/daily/:date - Update daily stats
  fastify.put<{ Params: { date: string } }>('/daily/:date', async (request, reply) => {
    const { date } = request.params;
    const updates = dailyStatsSchema.parse(request.body);

    const [existing] = await db.select().from(dailyStats).where(eq(dailyStats.date, date));

    if (existing) {
      await db
        .update(dailyStats)
        .set({
          inputTokens: updates.inputTokens ?? existing.inputTokens,
          outputTokens: updates.outputTokens ?? existing.outputTokens,
          messageCount: updates.messageCount ?? existing.messageCount,
          artifactCount: updates.artifactCount ?? existing.artifactCount,
          toolUseCount: updates.toolUseCount ?? existing.toolUseCount,
          modelUsage: updates.modelUsage ?? existing.modelUsage,
        })
        .where(eq(dailyStats.date, date));
    } else {
      await db.insert(dailyStats).values({
        date,
        inputTokens: updates.inputTokens ?? 0,
        outputTokens: updates.outputTokens ?? 0,
        messageCount: updates.messageCount ?? 0,
        artifactCount: updates.artifactCount ?? 0,
        toolUseCount: updates.toolUseCount ?? 0,
        modelUsage: updates.modelUsage ?? {},
      });
    }

    return { success: true };
  });

  // POST /api/stats/recompute - Recompute all daily stats from messages
  fastify.post('/recompute', async () => {
    const result = await recomputeDailyStats();
    return { success: true, ...result };
  });

  // DELETE /api/stats/daily - Clear all daily stats
  fastify.delete('/daily', async () => {
    await db.delete(dailyStats);
    return { success: true };
  });
};

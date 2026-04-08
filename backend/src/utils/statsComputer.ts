import { db, messages, dailyStats } from '../db/index.js';
import { sql, and, gte, lte } from 'drizzle-orm';

/**
 * Recompute daily_stats from messages for a given date range.
 * If no date range provided, recomputes for all dates.
 */
export async function recomputeDailyStats(startDate?: string, endDate?: string) {
  // Query messages grouped by date
  const conditions = [];
  if (startDate) conditions.push(gte(sql`DATE(${messages.createdAt})`, startDate));
  if (endDate) conditions.push(lte(sql`DATE(${messages.createdAt})`, endDate));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db.execute<{
    date: string;
    message_count: string;
    tool_use_count: string;
    artifact_count: string;
    estimated_tokens: string;
  }>(sql`
    SELECT
      DATE(${messages.createdAt}) as date,
      COUNT(*) FILTER (WHERE ${messages.sender} IN ('user', 'assistant')) as message_count,
      COUNT(*) FILTER (WHERE ${messages.sender} = 'tool') as tool_use_count,
      COUNT(*) FILTER (
        WHERE ${messages.contentBlocks}::text LIKE '%"type":"artifact"%'
      ) as artifact_count,
      SUM(LENGTH(${messages.text})) / 4 as estimated_tokens
    FROM ${messages}
    ${where ? sql`WHERE ${where}` : sql``}
    GROUP BY DATE(${messages.createdAt})
    ORDER BY date
  `);

  // Upsert each day
  for (const row of rows) {
    const date = typeof row.date === 'string'
      ? row.date.split('T')[0]
      : new Date(row.date as unknown as string).toISOString().split('T')[0];
    const messageCount = parseInt(row.message_count || '0', 10);
    const toolUseCount = parseInt(row.tool_use_count || '0', 10);
    const artifactCount = parseInt(row.artifact_count || '0', 10);
    const estimatedTokens = parseInt(row.estimated_tokens || '0', 10);

    // Split tokens roughly 60/40 input/output
    const inputTokens = Math.round(estimatedTokens * 0.4);
    const outputTokens = Math.round(estimatedTokens * 0.6);

    await db
      .insert(dailyStats)
      .values({
        date,
        inputTokens,
        outputTokens,
        messageCount,
        artifactCount,
        toolUseCount,
        modelUsage: {},
      })
      .onConflictDoUpdate({
        target: dailyStats.date,
        set: {
          inputTokens: sql`EXCLUDED.input_tokens`,
          outputTokens: sql`EXCLUDED.output_tokens`,
          messageCount: sql`EXCLUDED.message_count`,
          artifactCount: sql`EXCLUDED.artifact_count`,
          toolUseCount: sql`EXCLUDED.tool_use_count`,
        },
      });
  }

  return { daysUpdated: rows.length };
}

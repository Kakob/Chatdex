import { db } from './schema';
import type { DailyStats } from '../../types';

export async function getDailyStats(startDate: string, endDate: string): Promise<DailyStats[]> {
  return db.dailyStats
    .where('date')
    .between(startDate, endDate, true, true)
    .toArray();
}

export async function getDailyStat(date: string): Promise<DailyStats | undefined> {
  return db.dailyStats.get(date);
}

export async function updateDailyStats(
  date: string,
  updates: Partial<Omit<DailyStats, 'date'>>
): Promise<void> {
  const existing = await db.dailyStats.get(date);
  if (existing) {
    await db.dailyStats.put({ ...existing, ...updates });
  } else {
    await db.dailyStats.put({
      date,
      inputTokens: 0,
      outputTokens: 0,
      messageCount: 0,
      artifactCount: 0,
      toolUseCount: 0,
      modelUsage: {},
      ...updates,
    });
  }
}

export async function clearDailyStats(): Promise<void> {
  await db.dailyStats.clear();
}

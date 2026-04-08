import { describe, it, expect } from 'vitest';
import { aggregateStats, getDateRangeString, getDefaultDateRange } from './analytics';
import type { DailyStats } from '../types';

const makeDayStats = (overrides: Partial<DailyStats> = {}): DailyStats => ({
  date: '2026-01-15',
  inputTokens: 1000,
  outputTokens: 2000,
  messageCount: 10,
  artifactCount: 2,
  toolUseCount: 3,
  modelUsage: { 'claude-3-5-sonnet': 8 },
  ...overrides,
});

describe('aggregateStats', () => {
  it('returns zeroed stats for empty input', () => {
    const result = aggregateStats([]);
    expect(result.totalTokens).toBe(0);
    expect(result.totalMessages).toBe(0);
    expect(result.uniqueDays).toBe(0);
    expect(result.dailyData).toEqual([]);
  });

  it('sums tokens across days', () => {
    const result = aggregateStats([
      makeDayStats({ date: '2026-01-15', inputTokens: 1000, outputTokens: 2000 }),
      makeDayStats({ date: '2026-01-16', inputTokens: 500, outputTokens: 1500 }),
    ]);
    expect(result.totalInputTokens).toBe(1500);
    expect(result.totalOutputTokens).toBe(3500);
    expect(result.totalTokens).toBe(5000);
  });

  it('computes averages', () => {
    const result = aggregateStats([
      makeDayStats({ messageCount: 10 }),
      makeDayStats({ date: '2026-01-16', messageCount: 20 }),
    ]);
    expect(result.avgMessagesPerDay).toBe(15);
    expect(result.uniqueDays).toBe(2);
  });

  it('merges model usage across days', () => {
    const result = aggregateStats([
      makeDayStats({ modelUsage: { 'sonnet': 5, 'opus': 2 } }),
      makeDayStats({ date: '2026-01-16', modelUsage: { 'sonnet': 3, 'haiku': 1 } }),
    ]);
    expect(result.modelUsage).toEqual({ 'sonnet': 8, 'opus': 2, 'haiku': 1 });
  });

  it('sorts dailyData by date', () => {
    const result = aggregateStats([
      makeDayStats({ date: '2026-01-17' }),
      makeDayStats({ date: '2026-01-15' }),
      makeDayStats({ date: '2026-01-16' }),
    ]);
    expect(result.dailyData.map((d) => d.date)).toEqual(['2026-01-15', '2026-01-16', '2026-01-17']);
  });

  it('populates dailyData with computed totalTokens', () => {
    const result = aggregateStats([makeDayStats({ inputTokens: 100, outputTokens: 200 })]);
    expect(result.dailyData[0].totalTokens).toBe(300);
  });
});

describe('getDateRangeString', () => {
  it('formats dates as YYYY-MM-DD', () => {
    const { start, end } = getDateRangeString({
      start: new Date('2026-01-15T00:00:00Z'),
      end: new Date('2026-01-20T23:59:59Z'),
    });
    expect(start).toBe('2026-01-15');
    expect(end).toBe('2026-01-20');
  });
});

describe('getDefaultDateRange', () => {
  it('returns a range spanning the given number of days', () => {
    const range = getDefaultDateRange(7);
    const diff = range.end.getTime() - range.start.getTime();
    const days = diff / (1000 * 60 * 60 * 24);
    // start is set to midnight 7 days ago, end is now, so span is 7–8 days
    expect(days).toBeGreaterThanOrEqual(7);
    expect(days).toBeLessThanOrEqual(8);
  });
});

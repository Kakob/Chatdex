import { useMemo, useState } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import type { WeekBucket } from '../../lib/detection/stats';
import { detectorLabel } from './severity';

const SEVERITY_COLORS: Record<string, string> = {
  high: '#ef4444',
  medium: '#f97316',
  low: '#eab308',
  info: '#0ea5e9',
};

// Detector series colors assigned by first appearance; unknown detectors get
// the next palette slot — no per-detector UI requirement.
const DETECTOR_PALETTE = ['#8b5cf6', '#f59e0b', '#10b981', '#3b82f6', '#ec4899', '#14b8a6'];

type GroupMode = 'severity' | 'detector';

export function FindingsOverTimeChart({ buckets }: { buckets: WeekBucket[] }) {
  const [mode, setMode] = useState<GroupMode>('severity');

  const { rows, seriesKeys } = useMemo(() => {
    const keys = new Set<string>();
    const rows = buckets.map((bucket) => {
      const source = mode === 'severity' ? bucket.bySeverity : bucket.byDetector;
      for (const key of Object.keys(source)) keys.add(key);
      return { weekStart: bucket.weekStart, ...source };
    });
    const order =
      mode === 'severity'
        ? ['info', 'low', 'medium', 'high'].filter((k) => keys.has(k))
        : [...keys].sort();
    return { rows, seriesKeys: order };
  }, [buckets, mode]);

  return (
    <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
          Findings over time
        </h3>
        <div className="flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden text-xs">
          {(['severity', 'detector'] as GroupMode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-2.5 py-1 font-medium transition-colors ${
                mode === m
                  ? 'bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300'
                  : 'text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800'
              }`}
            >
              By {m}
            </button>
          ))}
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="h-64 flex items-center justify-center text-gray-400 dark:text-gray-500 text-sm">
          No findings yet — analyze some sessions first
        </div>
      ) : (
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.3} />
              <XAxis
                dataKey="weekStart"
                stroke="#9CA3AF"
                fontSize={12}
                tickFormatter={(value: string) =>
                  new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                }
              />
              <YAxis stroke="#9CA3AF" fontSize={12} allowDecimals={false} />
              <Tooltip
                labelFormatter={(value) => `Week of ${value}`}
                formatter={(count: number | undefined, key: string | undefined) => [
                  count ?? 0,
                  mode === 'detector' && key ? detectorLabel(key) : key ?? '',
                ]}
              />
              <Legend
                formatter={(key: string) =>
                  mode === 'detector' ? detectorLabel(key) : key
                }
              />
              {seriesKeys.map((key, i) => (
                <Bar
                  key={key}
                  dataKey={key}
                  stackId="findings"
                  fill={
                    mode === 'severity'
                      ? SEVERITY_COLORS[key] ?? '#9ca3af'
                      : DETECTOR_PALETTE[i % DETECTOR_PALETTE.length]
                  }
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

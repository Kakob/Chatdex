import { Activity } from 'lucide-react';
import type { DetectorHealth } from '../../lib/detection/stats';
import { detectorLabel } from './severity';

// Detector health, surfaced honestly (SPEC §5.2): the false-positive rate
// comes straight from user labels, including when it's unflattering.
export function DetectorHealthCards({ health }: { health: DetectorHealth[] }) {
  if (health.length === 0) return null;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      {health.map((d) => (
        <div
          key={d.detector}
          className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-4"
        >
          <div className="flex items-center gap-2 mb-3">
            <Activity size={14} className="text-violet-500" />
            <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {detectorLabel(d.detector)}
            </h4>
          </div>
          <div className="space-y-1 text-xs text-gray-600 dark:text-gray-400">
            <Row label="Findings" value={String(d.total)} />
            <Row label="Confirmed" value={String(d.confirmed)} />
            <Row label="False positives" value={String(d.falsePositives)} />
            <Row label="Unlabeled" value={String(d.unlabeled)} />
            <Row
              label="False-positive rate"
              value={
                d.falsePositiveRate === null
                  ? 'no labels yet'
                  : `${Math.round(d.falsePositiveRate * 100)}%`
              }
              emphasize={d.falsePositiveRate !== null && d.falsePositiveRate > 0.25}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function Row({
  label,
  value,
  emphasize,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
}) {
  return (
    <div className="flex justify-between">
      <span>{label}</span>
      <span
        className={
          emphasize
            ? 'font-semibold text-rose-600 dark:text-rose-400'
            : 'font-medium text-gray-800 dark:text-gray-200'
        }
      >
        {value}
      </span>
    </div>
  );
}

import type { FindingChipSummary } from '../../lib/detection/stats';
import { SEVERITY_BADGE, detectorLabel } from './severity';

interface FindingChipsProps {
  summaries: FindingChipSummary[];
}

export function FindingChips({ summaries }: FindingChipsProps) {
  if (summaries.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1 mt-2">
      {summaries.map((summary) => (
        <span
          key={summary.detector}
          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium ${SEVERITY_BADGE[summary.maxSeverity]}`}
        >
          {detectorLabel(summary.detector)}
          <span className="opacity-70">×{summary.count}</span>
        </span>
      ))}
    </div>
  );
}

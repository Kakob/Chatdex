import { CheckCircle2, AlertTriangle } from 'lucide-react';
import { busiestSpan } from '../../lib/detection/stats';
import type { StoredFinding } from '../../types/detection';
import { SEVERITY_BADGE, SEVERITY_LABEL, SEVERITY_ORDER } from './severity';

interface SessionReportProps {
  findings: StoredFinding[];
  /** Whether at least one DetectorRun exists for this session. */
  analyzed: boolean;
}

// Per-session report block (SPEC §5.3). Kept to one slim line — the inline
// markers carry the detail.
export function SessionReport({ findings, analyzed }: SessionReportProps) {
  if (!analyzed) return null;

  if (findings.length === 0) {
    return (
      <div
        data-testid="session-report"
        className="flex items-center gap-2 px-3 py-2 mb-4 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-700 dark:text-emerald-300"
      >
        <CheckCircle2 size={14} />
        No failure patterns detected in this session.
      </div>
    );
  }

  const counts: Record<string, number> = {};
  for (const f of findings) counts[f.severity] = (counts[f.severity] ?? 0) + 1;
  const span = busiestSpan(findings);

  return (
    <div
      data-testid="session-report"
      className="flex flex-wrap items-center gap-2 px-3 py-2 mb-4 rounded-lg bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 text-xs text-gray-600 dark:text-gray-400"
    >
      <AlertTriangle size={14} className="text-orange-500" />
      <span className="font-medium text-gray-800 dark:text-gray-200">
        {findings.length} finding{findings.length === 1 ? '' : 's'}
      </span>
      {SEVERITY_ORDER.filter((sev) => counts[sev]).map((sev) => (
        <span
          key={sev}
          className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium ${SEVERITY_BADGE[sev]}`}
        >
          {counts[sev]} {SEVERITY_LABEL[sev]}
        </span>
      ))}
      {span && (
        <span className="ml-auto">
          busiest span: steps {span.start}–{span.end}
          {span.findingCount > 1 && ` (${span.findingCount} overlapping findings)`}
        </span>
      )}
    </div>
  );
}

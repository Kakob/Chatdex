import { AlertTriangle } from 'lucide-react';
import { useFindingsStore } from '../../stores/findingsStore';
import type { StoredFinding } from '../../types/detection';
import { SEVERITY_BADGE, detectorLabel } from './severity';

/** Inline severity-coded markers rendered where findings anchor. */
export function FindingMarkers({ findings }: { findings: StoredFinding[] }) {
  const selectFinding = useFindingsStore((s) => s.selectFinding);
  const selectedId = useFindingsStore((s) => s.selectedFindingId);

  if (findings.length === 0) return null;

  return (
    <span className="inline-flex items-center gap-1">
      {findings.map((finding) => (
        <button
          key={finding.id}
          onClick={(e) => {
            e.stopPropagation();
            selectFinding(finding.id);
          }}
          title={finding.summary}
          data-testid={`finding-marker-${finding.id}`}
          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium transition-shadow ${
            SEVERITY_BADGE[finding.severity]
          } ${selectedId === finding.id ? 'ring-2 ring-violet-400' : 'hover:ring-1 hover:ring-violet-300'}`}
        >
          <AlertTriangle size={10} />
          {detectorLabel(finding.detector)}
        </button>
      ))}
    </span>
  );
}

// "From workspace …" provenance line on a promoted understanding object
// (SPEC-change-workspace §14, PRD §17; CW-6): verified vs AI-inferred
// relationships, open questions, and how often the workspace's sources were
// personally inspected — computed, never claimed.

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { loadFromWorkspaceLine, type FromWorkspaceSummary as Line } from '../../lib/prepare/fromWorkspace';
import type { UnderstandingObject } from '../../types/understanding';

export function FromWorkspaceLine({ object }: { object: UnderstandingObject }) {
  const [line, setLine] = useState<Line | null>(null);
  useEffect(() => {
    let cancelled = false;
    void loadFromWorkspaceLine(object).then((l) => !cancelled && setLine(l));
    return () => {
      cancelled = true;
    };
  }, [object]);
  if (!line) return null;
  return (
    <p className="mt-2 text-xs text-gray-500 dark:text-gray-400" data-testid="from-workspace" onClick={(e) => e.stopPropagation()}>
      From workspace{' '}
      <Link to={`/projects/${line.projectId}/prepare?change=${encodeURIComponent(line.workspaceId)}&view=timeline`} className="text-violet-600 dark:text-violet-400 underline">
        “{line.title}”
      </Link>
      {' · '}{line.verified} verified relationship{line.verified === 1 ? '' : 's'}
      {line.aiInferred > 0 && <> · {line.aiInferred} AI-inferred</>}
      {line.unknown > 0 && <> · {line.unknown} unknown</>}
      {' · '}{line.openQuestions} open question{line.openQuestions === 1 ? '' : 's'}
      {line.inspections > 0 && <> · inspected {line.inspections}×</>}
    </p>
  );
}

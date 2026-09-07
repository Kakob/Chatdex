// Assumptions of one decision (SPEC-decision-recovery §10.3), each with its
// own basis badge and evidence. Rationale is model text and is labelled so.

import { BasisBadge } from './BasisBadge';
import { CodeEvidenceList, SpanLinks } from './EvidenceLists';
import type { DecisionAssumption } from '../../types/decision';

export function AssumptionList({
  assumptions,
  conversationNames,
  repoKey,
  sha,
}: {
  assumptions: DecisionAssumption[];
  conversationNames: Map<string, string>;
  repoKey?: string;
  sha?: string;
}) {
  if (assumptions.length === 0) {
    return <p className="text-sm text-gray-500 dark:text-gray-400">No assumptions were recovered for this decision.</p>;
  }
  return (
    <ol className="space-y-3" data-testid="assumption-list">
      {assumptions.map((a, i) => (
        <li key={a.id} className="rounded-lg border border-gray-200 dark:border-gray-800 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-gray-400">A{i + 1}</span>
            <BasisBadge basis={a.basis} small />
            {a.inheritedFrom && (
              <span className="font-mono text-[11px] text-gray-500 dark:text-gray-400" title="Inherited from">
                ← {a.inheritedFrom}
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-gray-900 dark:text-white">{a.statement}</p>
          {a.rationale && (
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              <span className="uppercase tracking-wide text-[10px] text-gray-400">AI rationale · </span>
              {a.rationale}
            </p>
          )}
          <SpanLinks spans={a.transcriptEvidence} conversationNames={conversationNames} />
          <CodeEvidenceList items={a.codeEvidence} repoKey={repoKey} sha={sha} />
        </li>
      ))}
    </ol>
  );
}

// Factual coverage by file path (SPEC-decision-investigation §10, DI-3).
// Counts and statuses only — never "understood", "mastered", or any
// comprehension score. A fully adjudicated file can still hold unknowns.

import { useEffect, useState } from 'react';
import {
  getInvestigationCoverage,
  type InvestigationCoverage,
} from '../../lib/investigation/verdicts';

export function CoverageView({
  onFilterByPath,
}: {
  /** Jump back to the anchor list filtered to this literal path. */
  onFilterByPath: (path: string) => void;
}) {
  const [coverage, setCoverage] = useState<InvestigationCoverage | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getInvestigationCoverage().then((c) => {
      if (!cancelled) setCoverage(c);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!coverage) {
    return <p className="text-gray-500 dark:text-gray-400">Computing coverage…</p>;
  }

  const { totals, files } = coverage;
  if (totals.totalAnchors === 0) {
    return (
      <p className="text-gray-500 dark:text-gray-400">
        No code-change anchors yet — import a Claude Code session or run “Derive
        anchors”.
      </p>
    );
  }

  return (
    <div>
      <p className="mb-3 text-sm text-gray-600 dark:text-gray-400 tabular-nums">
        {totals.totalAnchors} anchors across {files.length} files —{' '}
        {totals.uninvestigated} uninvestigated · {totals.open} open ·{' '}
        {totals.adjudicated} adjudicated. Counts of your adjudications, not a measure
        of understanding.
      </p>
      <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-800">
              <th className="px-3 py-2 font-medium">File</th>
              <th className="px-3 py-2 font-medium text-right">Anchors</th>
              <th className="px-3 py-2 font-medium text-right">Uninvestigated</th>
              <th className="px-3 py-2 font-medium text-right">Open</th>
              <th className="px-3 py-2 font-medium text-right">Adjudicated</th>
              <th className="px-3 py-2 font-medium">Last adjudication</th>
            </tr>
          </thead>
          <tbody>
            {files.map((file) => (
              <tr
                key={file.filePath}
                className="border-b border-gray-100 dark:border-gray-800 last:border-0"
              >
                <td className="px-3 py-2">
                  <button
                    type="button"
                    onClick={() => onFilterByPath(file.filePath)}
                    className="font-mono text-xs text-violet-600 dark:text-violet-400 hover:underline break-all text-left"
                    title="Show this file's anchors"
                  >
                    {file.filePath}
                  </button>
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-gray-700 dark:text-gray-300">
                  {file.totalAnchors}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-blue-600 dark:text-blue-400">
                  {file.uninvestigated || '—'}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-amber-600 dark:text-amber-400">
                  {file.open || '—'}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-emerald-600 dark:text-emerald-400">
                  {file.adjudicated || '—'}
                </td>
                <td className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400 tabular-nums">
                  {file.lastAdjudicatedAt?.toLocaleString() ?? '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

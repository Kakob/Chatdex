// Blast radius panel (SPEC-decision-recovery §11.2). Computed on expand from
// the local cache; every row opens its source; the whole panel is labelled
// heuristic because it is text-level (the Flow Map will replace it).

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Radar } from 'lucide-react';
import { computeBlastRadius, type BlastRadius } from '../../lib/understanding/decisions/blastRadius';
import type { DecisionTrace } from '../../types/decision';

export function BlastRadiusPanel({ trace, projectId }: { trace: DecisionTrace; projectId: string }) {
  const [radius, setRadius] = useState<BlastRadius | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    void computeBlastRadius(trace, projectId)
      .then((r) => {
        if (!cancelled) setRadius(r);
      })
      .catch(() => {
        if (!cancelled) setRadius(null);
      });
    return () => {
      cancelled = true;
    };
  }, [trace, projectId]);

  if (radius === undefined) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
        <Loader2 size={14} className="animate-spin" /> Computing from the local cache…
      </div>
    );
  }
  if (radius === null) return <p className="text-sm text-rose-600">Could not compute blast radius.</p>;

  const empty =
    radius.symbols.every((s) => s.references.length === 0) &&
    radius.relatedSessions.length === 0 &&
    radius.relatedDecisions.length === 0 &&
    radius.tests.length === 0;

  return (
    <div className="space-y-4 text-sm" data-testid="blast-radius">
      <p className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
        <Radar size={12} />
        Text-level, <span className="font-medium">heuristic</span> — where to look, not what is affected.
        {radius.snapshotMissing && ' No repository snapshot is cached for this trace; only session links are available.'}
        {radius.truncated && ' Some lists were capped.'}
      </p>
      {radius.paths.length > 0 && (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Own files: {radius.paths.map((p) => <code key={p} className="mr-2 font-mono">{p}</code>)}
        </p>
      )}
      {empty && <p className="text-gray-500 dark:text-gray-400">Nothing else in the cache or the imported sessions references this decision&apos;s symbols or files.</p>}

      {radius.symbols.some((s) => s.references.length > 0) && (
        <section>
          <h3 className="text-xs uppercase tracking-wide text-gray-400">Symbol references outside the decision&apos;s files</h3>
          <ul className="mt-1 space-y-2">
            {radius.symbols
              .filter((s) => s.references.length > 0)
              .map((s) => (
                <li key={s.name}>
                  <code className="font-mono text-violet-700 dark:text-violet-300">{s.name}</code>
                  <span className="text-xs text-gray-400"> · {s.references.length}{s.capped ? '+' : ''} reference{s.references.length !== 1 ? 's' : ''}</span>
                  <ul className="mt-1 ml-3 space-y-0.5 text-xs">
                    {s.references.slice(0, 12).map((h, i) => (
                      <li key={`${h.path}-${h.line}-${i}`} className="font-mono text-gray-600 dark:text-gray-300">
                        {h.path}:{h.line} <span className="text-gray-400">{h.text.trim().slice(0, 100)}</span>
                      </li>
                    ))}
                    {s.references.length > 12 && <li className="text-gray-400">… {s.references.length - 12} more</li>}
                  </ul>
                </li>
              ))}
          </ul>
        </section>
      )}

      {radius.relatedSessions.length > 0 && (
        <section>
          <h3 className="text-xs uppercase tracking-wide text-gray-400">Other sessions that edited these files</h3>
          <ul className="mt-1 space-y-1 text-xs">
            {radius.relatedSessions.map((s) => (
              <li key={s.conversationId}>
                <Link to={`/conversations/${s.conversationId}`} className="text-violet-600 dark:text-violet-400 hover:underline">
                  {s.name ?? s.conversationId}
                </Link>
                <span className="text-gray-400"> · {s.anchorCount} edit{s.anchorCount !== 1 ? 's' : ''} · {s.paths.join(', ')}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {radius.relatedDecisions.length > 0 && (
        <section>
          <h3 className="text-xs uppercase tracking-wide text-gray-400">Other decisions sharing these files</h3>
          <ul className="mt-1 space-y-1 text-xs">
            {radius.relatedDecisions.map((d) => (
              <li key={d.objectId}>
                <Link to={`/projects/${projectId}/decisions/${encodeURIComponent(d.objectId)}`} className="text-violet-600 dark:text-violet-400 hover:underline">
                  {d.title ?? d.objectId}
                </Link>
                <span className="text-gray-400"> · {d.sharedPaths.join(', ')}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {radius.tests.length > 0 && (
        <section>
          <h3 className="text-xs uppercase tracking-wide text-gray-400">Tests that may cover this</h3>
          <ul className="mt-1 space-y-0.5 text-xs font-mono text-gray-600 dark:text-gray-300">
            {radius.tests.map((t) => <li key={t}>{t}</li>)}
          </ul>
        </section>
      )}
    </div>
  );
}

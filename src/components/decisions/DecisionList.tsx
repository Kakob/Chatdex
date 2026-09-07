// Decisions list (SPEC-decision-recovery §10.2): chronological within a
// session, grouped by session or by primary path. No ranking exists (law 2.7).

import { Link } from 'react-router-dom';
import { ChevronRight, History } from 'lucide-react';
import { SourceIcon } from '../common/sourceMeta';
import { EvidenceLinks } from '../understanding/EvidenceLinks';
import { ReviewButtons } from '../understanding/ReviewButtons';
import { BasisBadge, MadeByChip, UnsupportedBadge } from './BasisBadge';
import type { DecisionRow } from '../../lib/understanding/decisions/decisionMatrix';
import type { ReviewState } from '../../types/understanding';
import type { DataSource } from '../../types';

export type DecisionGrouping = 'session' | 'path';

const CHIP = 'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium';

export function DecisionListRow({
  row,
  projectId,
  source,
  onReview,
  onOpenHistory,
}: {
  row: DecisionRow;
  projectId: string;
  source?: DataSource;
  onReview: (objectId: string, state: ReviewState) => void;
  onOpenHistory: (objectId: string) => void;
}) {
  const { object, meta, latestTrace } = row;
  const pending = object.reviewState === 'pending';
  return (
    <div
      className={`rounded-xl border bg-white dark:bg-gray-900 p-4 ${
        meta.unsupportedAutonomous
          ? 'border-rose-300 dark:border-rose-800'
          : 'border-gray-200 dark:border-gray-800'
      }`}
      data-testid="decision-row"
      data-decision-id={object.id}
    >
      <div className="flex flex-wrap items-center gap-2">
        {source && <SourceIcon source={source} />}
        <BasisBadge basis={meta.basis} />
        <MadeByChip madeBy={meta.madeBy} />
        {meta.unsupportedAutonomous && <UnsupportedBadge />}
        {meta.conflictsWithUserDirection && (
          <span className={`${CHIP} bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300`}>conflicts with direction</span>
        )}
        {pending && <span className={`${CHIP} bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300`}>pending</span>}
        {meta.decidedAt && <span className="text-xs text-gray-400">{meta.decidedAt.slice(0, 10)}</span>}
        {meta.firstStepIndex !== undefined && <span className="text-xs text-gray-400">step {meta.firstStepIndex}</span>}
      </div>
      <Link
        to={`/projects/${projectId}/decisions/${encodeURIComponent(object.id)}`}
        className="mt-2 inline-flex items-center gap-1 font-medium text-gray-900 dark:text-white hover:text-violet-700 dark:hover:text-violet-300"
      >
        {object.title}
        <ChevronRight size={14} className="text-gray-400" />
      </Link>
      {object.body && object.body !== object.title && (
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{object.body}</p>
      )}
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-400">
        {latestTrace && (
          <>
            <span>{latestTrace.assumptions.length} assumption{latestTrace.assumptions.length !== 1 ? 's' : ''}</span>
            <span>{latestTrace.alternatives.length} alternative{latestTrace.alternatives.length !== 1 ? 's' : ''}</span>
            <span>{latestTrace.anchorStableKeys.length} edit{latestTrace.anchorStableKeys.length !== 1 ? 's' : ''}</span>
            {latestTrace.sha && <span className="font-mono">@{latestTrace.sha.slice(0, 7)}</span>}
            {row.traceCount > 1 && <span>· {row.traceCount} runs</span>}
          </>
        )}
        {meta.source === 'investigation' && <span>adjudicated by you</span>}
        {meta.primaryPath && <span className="font-mono truncate max-w-72" title={meta.primaryPath}>{meta.primaryPath}</span>}
      </div>
      <EvidenceLinks evidence={row.evidence} />
      <div className="mt-2 flex items-center gap-2">
        {pending && <ReviewButtons small onReview={(state) => onReview(object.id, state)} />}
        <button
          type="button"
          onClick={() => onOpenHistory(object.id)}
          title="View history"
          className="p-1 text-gray-400 hover:text-violet-600 dark:hover:text-violet-400"
        >
          <History size={14} />
        </button>
      </div>
    </div>
  );
}

export function DecisionList({
  rows,
  projectId,
  grouping,
  sourcesByConversation,
  conversationNames,
  onReview,
  onOpenHistory,
}: {
  rows: DecisionRow[];
  projectId: string;
  grouping: DecisionGrouping;
  sourcesByConversation: Map<string, DataSource>;
  conversationNames: Map<string, string>;
  onReview: (objectId: string, state: ReviewState) => void;
  onOpenHistory: (objectId: string) => void;
}) {
  const groups = new Map<string, DecisionRow[]>();
  for (const row of rows) {
    const key =
      grouping === 'session'
        ? row.meta.conversationId ?? '__none__'
        : row.meta.primaryPath || '__none__';
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }
  const label = (key: string) => {
    if (key === '__none__') return grouping === 'session' ? 'No session recorded' : 'No file recorded';
    return grouping === 'session' ? conversationNames.get(key) ?? key : key;
  };
  return (
    <div className="space-y-6" data-testid="decision-list">
      {[...groups.entries()].map(([key, list]) => (
        <section key={key}>
          <h2 className={`mb-2 text-xs uppercase tracking-wide text-gray-400 ${grouping === 'path' ? 'font-mono normal-case' : ''}`}>
            {label(key)} <span className="text-gray-300 dark:text-gray-600">· {list.length}</span>
          </h2>
          <div className="space-y-3">
            {list.map((row) => (
              <DecisionListRow
                key={row.object.id}
                row={row}
                projectId={projectId}
                source={row.meta.conversationId ? sourcesByConversation.get(row.meta.conversationId) : undefined}
                onReview={onReview}
                onOpenHistory={onOpenHistory}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

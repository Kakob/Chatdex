// Investigate — neutral anchor browser (SPEC-decision-investigation §8.1).
// Rows show only mechanically derived metadata (spec §7.4): tool kind,
// literal paths, session, timestamp, case state. Ordering is chronological
// only — no relevance, importance, or recommendation exists by design.

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDownNarrowWide, ArrowUpNarrowWide, FileSearch, RefreshCw } from 'lucide-react';
import { useInvestigationAnchors } from '../hooks/useInvestigationAnchors';
import {
  anchorCaseState,
  anchorFileLabel,
  filterAnchors,
  KIND_LABELS,
  type AnchorBrowserFilters,
} from '../lib/investigation/filter';
import type { CodeChangeKind, InvestigationAnchor } from '../types/investigation';
import type { AnchorConversationInfo } from '../hooks/useInvestigationAnchors';

const inputClass =
  'px-2 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100';

export function InvestigatePage() {
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');
  const [filters, setFilters] = useState<AnchorBrowserFilters>({});
  const {
    anchors,
    conversationInfo,
    isLoading,
    runBackfill,
    backfillProgress,
    backfillResult,
  } = useInvestigationAnchors(order);

  const conversationMeta = useMemo(
    () =>
      new Map(
        [...conversationInfo.entries()].map(([id, info]) => [
          id,
          { projectPath: info.projectPath },
        ])
      ),
    [conversationInfo]
  );

  const visible = useMemo(
    () => filterAnchors(anchors, filters, conversationMeta),
    [anchors, filters, conversationMeta]
  );

  const sessions = useMemo(
    () =>
      [...conversationInfo.entries()]
        .map(([id, info]) => ({ id, name: info.name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [conversationInfo]
  );

  const projects = useMemo(
    () =>
      [...new Set(
        [...conversationInfo.values()]
          .map((i) => i.projectPath)
          .filter((p): p is string => Boolean(p))
      )].sort(),
    [conversationInfo]
  );

  const set = (patch: Partial<AnchorBrowserFilters>) =>
    setFilters((f) => ({ ...f, ...patch }));

  return (
    <div>
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <FileSearch size={24} className="text-violet-500" />
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">
            Investigate
          </h1>
        </div>
        <p className="text-gray-600 dark:text-gray-400">
          Every code-change event from your agent sessions, in chronological order.
          Anchors are mechanical entry points — not detected decisions.
        </p>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select
          className={inputClass}
          value={filters.conversationId ?? ''}
          onChange={(e) => set({ conversationId: e.target.value || undefined })}
          aria-label="Filter by session"
        >
          <option value="">All sessions</option>
          {sessions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>

        {projects.length > 0 && (
          <select
            className={inputClass}
            value={filters.projectPath ?? ''}
            onChange={(e) =>
              set({ projectPath: e.target.value === '' ? undefined : e.target.value })
            }
            aria-label="Filter by project"
          >
            <option value="">All projects</option>
            {projects.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        )}

        <select
          className={inputClass}
          value={filters.kind ?? ''}
          onChange={(e) =>
            set({ kind: (e.target.value || undefined) as CodeChangeKind | undefined })
          }
          aria-label="Filter by change type"
        >
          <option value="">All change types</option>
          {Object.entries(KIND_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>

        <input
          type="text"
          className={inputClass}
          placeholder="File path contains…"
          value={filters.filePathSubstring ?? ''}
          onChange={(e) => set({ filePathSubstring: e.target.value || undefined })}
          aria-label="Filter by file path substring"
        />

        <input
          type="date"
          className={inputClass}
          value={toDateInput(filters.dateFrom)}
          onChange={(e) => set({ dateFrom: fromDateInput(e.target.value) })}
          aria-label="From date"
        />
        <input
          type="date"
          className={inputClass}
          value={toDateInput(filters.dateTo)}
          onChange={(e) => set({ dateTo: fromDateInput(e.target.value) })}
          aria-label="To date"
        />

        <button
          type="button"
          onClick={() => setOrder((o) => (o === 'asc' ? 'desc' : 'asc'))}
          className="flex items-center gap-1.5 px-2 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
          title="Toggle chronological order"
        >
          {order === 'asc' ? (
            <ArrowUpNarrowWide size={16} />
          ) : (
            <ArrowDownNarrowWide size={16} />
          )}
          {order === 'asc' ? 'Oldest first' : 'Newest first'}
        </button>

        <button
          type="button"
          onClick={() => void runBackfill()}
          disabled={backfillProgress !== null}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-60"
        >
          <RefreshCw size={16} className={backfillProgress ? 'animate-spin' : ''} />
          {backfillProgress
            ? `Deriving ${backfillProgress.current}/${backfillProgress.total}…`
            : 'Derive anchors'}
        </button>
      </div>

      {backfillResult && (
        <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
          Derived {backfillResult.anchorsDerived} anchor
          {backfillResult.anchorsDerived === 1 ? '' : 's'} across{' '}
          {backfillResult.conversationsProcessed} session
          {backfillResult.conversationsProcessed === 1 ? '' : 's'}
          {backfillResult.failures > 0 && `, ${backfillResult.failures} failed`}.
        </p>
      )}

      {isLoading ? (
        <p className="text-gray-500 dark:text-gray-400">Loading anchors…</p>
      ) : anchors.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 p-8 text-center">
          <p className="text-gray-700 dark:text-gray-300 mb-1">
            No code-change anchors yet.
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Anchors are derived from structured Edit/Write tool calls in imported
            Claude Code sessions. Import a session, or run “Derive anchors” to
            process sessions imported before this feature existed.
          </p>
        </div>
      ) : (
        <>
          <p className="mb-2 text-sm text-gray-500 dark:text-gray-400 tabular-nums">
            {visible.length} of {anchors.length} anchors
          </p>
          <ul className="space-y-2">
            {visible.map((anchor) => (
              <AnchorRow
                key={anchor.id}
                anchor={anchor}
                info={conversationInfo.get(anchor.conversationId)}
              />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function AnchorRow({
  anchor,
  info,
}: {
  anchor: InvestigationAnchor;
  info: AnchorConversationInfo | undefined;
}) {
  const state = anchorCaseState();
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-3">
      <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300">
        {KIND_LABELS[anchor.kind]}
      </span>
      <span
        className="font-mono text-sm text-gray-900 dark:text-gray-100 truncate max-w-md"
        title={anchor.filePaths.join('\n')}
      >
        {anchorFileLabel(anchor)}
      </span>
      <span className="text-sm text-gray-500 dark:text-gray-400 truncate max-w-48">
        {info?.name ?? info?.sourceFilename ?? anchor.conversationId}
      </span>
      <span className="text-sm text-gray-500 dark:text-gray-400 tabular-nums">
        {anchor.occurredAt.toLocaleString()}
      </span>
      {anchor.sourceProvenance === 'legacy' && (
        <span
          className="px-1.5 py-0.5 text-xs rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300"
          title="Imported before raw-source retention; re-import the session file to key this anchor to its source hash"
        >
          legacy
        </span>
      )}
      <span className="ml-auto px-2 py-0.5 text-xs rounded-full bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">
        {state === 'uninvestigated' ? 'Uninvestigated' : state}
      </span>
      <Link
        to={`/conversations/${anchor.conversationId}?scrollTo=${anchor.messageId}`}
        className="text-sm font-medium text-violet-600 dark:text-violet-400 hover:underline"
      >
        Open source
      </Link>
    </li>
  );
}

function toDateInput(d: Date | undefined): string {
  if (!d) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fromDateInput(value: string): Date | undefined {
  if (!value) return undefined;
  const [y, m, day] = value.split('-').map(Number);
  return new Date(y, m - 1, day);
}

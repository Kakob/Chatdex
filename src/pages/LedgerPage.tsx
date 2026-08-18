// Decision ledger (SPEC-decision-investigation §9, DI-3): finalized human
// verdicts only. Every word of prose here is either the user's own writing
// or a fixed taxonomy label — rationale is always shown before evidence,
// and nothing summarizes it.

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Scale } from 'lucide-react';
import {
  listDecisionLedger,
  ORIGIN_LABELS,
  type LedgerEntry,
} from '../lib/investigation/verdicts';
import { db } from '../lib/db/schema';
import type {
  VerdictConfidence,
  VerdictOrigin,
  VerdictStatus,
} from '../types/investigation';

const inputClass =
  'px-2 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100';

interface LedgerFilters {
  origin?: VerdictOrigin;
  status?: VerdictStatus;
  confidence?: VerdictConfidence;
  filePathSubstring?: string;
  conversationId?: string;
  finalizedFrom?: string; // yyyy-mm-dd (local)
  finalizedTo?: string;
}

interface LedgerData {
  entries: LedgerEntry[];
  sessionNames: Map<string, string>;
}

export function LedgerPage() {
  const [data, setData] = useState<LedgerData | null>(null);
  const [filters, setFilters] = useState<LedgerFilters>({});
  const entries = data?.entries ?? null;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const rows = await listDecisionLedger();
      const convIds = [...new Set(rows.map((r) => r.conversationId))];
      const convs = await db.conversations.bulkGet(convIds);
      const sessionNames = new Map<string, string>();
      convs.forEach((conv, i) => {
        if (conv) sessionNames.set(convIds[i], conv.name);
      });
      if (!cancelled) setData({ entries: rows, sessionNames });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const visible = useMemo(() => {
    if (!entries) return [];
    const needle = filters.filePathSubstring?.trim().toLowerCase();
    const from = filters.finalizedFrom ? localDayStart(filters.finalizedFrom) : null;
    const to = filters.finalizedTo ? localDayEnd(filters.finalizedTo) : null;
    return entries.filter((entry) => {
      if (filters.origin && entry.latest.origin !== filters.origin) return false;
      if (filters.status && entry.latest.status !== filters.status) return false;
      if (filters.confidence && entry.latest.confidence !== filters.confidence) return false;
      if (filters.conversationId && entry.conversationId !== filters.conversationId) {
        return false;
      }
      if (from && entry.latest.finalizedAt < from) return false;
      if (to && entry.latest.finalizedAt > to) return false;
      if (needle && !entry.filePaths.some((p) => p.toLowerCase().includes(needle))) {
        return false;
      }
      return true;
    });
  }, [entries, filters]);

  const set = (patch: Partial<LedgerFilters>) => setFilters((f) => ({ ...f, ...patch }));

  return (
    <div>
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <Scale size={24} className="text-violet-500" />
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">
            Decision ledger
          </h1>
        </div>
        <p className="text-gray-600 dark:text-gray-400">
          Your finalized verdicts — every entry was read, adjudicated, and written by
          you.
        </p>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select
          className={inputClass}
          value={filters.origin ?? ''}
          onChange={(e) =>
            set({ origin: (e.target.value || undefined) as VerdictOrigin | undefined })
          }
          aria-label="Filter by origin"
        >
          <option value="">All origins</option>
          {Object.entries(ORIGIN_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select
          className={inputClass}
          value={filters.status ?? ''}
          onChange={(e) =>
            set({ status: (e.target.value || undefined) as VerdictStatus | undefined })
          }
          aria-label="Filter by status"
        >
          <option value="">All statuses</option>
          {['active', 'experimental', 'superseded', 'reversed', 'unknown'].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          className={inputClass}
          value={filters.confidence ?? ''}
          onChange={(e) =>
            set({
              confidence: (e.target.value || undefined) as VerdictConfidence | undefined,
            })
          }
          aria-label="Filter by confidence"
        >
          <option value="">All confidence</option>
          {['low', 'medium', 'high'].map((c) => (
            <option key={c} value={c}>
              {c}
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
        {data && data.sessionNames.size > 1 && (
          <select
            className={inputClass}
            value={filters.conversationId ?? ''}
            onChange={(e) => set({ conversationId: e.target.value || undefined })}
            aria-label="Filter by session"
          >
            <option value="">All sessions</option>
            {[...data.sessionNames.entries()].map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        )}
        <input
          type="date"
          className={inputClass}
          value={filters.finalizedFrom ?? ''}
          onChange={(e) => set({ finalizedFrom: e.target.value || undefined })}
          aria-label="Finalized from date"
        />
        <input
          type="date"
          className={inputClass}
          value={filters.finalizedTo ?? ''}
          onChange={(e) => set({ finalizedTo: e.target.value || undefined })}
          aria-label="Finalized to date"
        />
      </div>

      {entries === null ? (
        <p className="text-gray-500 dark:text-gray-400">Loading ledger…</p>
      ) : entries.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 p-8 text-center">
          <p className="text-gray-700 dark:text-gray-300 mb-1">No verdicts yet.</p>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Finalize an investigation from the{' '}
            <Link to="/investigate" className="text-violet-600 dark:text-violet-400 hover:underline">
              Investigate
            </Link>{' '}
            workbench and it will appear here.
          </p>
        </div>
      ) : (
        <>
          <p className="mb-2 text-sm text-gray-500 dark:text-gray-400 tabular-nums">
            {visible.length} of {entries.length} decisions
          </p>
          <ul className="space-y-3">
            {visible.map((entry) => (
              <li
                key={entry.caseId}
                className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-3"
              >
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <h2 className="font-medium text-gray-900 dark:text-white">
                    {entry.title}
                  </h2>
                  {entry.caseState === 'reopened' && (
                    <span className="px-1.5 py-0.5 text-xs rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300">
                      reopened
                    </span>
                  )}
                  <Link
                    to={`/investigate/${encodeURIComponent(entry.primaryAnchorStableKey)}`}
                    className="ml-auto text-sm font-medium text-violet-600 dark:text-violet-400 hover:underline"
                  >
                    Open investigation
                  </Link>
                </div>
                <p className="whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-300 mb-2">
                  {entry.latest.rationale}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {ORIGIN_LABELS[entry.latest.origin]} · {entry.latest.status} ·{' '}
                  {entry.latest.confidence} confidence
                </p>
                <p className="text-xs text-gray-400 dark:text-gray-500 tabular-nums">
                  {entry.filePaths.join(', ')} · finalized{' '}
                  {entry.latest.finalizedAt.toLocaleString()} · revision{' '}
                  {entry.latest.revisionNumber} of {entry.revisionCount} ·{' '}
                  {entry.exhibitCount} exhibit{entry.exhibitCount === 1 ? '' : 's'} ·{' '}
                  {entry.reviewScopeCount} reviewed range
                  {entry.reviewScopeCount === 1 ? '' : 's'}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function localDayStart(value: string): Date {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

function localDayEnd(value: string): Date {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d, 23, 59, 59, 999);
}

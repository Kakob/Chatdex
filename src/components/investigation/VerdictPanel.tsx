// Verdict form + revision history + closure (SPEC §8.8–§8.10, DI-3).
// No category, status, or confidence is ever preselected; the rationale is
// never prefilled. Validation lists exactly what's missing. Finalization
// asks for confirmation and explains that it creates an immutable revision.

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Scale } from 'lucide-react';
import { ORIGIN_LABELS, getContinuationTargets, type ContinuationTargets } from '../../lib/investigation/verdicts';
import { anchorFileLabel, KIND_LABELS } from '../../lib/investigation/filter';
import type { UseInvestigationCaseResult } from '../../hooks/useInvestigationCase';
import type {
  InvestigationAnchor,
  VerdictConfidence,
  VerdictOrigin,
  VerdictStatus,
} from '../../types/investigation';

const STATUS_OPTIONS: VerdictStatus[] = ['active', 'experimental', 'superseded', 'reversed', 'unknown'];
const CONFIDENCE_OPTIONS: VerdictConfidence[] = ['low', 'medium', 'high'];

const selectClass =
  'w-full px-2 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100';

export function VerdictPanel({
  anchor,
  caseApi,
}: {
  anchor: InvestigationAnchor;
  caseApi: UseInvestigationCaseResult;
}) {
  const { caseRow, revisions, verdictMissing, saveVerdict, finalize, reopen } = caseApi;
  const [continuation, setContinuation] = useState<ContinuationTargets | null>(null);
  const [rationaleDraft, setRationaleDraft] = useState<{
    caseId: string;
    text: string;
  } | null>(null);

  const adjudicated = caseRow?.state === 'adjudicated';

  useEffect(() => {
    if (!adjudicated) return;
    let cancelled = false;
    void getContinuationTargets(anchor).then((targets) => {
      if (!cancelled) setContinuation(targets);
    });
    return () => {
      cancelled = true;
    };
  }, [adjudicated, anchor]);

  if (!caseRow) return null;
  const draft = caseRow.verdictDraft ?? {};
  const rationale =
    rationaleDraft?.caseId === caseRow.id ? rationaleDraft.text : draft.rationale ?? '';
  const latest = revisions[revisions.length - 1];

  if (adjudicated && latest) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Scale size={14} className="text-emerald-600 dark:text-emerald-400" />
          <h3 className="text-xs font-medium text-gray-700 dark:text-gray-300">
            Verdict recorded (revision {latest.revisionNumber})
          </h3>
        </div>
        <div className="rounded-lg border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/50 dark:bg-emerald-900/10 px-3 py-2 text-xs space-y-1">
          <p className="text-gray-800 dark:text-gray-200">
            {ORIGIN_LABELS[latest.origin]}
          </p>
          <p className="text-gray-500 dark:text-gray-400">
            Status: {latest.status} · Confidence: {latest.confidence} · Finalized{' '}
            {latest.finalizedAt.toLocaleString()}
          </p>
          <p className="text-gray-500 dark:text-gray-400">
            {latest.exhibitIds.length} exhibit{latest.exhibitIds.length === 1 ? '' : 's'} ·{' '}
            {latest.reviewScopeIds.length} reviewed range
            {latest.reviewScopeIds.length === 1 ? '' : 's'} · files:{' '}
            {anchor.filePaths.join(', ')}
          </p>
          <p className="whitespace-pre-wrap text-gray-700 dark:text-gray-300 border-t border-emerald-100 dark:border-emerald-900/40 pt-1 mt-1">
            {latest.rationale}
          </p>
        </div>
        {revisions.length > 1 && <RevisionList revisions={revisions} skipLatest />}
        <button
          type="button"
          onClick={() => void reopen()}
          className="px-2.5 py-1 text-xs rounded-lg border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
        >
          Reopen case
        </button>
        <p className="text-xs text-gray-400 dark:text-gray-500">
          Reopening never edits this revision; refinalizing creates a new one.
        </p>

        {continuation && (
          <div className="pt-2 border-t border-gray-100 dark:border-gray-800 space-y-1">
            <h4 className="text-xs font-medium text-gray-700 dark:text-gray-300">
              Keep exploring
            </h4>
            {continuation.previousUninvestigated && (
              <ContinuationLink
                label="Previous uninvestigated"
                target={continuation.previousUninvestigated}
              />
            )}
            {continuation.nextUninvestigated && (
              <ContinuationLink
                label="Next uninvestigated"
                target={continuation.nextUninvestigated}
              />
            )}
            {continuation.sameFile.slice(0, 5).map((a) => (
              <ContinuationLink key={a.id} label="Same file" target={a} />
            ))}
            {!continuation.previousUninvestigated &&
              !continuation.nextUninvestigated &&
              continuation.sameFile.length === 0 && (
                <p className="text-xs text-gray-400 dark:text-gray-500">
                  No uninvestigated neighbors remain.
                </p>
              )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-medium text-gray-700 dark:text-gray-300">
        Your verdict
      </h3>

      <label className="block text-xs text-gray-500 dark:text-gray-400">
        Who chose this?
        <select
          className={selectClass}
          value={draft.origin ?? ''}
          onChange={(e) =>
            void saveVerdict({ origin: (e.target.value || undefined) as VerdictOrigin })
          }
        >
          <option value="">— select —</option>
          {Object.entries(ORIGIN_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>

      <div className="grid grid-cols-2 gap-2">
        <label className="block text-xs text-gray-500 dark:text-gray-400">
          Current status
          <select
            className={selectClass}
            value={draft.status ?? ''}
            onChange={(e) =>
              void saveVerdict({ status: (e.target.value || undefined) as VerdictStatus })
            }
          >
            <option value="">— select —</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs text-gray-500 dark:text-gray-400">
          Confidence
          <select
            className={selectClass}
            value={draft.confidence ?? ''}
            onChange={(e) =>
              void saveVerdict({
                confidence: (e.target.value || undefined) as VerdictConfidence,
              })
            }
          >
            <option value="">— select —</option>
            {CONFIDENCE_OPTIONS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="block text-xs text-gray-500 dark:text-gray-400">
        Rationale (your own words)
        <textarea
          rows={3}
          value={rationale}
          onChange={(e) => setRationaleDraft({ caseId: caseRow.id, text: e.target.value })}
          onBlur={() => {
            if (rationale !== (draft.rationale ?? '')) {
              void saveVerdict({ rationale });
            }
          }}
          className={selectClass}
        />
      </label>

      {verdictMissing.length > 0 ? (
        <ul className="text-xs text-amber-600 dark:text-amber-400 list-disc pl-4 space-y-0.5">
          {verdictMissing.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-emerald-600 dark:text-emerald-400">
          All evidence requirements met.
        </p>
      )}

      <button
        type="button"
        disabled={verdictMissing.length > 0}
        onClick={() => {
          if (
            window.confirm(
              'Finalize this verdict?\n\nFinalizing creates an immutable revision snapshot of your verdict and its evidence. You can reopen the case later, but this revision will be preserved unchanged.'
            )
          ) {
            void finalize();
          }
        }}
        className="px-3 py-1.5 text-sm rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50"
      >
        Finalize verdict
      </button>

      {revisions.length > 0 && <RevisionList revisions={revisions} />}
    </div>
  );
}

function RevisionList({
  revisions,
  skipLatest = false,
}: {
  revisions: { revisionNumber: number; origin: VerdictOrigin; status: VerdictStatus; confidence: VerdictConfidence; finalizedAt: Date }[];
  skipLatest?: boolean;
}) {
  const rows = skipLatest ? revisions.slice(0, -1) : revisions;
  if (rows.length === 0) return null;
  return (
    <div>
      <h4 className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-0.5">
        Earlier revisions
      </h4>
      <ul className="text-xs text-gray-500 dark:text-gray-400 space-y-0.5">
        {rows.map((rev) => (
          <li key={rev.revisionNumber}>
            #{rev.revisionNumber} · {ORIGIN_LABELS[rev.origin]} · {rev.status} ·{' '}
            {rev.confidence} · {rev.finalizedAt.toLocaleString()}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ContinuationLink({
  label,
  target,
}: {
  label: string;
  target: InvestigationAnchor;
}) {
  return (
    <Link
      to={`/investigate/${encodeURIComponent(target.id)}`}
      className="block text-xs text-violet-600 dark:text-violet-400 hover:underline font-mono truncate"
      title={target.filePaths.join('\n')}
    >
      {label}: {KIND_LABELS[target.kind]} · {anchorFileLabel(target)}
    </Link>
  );
}

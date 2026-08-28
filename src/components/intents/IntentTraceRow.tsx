// One row of the Intent Trace matrix (SPEC-intent-trace §10.2). Every quote
// and path renders as a text node; every GitHub link comes from blobUrl or
// the isGitHubWebUrl allowlist (audit S6).

import { useState } from 'react';
import { ChevronDown, ChevronRight, ExternalLink, History, RefreshCw } from 'lucide-react';
import { SourceIcon } from '../common/sourceMeta';
import { EvidenceLinks } from '../understanding/EvidenceLinks';
import { ReviewButtons } from '../understanding/ReviewButtons';
import { blobUrl, isGitHubWebUrl } from '../../lib/github/client';
import {
  POLARITY_LABEL,
  ORIGIN_LABEL,
  SPEC_STATUS_LABEL,
  IMPL_STATUS_LABEL,
  type IntentRow,
} from '../../lib/understanding/intents/intentMatrix';
import type { ReviewState } from '../../types/understanding';
import type { DataSource } from '../../types';
import type { IntentTrace } from '../../types/intentTrace';

const CHIP = 'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium';
const STATUS_CLASS: Record<string, string> = {
  implemented: 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  specified: 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  partial: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  not_implemented: 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  diverged: 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  contradicted: 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  unknown: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
  unspecified: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
  no_spec: 'border border-dashed border-gray-300 text-gray-500 dark:border-gray-600 dark:text-gray-400',
  untraced: 'border border-dashed border-gray-300 text-gray-400 dark:border-gray-600',
};

function StatusChip({ status, label }: { status: string; label: string }) {
  return <span className={`${CHIP} ${STATUS_CLASS[status] ?? STATUS_CLASS.unknown}`}>{label}</span>;
}

function safeBlobUrl(trace: IntentTrace, path: string, start?: number, end?: number): string | null {
  try {
    return blobUrl(trace.repoRef.owner, trace.repoRef.repo, trace.repoRef.commitSha, path, start, end);
  } catch {
    return null;
  }
}

function ExtLink({ href, children }: { href: string | null; children: React.ReactNode }) {
  if (!href) return <span className="font-mono text-xs text-gray-600 dark:text-gray-300">{children}</span>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 font-mono text-xs text-violet-600 dark:text-violet-400 hover:underline"
    >
      {children}
      <ExternalLink size={11} />
    </a>
  );
}

function Quote({ text }: { text: string }) {
  return (
    <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-gray-50 dark:bg-gray-950 p-2 text-xs text-gray-700 dark:text-gray-300">
      {text}
    </pre>
  );
}

export function IntentTraceRow({
  row,
  sources,
  onReview,
  onOpenHistory,
  onTrace,
  traceDisabledReason,
}: {
  row: IntentRow;
  /** Sources of the row's evidence conversations, for the chip. */
  sources: DataSource[];
  onReview: (objectId: string, state: ReviewState) => void;
  onOpenHistory: (objectId: string) => void;
  /** Trace (or re-trace) this one intent, optionally with an extra file to check. */
  onTrace?: (objectId: string, extraPath?: string) => void;
  traceDisabledReason?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [extraPath, setExtraPath] = useState('');
  const { object, latestTrace: trace } = row;
  const pending = object.reviewState === 'pending';
  const canTrace = Boolean(onTrace) && !traceDisabledReason;
  const traceOne = () => {
    if (!onTrace) return;
    const path = extraPath.trim();
    onTrace(object.id, path || undefined);
    setExtraPath('');
  };

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
      <div className="grid gap-3 p-4 md:grid-cols-[minmax(0,3fr)_minmax(0,1fr)_minmax(0,1.4fr)]">
        {/* Stated */}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {sources.map((s) => (
              <SourceIcon key={s} source={s} />
            ))}
            <span
              className={`${CHIP} ${
                row.origin === 'unprompted'
                  ? 'bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300'
                  : 'bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300'
              }`}
            >
              {ORIGIN_LABEL[row.origin]}
            </span>
            <span className={`${CHIP} bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300`}>
              {POLARITY_LABEL[row.polarity]}
            </span>
            {pending && (
              <span className={`${CHIP} bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300`}>
                pending
              </span>
            )}
            {row.statedAt && (
              <span className="text-xs text-gray-400">{row.statedAt.toISOString().slice(0, 10)}</span>
            )}
          </div>
          <p className="mt-2 font-medium text-gray-900 dark:text-white">{object.title}</p>
          {object.body && object.body !== object.title && (
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">“{object.body}”</p>
          )}
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

        {/* Spec */}
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wide text-gray-400">Spec</div>
          <div className="mt-1">
            {trace ? (
              <StatusChip status={trace.specStatus} label={SPEC_STATUS_LABEL[trace.specStatus]} />
            ) : (
              <StatusChip status="untraced" label="not traced" />
            )}
          </div>
        </div>

        {/* Implementation */}
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wide text-gray-400">Implementation</div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {trace ? (
              <>
                <StatusChip status={trace.implStatus} label={IMPL_STATUS_LABEL[trace.implStatus]} />
                <button
                  type="button"
                  onClick={() => setOpen((v) => !v)}
                  aria-expanded={open}
                  className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-violet-600 dark:text-gray-400 dark:hover:text-violet-400"
                >
                  {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  evidence
                  {row.traceCount > 1 && <span className="text-gray-400">· {row.traceCount} traces</span>}
                </button>
              </>
            ) : (
              <>
                <StatusChip status="untraced" label="not traced" />
                {onTrace && (
                  <button
                    type="button"
                    onClick={traceOne}
                    disabled={!canTrace}
                    title={traceDisabledReason ?? 'Trace this intent'}
                    className="inline-flex items-center gap-1 text-xs text-violet-600 dark:text-violet-400 hover:underline disabled:opacity-50 disabled:no-underline"
                  >
                    <RefreshCw size={12} /> Trace this intent
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {open && trace && (
        <div className="border-t border-gray-100 dark:border-gray-800 px-4 py-3 space-y-3 text-sm">
          <div className="text-xs text-gray-400">
            Traced against{' '}
            <span className="font-mono">
              {trace.repoRef.owner}/{trace.repoRef.repo}@{trace.repoRef.commitSha.slice(0, 7)}
            </span>{' '}
            on {trace.createdAt.toISOString().slice(0, 10)} · {trace.model}
          </div>

          {trace.specStatus !== 'no_spec' && (
            <div>
              <div className="font-medium text-gray-800 dark:text-gray-200">Spec</div>
              {trace.specRationale && <p className="text-gray-600 dark:text-gray-400">{trace.specRationale}</p>}
              {trace.specEvidence.map((ev, i) => (
                <div key={`${ev.path}-${i}`} className="mt-1">
                  <ExtLink href={safeBlobUrl(trace, ev.path, ev.startLine, ev.endLine)}>
                    {ev.path}
                    {ev.startLine ? ` L${ev.startLine}${ev.endLine && ev.endLine !== ev.startLine ? `–L${ev.endLine}` : ''}` : ''}
                  </ExtLink>
                  <Quote text={ev.quote} />
                </div>
              ))}
            </div>
          )}

          <div>
            <div className="font-medium text-gray-800 dark:text-gray-200">Implementation</div>
            {trace.implRationale && <p className="text-gray-600 dark:text-gray-400">{trace.implRationale}</p>}
            {trace.implEvidence.map((ev, i) => (
              <div key={`${ev.path}-${i}`} className="mt-1">
                <ExtLink href={safeBlobUrl(trace, ev.path, ev.startLine, ev.endLine)}>
                  {ev.path} L{ev.startLine}
                  {ev.endLine !== ev.startLine ? `–L${ev.endLine}` : ''}
                </ExtLink>
                <Quote text={ev.quote} />
              </div>
            ))}
            {trace.implEvidence.length === 0 && (
              <p className="text-xs text-gray-400">No verifiable code evidence.</p>
            )}
            {trace.suggestedPaths && trace.suggestedPaths.length > 0 && (
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Not checked: {trace.suggestedPaths.join(', ')}
              </p>
            )}
            {trace.commitEvidence && trace.commitEvidence.length > 0 && (
              <div className="mt-2">
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  Commits touching this file after the intent was stated:
                </div>
                <ul className="mt-1 space-y-0.5">
                  {trace.commitEvidence.map((c) => (
                    <li key={`${c.sha}-${c.path}`} className="text-xs">
                      <ExtLink href={isGitHubWebUrl(c.url) ? c.url : null}>{c.sha.slice(0, 7)}</ExtLink>{' '}
                      <span className="text-gray-600 dark:text-gray-300">{c.message}</span>{' '}
                      <span className="text-gray-400">{c.authoredAt.toISOString().slice(0, 10)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className="text-xs text-gray-400">
            Checked: {trace.fetchedPaths.length ? trace.fetchedPaths.join(', ') : 'nothing'}
          </div>
          {onTrace && (
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={extraPath}
                onChange={(e) => setExtraPath(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') traceOne();
                }}
                placeholder="add a file to check (repo path)"
                aria-label={`Add a file to check for ${object.title}`}
                className="min-w-64 flex-1 px-2 py-1 text-xs rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100 placeholder-gray-400"
              />
              <button
                type="button"
                onClick={traceOne}
                disabled={!canTrace}
                title={traceDisabledReason ?? 'Re-trace this intent at the current commit'}
                className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded border border-violet-300 dark:border-violet-800 text-violet-700 dark:text-violet-300 hover:bg-violet-50 dark:hover:bg-violet-900/20 disabled:opacity-50"
              >
                <RefreshCw size={12} /> Re-trace
              </button>
            </div>
          )}
          {trace.warnings.length > 0 && (
            <ul className="list-disc pl-4 text-xs text-amber-700 dark:text-amber-400">
              {trace.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

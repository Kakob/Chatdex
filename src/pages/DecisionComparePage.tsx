// Semantic Decision Diff view (SPEC-decision-recovery §12). Pick two recovery
// runs; entries group by op and open the decision; `invalidated` entries
// offer "Record as contradicted" (a user-origin event). Merge duplicates via
// "Same as…" on unresolved / new pairs.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, GitCompareArrows, Loader2, RefreshCw } from 'lucide-react';
import { db } from '../lib/db/schema';
import { listRecoveryRuns, type RecoveryRunSummary } from '../lib/db/decisionTraces';
import { computeOrLoadDiff, recordInvalidation, mergeDecisions, DIFF_OP_LABEL, DIFF_OP_HELP } from '../lib/understanding/decisions/diff';
import { SpanLinks, CodeEvidenceList } from '../components/decisions/EvidenceLists';
import { useToastStore } from '../stores/toastStore';
import type { DecisionDiff, DecisionDiffEntry, DecisionDiffOp } from '../types/decision';
import type { UnderstandingObject } from '../types/understanding';

const SELECT =
  'px-2 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100';

const OP_ORDER: DecisionDiffOp[] = ['new_decision', 'revised', 'new_assumption', 'invalidated', 'unresolved'];

const OP_CLASS: Record<DecisionDiffOp, string> = {
  new_decision: 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  revised: 'bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300',
  new_assumption: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  invalidated: 'bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
  unresolved: 'border border-dashed border-gray-300 text-gray-500 dark:border-gray-600 dark:text-gray-400',
};

function runLabel(r: RecoveryRunSummary): string {
  return `${r.createdAt.toISOString().slice(0, 16).replace('T', ' ')}${r.sha ? ` @${r.sha.slice(0, 7)}` : ''} · ${r.traceCount} decision${r.traceCount !== 1 ? 's' : ''}`;
}

export function DecisionComparePage() {
  const { id: projectId } = useParams<{ id: string }>();
  const addToast = useToastStore((s) => s.addToast);
  const [runs, setRuns] = useState<RecoveryRunSummary[] | undefined>(undefined);
  const [fromRunId, setFromRunId] = useState<string>('');
  const [toRunId, setToRunId] = useState<string>('');
  const [diff, setDiff] = useState<DecisionDiff | null>(null);
  const [objects, setObjects] = useState<Map<string, UnderstandingObject>>(new Map());
  const [conversationNames, setConversationNames] = useState<Map<string, string>>(new Map());
  const [busy, setBusy] = useState(false);
  const [mergeTarget, setMergeTarget] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    void listRecoveryRuns(projectId).then((list) => {
      if (cancelled) return;
      setRuns(list);
      // Default: compare the two newest runs (older → newer).
      if (list.length >= 2) {
        setToRunId((v) => v || list[0].runId);
        setFromRunId((v) => v || list[1].runId);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const loadDiff = useCallback(
    async (recompute = false) => {
      if (!projectId || !fromRunId || !toRunId || fromRunId === toRunId) return;
      setBusy(true);
      try {
        const d = await computeOrLoadDiff(projectId, fromRunId, toRunId, { recompute });
        const ids = [...new Set(d.entries.map((e) => e.decisionObjectId))];
        const objs = ids.length ? await db.understandingObjects.where('id').anyOf(ids).toArray() : [];
        const convIds = [...new Set(d.entries.flatMap((e) => (e.evidence ?? []).map((s) => s.conversationId)))];
        const convs = convIds.length ? await db.conversations.where('id').anyOf(convIds).toArray() : [];
        setDiff(d);
        setObjects(new Map(objs.map((o) => [o.id, o])));
        setConversationNames(new Map(convs.map((c) => [c.id, c.name])));
      } catch (err) {
        addToast(`Cannot compare: ${(err as Error).message}`, 'error');
      } finally {
        setBusy(false);
      }
    },
    [projectId, fromRunId, toRunId, addToast]
  );

  useEffect(() => {
    void loadDiff();
  }, [loadDiff]);

  const grouped = useMemo(() => {
    const out = new Map<DecisionDiffOp, DecisionDiffEntry[]>();
    for (const op of OP_ORDER) out.set(op, []);
    for (const e of diff?.entries ?? []) out.get(e.op)!.push(e);
    return out;
  }, [diff]);

  const handleRecord = async (entry: DecisionDiffEntry) => {
    try {
      await recordInvalidation(entry);
      addToast('Recorded as contradicted — the decision is marked in Current Understanding');
    } catch (err) {
      addToast((err as Error).message, 'error');
    }
  };

  const handleMerge = async (entry: DecisionDiffEntry) => {
    const into = mergeTarget[entry.decisionObjectId];
    if (!into) return;
    try {
      await mergeDecisions(entry.decisionObjectId, into);
      addToast('Merged — the duplicate is superseded by the decision you chose');
      await loadDiff(true);
    } catch (err) {
      addToast((err as Error).message, 'error');
    }
  };

  if (!projectId) return null;
  if (runs === undefined) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="animate-spin text-gray-400" size={24} />
      </div>
    );
  }

  const candidates = (diff?.entries ?? []).filter((e) => e.op === 'new_decision').map((e) => e.decisionObjectId);

  return (
    <div className="space-y-6" data-testid="decision-compare">
      <Link to={`/projects/${projectId}/decisions`} className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-violet-600 dark:text-gray-400">
        <ArrowLeft size={14} /> All decisions
      </Link>
      <section>
        <p className="text-sm font-medium text-violet-600 dark:text-violet-400">Semantic Decision Diff</p>
        <h1 className="mt-1 text-2xl font-semibold text-gray-900 dark:text-white">What changed between two recovery runs</h1>
        <p className="mt-2 max-w-3xl text-sm text-gray-500 dark:text-gray-400">
          A pure comparison of the two runs&apos; reconstructions — no model, no network. Invalidations are the newer run&apos;s claims
          with their evidence; nothing here changes your understanding until you record it.
        </p>
      </section>

      {runs.length < 2 ? (
        <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 p-8 text-center text-sm text-gray-500 dark:text-gray-400">
          Two recovery runs are needed to compare. Recover decisions again (for example at a newer commit) to enable this view.
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <label className="text-gray-500 dark:text-gray-400">From</label>
            <select aria-label="From run" className={SELECT} value={fromRunId} onChange={(e) => setFromRunId(e.target.value)}>
              {runs.map((r) => <option key={r.runId} value={r.runId}>{runLabel(r)}</option>)}
            </select>
            <GitCompareArrows size={14} className="text-gray-400" />
            <label className="text-gray-500 dark:text-gray-400">To</label>
            <select aria-label="To run" className={SELECT} value={toRunId} onChange={(e) => setToRunId(e.target.value)}>
              {runs.map((r) => <option key={r.runId} value={r.runId}>{runLabel(r)}</option>)}
            </select>
            <button type="button" onClick={() => void loadDiff(true)} disabled={busy} title="Recompute from the traces" className="inline-flex items-center gap-1 rounded-lg border border-gray-200 dark:border-gray-700 px-2 py-1.5 text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50">
              <RefreshCw size={12} className={busy ? 'animate-spin' : ''} /> Recompute
            </button>
            {fromRunId === toRunId && <span className="text-xs text-amber-600">Pick two different runs</span>}
          </div>

          {diff && (
            <>
              <div className="flex flex-wrap gap-2 text-xs" data-testid="diff-counts">
                {OP_ORDER.map((op) => (
                  <span key={op} className={`inline-flex items-center rounded-full px-2 py-0.5 font-medium ${OP_CLASS[op]}`} title={DIFF_OP_HELP[op]}>
                    {grouped.get(op)!.length} {DIFF_OP_LABEL[op].toLowerCase()}
                  </span>
                ))}
                <span className="text-gray-400">differ v{diff.differVersion}</span>
              </div>

              {diff.entries.length === 0 && (
                <p className="text-sm text-gray-500 dark:text-gray-400">No differences between these runs.</p>
              )}

              {OP_ORDER.filter((op) => grouped.get(op)!.length > 0).map((op) => (
                <section key={op} data-testid={`diff-group-${op}`}>
                  <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${OP_CLASS[op]}`}>{DIFF_OP_LABEL[op]}</span>
                    <span className="text-xs font-normal text-gray-400">{DIFF_OP_HELP[op]}</span>
                  </h2>
                  <ul className="space-y-2">
                    {grouped.get(op)!.map((entry, i) => {
                      const object = objects.get(entry.decisionObjectId);
                      return (
                        <li key={`${entry.decisionObjectId}-${entry.assumptionId ?? ''}-${i}`} className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3 text-sm">
                          <Link to={`/projects/${projectId}/decisions/${encodeURIComponent(entry.decisionObjectId)}`} className="font-medium text-gray-900 dark:text-white hover:text-violet-700 dark:hover:text-violet-300">
                            {object?.title ?? entry.decisionObjectId}
                          </Link>
                          {object?.status === 'superseded' && <span className="ml-2 text-xs text-gray-400">superseded</span>}
                          {entry.changedFields && <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Changed: {entry.changedFields.join(', ')}</p>}
                          {entry.assumptionId && op !== 'invalidated' && <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Assumption {entry.assumptionId}</p>}
                          {op === 'invalidated' && (
                            <div className="mt-1">
                              {entry.assumptionId ? <p className="text-xs text-gray-500 dark:text-gray-400">Targets assumption {entry.assumptionId}</p> : <p className="text-xs text-gray-500 dark:text-gray-400">Targets the decision itself</p>}
                              <SpanLinks spans={entry.evidence ?? []} conversationNames={conversationNames} />
                              <CodeEvidenceList items={entry.codeEvidence ?? []} repoKey={undefined} sha={undefined} />
                              <button type="button" onClick={() => void handleRecord(entry)} className="mt-2 rounded-lg border border-rose-300 dark:border-rose-800 px-2 py-1 text-xs text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-900/20">
                                Record as contradicted
                              </button>
                            </div>
                          )}
                          {op === 'unresolved' && candidates.length > 0 && object?.status !== 'superseded' && (
                            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                              <span className="text-gray-500 dark:text-gray-400">Same as…</span>
                              <select aria-label={`Merge ${object?.title ?? entry.decisionObjectId} into`} className={SELECT} value={mergeTarget[entry.decisionObjectId] ?? ''} onChange={(e) => setMergeTarget({ ...mergeTarget, [entry.decisionObjectId]: e.target.value })}>
                                <option value="">pick a new decision</option>
                                {candidates.map((id) => <option key={id} value={id}>{objects.get(id)?.title ?? id}</option>)}
                              </select>
                              <button type="button" onClick={() => void handleMerge(entry)} disabled={!mergeTarget[entry.decisionObjectId]} className="rounded-lg border border-gray-200 dark:border-gray-700 px-2 py-1 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50">
                                Merge
                              </button>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </>
          )}
        </>
      )}
    </div>
  );
}

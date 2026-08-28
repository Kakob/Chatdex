// Change Workspace timeline (SPEC-change-workspace §14, PRD §18; CW-6).
// Read-only reconstruction: intent at the time → evidence available →
// hypothesis (frozen text) → implementation → verification → learned →
// promotions → open questions. Viewing it is logged as a 'history'
// inspection (PRD §17).

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { History } from 'lucide-react';
import { recordInspection } from '../../lib/db/inspections';
import { evidenceLabel } from '../../lib/prepare/evidenceLabel';
import { PROVENANCE_LABEL, implementationStats } from '../../lib/prepare/implementation';
import { promotedObjectsForWorkspace, questionsForWorkspace } from '../../lib/prepare/promote';
import { EDGE_VERIFICATION_LABEL, traceSummary, type EdgeVerification } from '../../lib/prepare/trace';
import { VERIFICATION_STATUS_LABEL, verificationRows } from '../../lib/prepare/verification';
import type { PreparedChange } from '../../types/preparedChange';
import type { UnderstandingObject } from '../../types/understanding';

interface Props {
  change: PreparedChange;
  projectId: string;
}

const fmt = (value?: Date | string) => (value ? new Date(value).toLocaleString() : '—');

export function WorkspaceTimeline({ change, projectId }: Props) {
  const [promoted, setPromoted] = useState<UnderstandingObject[]>([]);
  const [questions, setQuestions] = useState<UnderstandingObject[]>([]);

  useEffect(() => {
    let cancelled = false;
    void recordInspection({ projectId, workspaceId: change.id, kind: 'history', targetKey: change.id });
    void Promise.all([promotedObjectsForWorkspace(change), questionsForWorkspace(change)]).then(([p, q]) => {
      if (cancelled) return;
      setPromoted(p);
      setQuestions(q);
    });
    return () => {
      cancelled = true;
    };
  }, [change, projectId]);

  const evidence = change.evidence ?? [];
  const summary = traceSummary(change.trace, evidence);
  const criteria = new Map((change.criteria ?? []).map((c) => [c.id, c.text]));
  const rows = verificationRows(change);
  const stats = change.implementation ? implementationStats(change.implementation.files) : null;

  return (
    <section className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900" data-testid="workspace-timeline">
      <div className="flex flex-wrap items-center gap-3 px-5 py-4 border-b border-gray-100 dark:border-gray-800">
        <History size={16} className="text-violet-600 dark:text-violet-400" />
        <h2 className="font-semibold text-gray-900 dark:text-white">{change.title}</h2>
        <span className="text-xs text-gray-400">
          {change.state} · created {fmt(change.createdAt)}{change.closedAt ? ` · closed ${fmt(change.closedAt)}` : ''}
        </span>
        <Link to={`/projects/${projectId}/prepare?change=${encodeURIComponent(change.id)}`} className="ml-auto text-xs text-violet-600 dark:text-violet-400 underline">
          open workspace
        </Link>
      </div>

      <ol className="p-5 space-y-5 text-sm">
        <Step title="Intent at the time" when={change.readyAt ? `ready ${fmt(change.readyAt)}` : 'draft'}>
          {change.intent ? (
            <dl className="grid gap-1 text-gray-700 dark:text-gray-300">
              <Row k="Current behavior" v={change.intent.currentBehavior} />
              <Row k="Desired behavior" v={change.intent.desiredBehavior} />
              <Row k="Why it matters" v={change.intent.whyItMatters} />
            </dl>
          ) : (
            <p className="text-gray-700 dark:text-gray-300">{change.desiredOutcome || '—'}</p>
          )}
          {change.acceptanceCriteria.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-gray-600 dark:text-gray-400">
              {change.acceptanceCriteria.map((c) => <li key={c}>{c}</li>)}
            </ul>
          )}
          {change.originRef && <p className="mt-1 text-xs text-gray-400">origin: {change.originRef.kind}{change.originRef.id ? ` ${change.originRef.id}` : ''}</p>}
        </Step>

        <Step title="Evidence available" when={`${evidence.length} item${evidence.length === 1 ? '' : 's'}`}>
          {evidence.length === 0 ? <Empty /> : (
            <ul className="space-y-0.5 font-mono text-xs text-gray-700 dark:text-gray-300">
              {evidence.map((e) => (
                <li key={e.id}><span className={`mr-1 px-1 rounded text-[10px] ${e.kind === 'ai_inference' ? 'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300' : 'bg-gray-100 dark:bg-gray-800'}`}>{e.kind}</span>{evidenceLabel(e)}</li>
              ))}
            </ul>
          )}
          {summary.nodes > 0 && (
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              Trace: {summary.nodes} nodes{summary.unknownNodes ? ` (${summary.unknownNodes} unknown)` : ''} ·{' '}
              {(Object.keys(summary.byVerification) as EdgeVerification[]).filter((k) => summary.byVerification[k] > 0).map((k) => `${summary.byVerification[k]} ${EDGE_VERIFICATION_LABEL[k].toLowerCase()}`).join(' · ')}
            </p>
          )}
        </Step>

        <Step title="Developer hypothesis" when={change.hypotheses?.[0]?.frozenAt ? `frozen ${fmt(change.hypotheses[0].frozenAt)}` : undefined}>
          {(change.hypotheses ?? []).length === 0 ? <Empty /> : (
            <ul className="space-y-2">
              {change.hypotheses!.map((h) => (
                <li key={h.id} className="rounded bg-gray-50 dark:bg-gray-950 p-2">
                  <p className="whitespace-pre-wrap text-gray-800 dark:text-gray-200">{h.text}</p>
                  <p className="mt-1 text-[11px] text-gray-400">recorded {fmt(h.createdAt)}{h.frozenAt ? ` · frozen ${fmt(h.frozenAt)}` : ' · open'} · {h.origin}</p>
                </li>
              ))}
            </ul>
          )}
        </Step>

        <Step title="Implementation" when={change.implementation ? `attached ${fmt(change.implementation.attachedAt)}` : undefined}>
          {change.implementation && stats ? (
            <p className="text-gray-700 dark:text-gray-300">
              {change.implementation.source.replace(/_/g, ' ')} · produced by <strong>{PROVENANCE_LABEL[change.implementation.provenance]}</strong> · {stats.files} files, +{stats.additions} −{stats.deletions}
              {change.implementation.provenanceNote ? ` · ${change.implementation.provenanceNote}` : ''}
              {change.implementationHistory?.length ? ` · ${change.implementationHistory.length} earlier attachment(s)` : ''}
            </p>
          ) : <Empty />}
        </Step>

        <Step title="Verification" when={change.verifiedAt ? `verified ${fmt(change.verifiedAt)}` : undefined}>
          {rows.length === 0 ? <Empty /> : (
            <ul className="space-y-1">
              {rows.map((r) => (
                <li key={r.criterionId} className="flex flex-wrap items-center gap-2 text-gray-700 dark:text-gray-300">
                  <span className="flex-1">{criteria.get(r.criterionId) ?? r.criterionId}</span>
                  <span className="px-1.5 py-0.5 rounded text-xs bg-gray-100 dark:bg-gray-800">{VERIFICATION_STATUS_LABEL[r.status]}</span>
                  <span className="text-xs text-gray-400">{r.evidenceIds.length} evidence</span>
                  {r.note && <span className="w-full text-xs text-gray-500">{r.note}</span>}
                </li>
              ))}
            </ul>
          )}
        </Step>

        <Step title="Resulting understanding" when={change.learned ? `written ${fmt(change.learned.updatedAt)}` : undefined}>
          {change.learned?.text ? <p className="whitespace-pre-wrap text-gray-800 dark:text-gray-200">{change.learned.text}</p> : <Empty />}
          {promoted.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-xs">
              {promoted.map((o) => (
                <li key={o.id} className="text-gray-700 dark:text-gray-300">
                  <span className="px-1 rounded bg-gray-100 dark:bg-gray-800 text-[10px] mr-1">{o.type}</span>{o.title}
                </li>
              ))}
            </ul>
          )}
          {questions.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-xs">
              {questions.map((q) => (
                <li key={q.id} className="text-amber-700 dark:text-amber-300">? {q.title}{q.status !== 'current' ? ` (${q.status})` : ''}</li>
              ))}
            </ul>
          )}
        </Step>
      </ol>
    </section>
  );
}

function Step({ title, when, children }: { title: string; when?: string; children: React.ReactNode }) {
  return (
    <li className="relative pl-5 border-l-2 border-gray-200 dark:border-gray-800">
      <span className="absolute -left-[7px] top-1 h-3 w-3 rounded-full bg-violet-500" />
      <div className="flex flex-wrap items-baseline gap-2">
        <h3 className="font-medium text-gray-900 dark:text-white">{title}</h3>
        {when && <span className="text-xs text-gray-400">{when}</span>}
      </div>
      <div className="mt-1">{children}</div>
    </li>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-2">
      <dt className="w-32 shrink-0 text-xs text-gray-400">{k}</dt>
      <dd className="flex-1">{v || '—'}</dd>
    </div>
  );
}

function Empty() {
  return <p className="text-xs text-gray-400">none recorded</p>;
}

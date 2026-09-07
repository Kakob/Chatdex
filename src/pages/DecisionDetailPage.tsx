// One decision (SPEC-decision-recovery §10.3): decision · made by · why ·
// alternatives · assumptions · implemented by · evidence · actions. Every
// item opens its primary source. Blast radius, challenge, and replacement
// change arrive in DR-4 and mount in the actions row.

import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, History, Loader2 } from 'lucide-react';
import { db } from '../lib/db/schema';
import { getUnderstandingObject, getUnderstandingProject, getEventsForObject, setObjectReviewState } from '../lib/db/understanding';
import { listDecisionTracesForDecision } from '../lib/db/decisionTraces';
import { getInvestigationAnchor } from '../lib/db/investigationAnchors';
import { getRepoFile } from '../lib/db/repoFiles';
import { excerpt as excerptRows } from '../lib/repo/search';
import { mergeEvidence, type EvidenceLink } from '../lib/understanding/currentUnderstanding';
import { readDecisionMeta, type DecisionMeta } from '../lib/understanding/decisions/meta';
import { BASIS_HELP } from '../lib/understanding/decisions/decisionMatrix';
import { BasisBadge, MadeByChip, UnsupportedBadge } from '../components/decisions/BasisBadge';
import { AssumptionList } from '../components/decisions/AssumptionList';
import { CodeEvidenceList, Quote, SpanLinks } from '../components/decisions/EvidenceLists';
import { EvidenceLinks } from '../components/understanding/EvidenceLinks';
import { ReviewButtons } from '../components/understanding/ReviewButtons';
import { HistoryDrawer } from '../components/understanding/HistoryDrawer';
import { useToastStore } from '../stores/toastStore';
import type { UnderstandingObject, UnderstandingProject, ReviewState } from '../types/understanding';
import type { DecisionTrace } from '../types/decision';
import type { InvestigationAnchor } from '../types/investigation';
import type { CodeEvidence } from '../types/intentTrace';

interface Loaded {
  project: UnderstandingProject;
  object: UnderstandingObject;
  meta: DecisionMeta;
  evidence: EvidenceLink[];
  conversationNames: Map<string, string>;
  traces: DecisionTrace[];
  latest?: DecisionTrace;
  anchors: InvestigationAnchor[];
}

export function DecisionDetailPage() {
  const { id: projectId, objectId } = useParams<{ id: string; objectId: string }>();
  const addToast = useToastStore((s) => s.addToast);
  const [data, setData] = useState<Loaded | null | undefined>(undefined);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [openFile, setOpenFile] = useState<{ ev: CodeEvidence; text: string } | null>(null);

  // Fetch returns data; state is set by callers (effect / actions), never
  // synchronously inside the effect.
  const fetchDetail = useCallback(async (): Promise<Loaded | null> => {
    if (!projectId || !objectId) return null;
    const [project, object] = await Promise.all([getUnderstandingProject(projectId), getUnderstandingObject(objectId)]);
    if (!project || !object || object.type !== 'decision') return null;
    const [events, traces] = await Promise.all([getEventsForObject(objectId), listDecisionTracesForDecision(objectId)]);
    const latest = traces[0];
    const meta = readDecisionMeta(object);
    const convIds = new Set<string>();
    for (const e of events) for (const ref of e.evidence) convIds.add(ref.conversationId);
    for (const t of traces) for (const s of t.transcriptEvidence) convIds.add(s.conversationId);
    if (meta.conversationId) convIds.add(meta.conversationId);
    const convs = convIds.size ? await db.conversations.where('id').anyOf([...convIds]).toArray() : [];
    const conversationNames = new Map(convs.map((c) => [c.id, c.name]));
    const anchors = latest
      ? (await Promise.all(latest.anchorStableKeys.map((k) => getInvestigationAnchor(k)))).filter((a): a is InvestigationAnchor => Boolean(a))
      : [];
    return {
      project,
      object,
      meta,
      evidence: mergeEvidence(events.filter((e) => e.reviewState !== 'rejected'), conversationNames),
      conversationNames,
      traces,
      latest,
      anchors,
    };
  }, [projectId, objectId]);

  useEffect(() => {
    let cancelled = false;
    void fetchDetail().then((loaded) => {
      if (!cancelled) setData(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [fetchDetail]);

  const handleReview = async (state: ReviewState) => {
    if (!objectId) return;
    await setObjectReviewState(objectId, state);
    setData(await fetchDetail());
  };

  const handleOpenCode = async (ev: CodeEvidence) => {
    const t = data?.latest;
    if (!t?.repoKey || !t.sha) return;
    const row = await getRepoFile(t.repoKey, t.sha, ev.path);
    if (!row) {
      addToast('That file is not in the local cache any more — index the repository again', 'error');
      return;
    }
    const window = excerptRows(row, Math.max(1, ev.startLine - 15), ev.endLine + 15);
    setOpenFile({ ev, text: window.text });
  };

  if (data === undefined) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="animate-spin text-gray-400" size={24} />
      </div>
    );
  }
  if (data === null || !projectId) {
    return <p className="text-sm text-gray-500 dark:text-gray-400">Decision not found</p>;
  }

  const { object, meta, latest, anchors, conversationNames } = data;
  const pending = object.reviewState === 'pending';
  const caseId = typeof object.meta?.caseId === 'string' ? object.meta.caseId : undefined;

  return (
    <div className="space-y-6" data-testid="decision-detail">
      <Link to={`/projects/${projectId}/decisions`} className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-violet-600 dark:text-gray-400">
        <ArrowLeft size={14} /> All decisions
      </Link>

      <section>
        <div className="flex flex-wrap items-center gap-2">
          <BasisBadge basis={meta.basis} />
          <MadeByChip madeBy={meta.madeBy} />
          {meta.unsupportedAutonomous && <UnsupportedBadge />}
          {pending && <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">pending review</span>}
          {object.reviewState === 'rejected' && <span className="text-xs text-gray-400">rejected</span>}
          {meta.decidedAt && <span className="text-xs text-gray-400">decided {meta.decidedAt.slice(0, 10)}</span>}
          {meta.firstStepIndex !== undefined && <span className="text-xs text-gray-400">step {meta.firstStepIndex}</span>}
        </div>
        <h1 className="mt-2 text-2xl font-semibold text-gray-900 dark:text-white">{object.title}</h1>
        <p className="mt-1 text-xs text-gray-400">{BASIS_HELP[meta.basis]}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2" data-testid="decision-actions">
          {pending && <ReviewButtons onReview={(state) => void handleReview(state)} />}
          <button type="button" onClick={() => setHistoryOpen(true)} className="inline-flex items-center gap-1 rounded-lg border border-gray-200 dark:border-gray-700 px-2.5 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800">
            <History size={14} /> History
          </button>
        </div>
      </section>

      {meta.source === 'investigation' && (
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Adjudicated by you
          {caseId && (
            <>
              {' '}in{' '}
              <Link to={`/projects/${projectId}/investigate/questions/${encodeURIComponent(caseId)}`} className="text-violet-600 dark:text-violet-400 hover:underline">
                this investigation
              </Link>
            </>
          )}
          . No recovery run produced this decision; its basis comes from your verdict.
        </p>
      )}

      <Section title="Why" subtitle={latest ? 'AI reconstruction — check the evidence below' : undefined}>
        <p className="text-sm text-gray-800 dark:text-gray-200">{latest?.why ?? object.body ?? 'No rationale recorded.'}</p>
      </Section>

      {latest && (
        <>
          <Section title="Alternatives">
            {latest.alternatives.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">No alternatives were recovered from the session.</p>
            ) : (
              <ul className="space-y-2">
                {latest.alternatives.map((a, i) => (
                  <li key={i} className="rounded-lg border border-gray-200 dark:border-gray-800 p-3 text-sm">
                    <p className="text-gray-900 dark:text-white">{a.statement}</p>
                    {a.rejectedBecause && <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Rejected because: {a.rejectedBecause}</p>}
                    <SpanLinks spans={a.transcriptEvidence} conversationNames={conversationNames} compact />
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Assumptions" subtitle="Each labelled by its own basis">
            <AssumptionList assumptions={latest.assumptions} conversationNames={conversationNames} repoKey={latest.repoKey} sha={latest.sha} />
          </Section>

          <Section title="Implemented by" subtitle={latest.repoKey && latest.sha ? `${latest.repoKey.replace(/^gh:/, '')}@${latest.sha.slice(0, 7)}` : 'No repository snapshot was bound for this run'}>
            {anchors.length === 0 && latest.implEvidence.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">No edits or code were linked to this decision.</p>
            ) : (
              <div className="space-y-4">
                {anchors.length > 0 && (
                  <div>
                    <h3 className="text-xs uppercase tracking-wide text-gray-400">Edits in the session</h3>
                    <ul className="mt-1 space-y-3" data-testid="implemented-by-anchors">
                      {anchors.map((a) => (
                        <li key={a.id} className="text-xs">
                          <Link
                            to={`/projects/${projectId}/investigate/${encodeURIComponent(a.id)}`}
                            className="font-mono text-violet-600 dark:text-violet-400 hover:underline"
                            title="Open this edit in the investigation workbench (read-only)"
                          >
                            {a.toolName} · step {a.stepIndex} · {a.filePaths.join(', ')}
                          </Link>
                          {a.fileChanges.map((c) => (
                            <div key={`${c.path}-${c.changeIndex}`} className="mt-1">
                              {c.oldString !== undefined && <Quote text={`--- old\n${c.oldString}`} />}
                              <Quote text={`+++ new\n${c.newString}`} />
                            </div>
                          ))}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {latest.implEvidence.length > 0 && (
                  <div>
                    <h3 className="text-xs uppercase tracking-wide text-gray-400">Code at the pinned snapshot</h3>
                    <CodeEvidenceList items={latest.implEvidence} repoKey={latest.repoKey} sha={latest.sha} onOpen={(ev) => void handleOpenCode(ev)} />
                  </div>
                )}
                {(latest.symbols.length > 0 || latest.testPaths.length > 0) && (
                  <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
                    {latest.symbols.length > 0 && (
                      <span>
                        Symbols: {latest.symbols.map((s) => <code key={s} className="mr-1 font-mono">{s}</code>)}
                      </span>
                    )}
                    {latest.testPaths.length > 0 && (
                      <span>
                        Tests: {latest.testPaths.map((p) => <code key={p} className="mr-1 font-mono">{p}</code>)}
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}
            {openFile && (
              <div className="mt-3 rounded-lg border border-gray-200 dark:border-gray-800 p-3">
                <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                  <span className="font-mono">{openFile.ev.path} around L{openFile.ev.startLine}</span>
                  <button type="button" onClick={() => setOpenFile(null)} className="hover:text-violet-600">close</button>
                </div>
                <Quote text={openFile.text} />
              </div>
            )}
          </Section>

          <Section title="Evidence" subtitle="Transcript spans the decision rests on">
            <SpanLinks spans={latest.transcriptEvidence} conversationNames={conversationNames} />
          </Section>

          {latest.warnings.length > 0 && (
            <details className="text-xs text-amber-800 dark:text-amber-300">
              <summary className="cursor-pointer">{latest.warnings.length} warning{latest.warnings.length !== 1 ? 's' : ''} recorded on this trace</summary>
              <ul className="mt-1 list-disc pl-4">
                {latest.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </details>
          )}
          <p className="text-xs text-gray-400">
            Recovered by {latest.provider} · {latest.model} · {latest.createdAt.toISOString().slice(0, 16).replace('T', ' ')}
            {data.traces.length > 1 && ` · ${data.traces.length} runs`}
          </p>
        </>
      )}

      <Section title="Source conversations">
        <EvidenceLinks evidence={data.evidence} />
      </Section>

      {historyOpen && <HistoryDrawer objectId={object.id} onClose={() => setHistoryOpen(false)} />}
    </div>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white">{title}</h2>
        {subtitle && <span className="text-xs text-gray-400">{subtitle}</span>}
      </div>
      <div className="mt-2">{children}</div>
    </section>
  );
}

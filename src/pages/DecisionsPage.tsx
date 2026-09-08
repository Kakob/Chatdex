// Decisions tab (SPEC-decision-recovery §10). Rows = decisions recovered from
// the project's agent sessions (or promoted from investigations), ordered by
// the step where they were made and grouped by session or file. One disclosed
// run: Recover decisions. Everything AI-produced lands pending (law 2.3).

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { GitCompareArrows, Loader2, Scale } from 'lucide-react';
import { db } from '../lib/db/schema';
import { setObjectReviewState } from '../lib/db/understanding';
import { getMessagesForConversation } from '../lib/db/messages';
import { normalizeSession } from '../lib/detection/normalize';
import {
  loadDecisionMatrix,
  BASIS_LABEL,
  MADE_BY_LABEL,
  type DecisionMatrix,
} from '../lib/understanding/decisions/decisionMatrix';
import { planRecovery, runRecovery, type RecoveryPlan } from '../lib/understanding/decisions/runRecovery';
import { extractSessionCommits, type SessionCommit } from '../lib/understanding/decisions/sessionCommits';
import { getAssociatedConversations } from '../lib/understanding/reconcile';
import { buildDisclosure, type DisclosureSummary } from '../lib/understanding/runDiscovery';
import { listReadyProviders, getProviderInfo, getProviderAuthMode } from '../lib/providers';
import type { AuthMode, LLMProviderId } from '../lib/providers';
import { DisclosureModal } from '../components/understanding/DisclosureModal';
import { HistoryDrawer } from '../components/understanding/HistoryDrawer';
import { RepoBindingCard } from '../components/intents/RepoBindingCard';
import { DecisionList, type DecisionGrouping } from '../components/decisions/DecisionList';
import { useToastStore } from '../stores/toastStore';
import type { DataSource, StoredConversation } from '../types';
import type { ReviewState } from '../types/understanding';
import type { DecisionBasis, DecisionMadeBy } from '../types/decision';

type PendingRecover = {
  disclosure: DisclosureSummary;
  authMode: AuthMode;
  plan: RecoveryPlan;
  ignoreCursor: boolean;
};

const SELECT =
  'px-2 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100';

/** How many recent sessions to scan for `git commit` shas to suggest a binding. */
const COMMIT_SCAN_SESSIONS = 10;

export function DecisionsPage() {
  const { id: projectId } = useParams<{ id: string }>();
  const addToast = useToastStore((s) => s.addToast);
  const [data, setData] = useState<DecisionMatrix | null | undefined>(undefined);
  const [sessions, setSessions] = useState<StoredConversation[]>([]);
  const [sourcesByConversation, setSourcesByConversation] = useState<Map<string, DataSource>>(new Map());
  const [conversationNames, setConversationNames] = useState<Map<string, string>>(new Map());
  const [commits, setCommits] = useState<Array<SessionCommit & { conversationName: string }>>([]);
  const [providers, setProviders] = useState<LLMProviderId[]>([]);
  const [provider, setProvider] = useState<LLMProviderId | null>(null);
  const [pending, setPending] = useState<PendingRecover | null>(null);
  const [progress, setProgress] = useState<{ label: string; done: number; total: number } | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [historyObjectId, setHistoryObjectId] = useState<string | null>(null);
  const [grouping, setGrouping] = useState<DecisionGrouping>('session');
  const [filters, setFilters] = useState<{
    basis: DecisionBasis | 'all';
    madeBy: DecisionMadeBy | 'all';
    review: ReviewState | 'all';
    unsupportedOnly: boolean;
    session: string | 'all';
  }>({ basis: 'all', madeBy: 'all', review: 'all', unsupportedOnly: false, session: 'all' });

  const load = useCallback(async () => {
    if (!projectId) return;
    const [matrix, ready, associated] = await Promise.all([
      loadDecisionMatrix(projectId),
      listReadyProviders(),
      getAssociatedConversations(projectId),
    ]);
    setData(matrix);
    setProviders(ready);
    setProvider((prev) => prev ?? ready[0] ?? null);
    const agentSessions = associated
      .filter((c) => c.source === 'claude-code')
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    setSessions(agentSessions);
    const ids = new Set<string>(associated.map((c) => c.id));
    if (matrix) for (const r of matrix.rows) for (const e of r.evidence) ids.add(e.conversationId);
    const convs = ids.size ? await db.conversations.where('id').anyOf([...ids]).toArray() : [];
    setSourcesByConversation(new Map(convs.map((c) => [c.id, c.source])));
    setConversationNames(new Map(convs.map((c) => [c.id, c.name])));

    // Suggested shas: what these sessions committed (deterministic, §8.2).
    const found: Array<SessionCommit & { conversationName: string }> = [];
    for (const conv of agentSessions.slice(0, COMMIT_SCAN_SESSIONS)) {
      const { steps } = normalizeSession(conv.id, await getMessagesForConversation(conv.id));
      for (const c of extractSessionCommits(steps)) found.push({ ...c, conversationName: conv.name });
    }
    setCommits(found);
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(() => {
    if (!data) return [];
    return data.rows.filter((r) => {
      if (filters.basis !== 'all' && r.meta.basis !== filters.basis) return false;
      if (filters.madeBy !== 'all' && r.meta.madeBy !== filters.madeBy) return false;
      if (filters.review !== 'all' && r.object.reviewState !== filters.review) return false;
      if (filters.unsupportedOnly && !r.meta.unsupportedAutonomous) return false;
      if (filters.session !== 'all' && r.meta.conversationId !== filters.session) return false;
      return true;
    });
  }, [data, filters]);

  const counts = useMemo(() => {
    const byBasis: Record<DecisionBasis, number> = { specified: 0, inherited: 0, inferred: 0, invented: 0, unknown: 0 };
    let unsupported = 0;
    for (const r of data?.rows ?? []) {
      byBasis[r.meta.basis]++;
      if (r.meta.unsupportedAutonomous) unsupported++;
    }
    return { byBasis, unsupported };
  }, [data]);

  const handleReview = async (objectId: string, state: ReviewState) => {
    await setObjectReviewState(objectId, state);
    await load();
  };

  const handleRecoverClick = async () => {
    if (!provider || !projectId) return;
    setProgress({ label: 'Planning recovery', done: 0, total: 1 });
    try {
      let ignoreCursor = false;
      let plan = await planRecovery(projectId, { provider });
      if (plan.conversations.length === 0) {
        plan = await planRecovery(projectId, { provider, ignoreCursor: true });
        ignoreCursor = true;
      }
      if (plan.conversations.length === 0) {
        addToast('No Claude Code sessions are associated with this project yet');
        setWarnings(plan.warnings);
        return;
      }
      const conversations = await db.conversations.where('id').anyOf(plan.conversationIds).toArray();
      setPending({
        disclosure: buildDisclosure(conversations, provider),
        authMode: await getProviderAuthMode(provider),
        plan,
        ignoreCursor,
      });
    } catch (err) {
      addToast(`Cannot plan recovery: ${(err as Error).message}`, 'error');
    } finally {
      setProgress(null);
    }
  };

  const handleConfirm = async () => {
    if (!pending || !provider || !projectId) return;
    const run = pending;
    setPending(null);
    setWarnings([]);
    setProgress({ label: 'Recovering decisions', done: 0, total: run.plan.conversations.length });
    try {
      const outcome = await runRecovery(projectId, run.plan, { provider, ignoreCursor: run.ignoreCursor }, {
        onProgress: (done, total) => setProgress({ label: 'Recovering decisions', done, total }),
      });
      addToast(
        `Recovery: ${outcome.decisionsCreated} new decision${outcome.decisionsCreated !== 1 ? 's' : ''}, ${
          outcome.decisionsSupported
        } matched existing, ${outcome.conversationsProcessed} session${outcome.conversationsProcessed !== 1 ? 's' : ''} processed` +
          (outcome.errored ? `, ${outcome.errored} failed` : '') +
          (outcome.warnings.length ? ` (${outcome.warnings.length} warnings)` : ''),
        outcome.errored ? 'error' : 'success'
      );
      setWarnings(outcome.warnings);
    } catch (err) {
      addToast(`Recovery failed: ${(err as Error).message}`, 'error');
    } finally {
      setProgress(null);
      await load();
    }
  };

  if (data === undefined) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="animate-spin text-gray-400" size={24} />
      </div>
    );
  }
  if (data === null || !projectId) {
    return <p className="text-sm text-gray-500 dark:text-gray-400">Project not found</p>;
  }

  const { project } = data;
  const repository = project.repository;
  const recoverDisabledReason = !provider
    ? 'Configure an LLM provider in Settings'
    : sessions.length === 0
      ? 'Associate a Claude Code session with this project first'
      : null;

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-violet-600 dark:text-violet-400">Decisions</p>
          <h1 className="mt-1 text-2xl font-semibold text-gray-900 dark:text-white">
            The choices hidden inside your agent sessions, made explicit
          </h1>
          <p className="mt-2 max-w-3xl text-sm text-gray-500 dark:text-gray-400">
            Each decision is reconstructed from a recorded session and labelled by <em>basis</em>:{' '}
            <span className="font-medium">Specified</span> when you asked for it,{' '}
            <span className="font-medium">Inherited</span> when it copied an existing pattern,{' '}
            <span className="font-medium">Inferred</span> when the agent reasoned to it,{' '}
            <span className="font-medium">Invented</span> when nothing in the record supports it. Labels
            are checked against the quotes, not taken from the model. Rows are in the order the
            decisions were made — nothing is ranked.
          </p>
          {data.latestRecoveredAt && (
            <p className="mt-2 text-xs text-gray-400">
              Last recovered{' '}
              {data.latestRepoKey && data.latestSha && (
                <>
                  against <span className="font-mono">{data.latestRepoKey.replace(/^gh:/, '')}@{data.latestSha.slice(0, 7)}</span>{' '}
                </>
              )}
              on {data.latestRecoveredAt.toISOString().slice(0, 10)} · {data.runs.length} run{data.runs.length !== 1 ? 's' : ''}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {providers.length > 1 && (
            <select value={provider ?? ''} onChange={(e) => setProvider(e.target.value as LLMProviderId)} aria-label="LLM provider" className={SELECT}>
              {providers.map((p) => (
                <option key={p} value={p}>{getProviderInfo(p).label}</option>
              ))}
            </select>
          )}
          <button
            type="button"
            onClick={() => void handleRecoverClick()}
            disabled={recoverDisabledReason !== null || progress !== null}
            title={recoverDisabledReason ?? undefined}
            className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50"
          >
            <Scale size={14} /> Recover decisions
          </button>
          {data.runs.length >= 2 && (
            <Link
              to={`/projects/${projectId}/decisions/compare`}
              className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg border border-violet-300 dark:border-violet-800 text-violet-700 dark:text-violet-300 hover:bg-violet-50 dark:hover:bg-violet-900/20"
            >
              <GitCompareArrows size={14} /> Compare runs
            </Link>
          )}
        </div>
      </section>

      <RepoBindingCard
        project={project}
        collapsible
        onSaved={() => void load()}
        suggestedRefs={commits.slice(0, 5).map((c) => ({
          ref: c.branch ?? c.sha,
          label: c.branch ? `${c.sha.slice(0, 7)} · ${c.branch}` : c.sha.slice(0, 7),
        }))}
      />
      {commits.length > 0 && (
        <p className="text-xs text-gray-500 dark:text-gray-400" data-testid="session-commits">
          Sessions committed:{' '}
          {commits.slice(0, 5).map((c, i) => (
            <span key={`${c.sha}-${i}`} className="mr-2">
              <span className="font-mono">{c.sha.slice(0, 7)}</span>{c.branch ? <> on <span className="font-mono">{c.branch}</span></> : null}
              {c.subject ? ` — ${c.subject}` : ''} ({c.conversationName})
            </span>
          ))}
          {repository ? ' Use one as the tracked ref above to recover against the code the session produced.' : ''}
        </p>
      )}
      {provider === 'openai' && (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          The OpenAI subscription path adds roughly 14k tokens of overhead per call; prefer Anthropic for large runs.
        </p>
      )}

      {progress && (
        <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
          <Loader2 size={14} className="animate-spin" />
          {progress.label}… {progress.done}/{progress.total}
        </div>
      )}
      {warnings.length > 0 && (
        <details className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-3 text-xs text-amber-800 dark:text-amber-300">
          <summary className="cursor-pointer">{warnings.length} warning{warnings.length !== 1 ? 's' : ''} from the last run</summary>
          <ul className="mt-2 list-disc pl-4 space-y-0.5">
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </details>
      )}

      {data.rows.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-3 text-xs" data-testid="basis-counts">
            {(Object.keys(BASIS_LABEL) as DecisionBasis[]).map((b) => (
              <button
                key={b}
                type="button"
                onClick={() => setFilters({ ...filters, basis: filters.basis === b ? 'all' : b })}
                className={`rounded-full px-2 py-0.5 border ${filters.basis === b ? 'border-violet-500 text-violet-700 dark:text-violet-300' : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300'}`}
              >
                {counts.byBasis[b]} {BASIS_LABEL[b].toLowerCase()}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setFilters({ ...filters, unsupportedOnly: !filters.unsupportedOnly })}
              className={`rounded-full px-2 py-0.5 border ${filters.unsupportedOnly ? 'border-rose-500 text-rose-700 dark:text-rose-300' : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300'}`}
            >
              {counts.unsupported} unsupported autonomous
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <select aria-label="Made-by filter" className={SELECT} value={filters.madeBy} onChange={(e) => setFilters({ ...filters, madeBy: e.target.value as typeof filters.madeBy })}>
              <option value="all">Anyone</option>
              {(Object.keys(MADE_BY_LABEL) as DecisionMadeBy[]).map((m) => (
                <option key={m} value={m}>{MADE_BY_LABEL[m]}</option>
              ))}
            </select>
            <select aria-label="Review filter" className={SELECT} value={filters.review} onChange={(e) => setFilters({ ...filters, review: e.target.value as typeof filters.review })}>
              <option value="all">Any review state</option>
              <option value="pending">pending</option>
              <option value="accepted">accepted</option>
              <option value="edited">edited</option>
            </select>
            {sessions.length > 1 && (
              <select aria-label="Session filter" className={SELECT} value={filters.session} onChange={(e) => setFilters({ ...filters, session: e.target.value })}>
                <option value="all">All sessions</option>
                {sessions.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            )}
            <select aria-label="Group by" className={SELECT} value={grouping} onChange={(e) => setGrouping(e.target.value as DecisionGrouping)}>
              <option value="session">Group by session</option>
              <option value="path">Group by file</option>
            </select>
            <span className="text-gray-400">{rows.length} of {data.rows.length}</span>
          </div>
        </>
      )}

      {data.rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 p-8 text-center text-sm text-gray-500 dark:text-gray-400">
          No decisions yet. Recover decisions from this project&apos;s Claude Code sessions to start.
        </div>
      ) : (
        <DecisionList
          rows={rows}
          projectId={projectId}
          grouping={grouping}
          sourcesByConversation={sourcesByConversation}
          conversationNames={conversationNames}
          onReview={(objectId, state) => void handleReview(objectId, state)}
          onOpenHistory={setHistoryObjectId}
        />
      )}

      {pending && (
        <DisclosureModal
          disclosure={pending.disclosure}
          authMode={pending.authMode}
          actionLabel="Decision recovery"
          title={`Send transcript excerpts${pending.plan.filePaths.length ? ' and repository excerpts' : ''} to ${pending.disclosure.providerLabel}?`}
          sendsDescription={
            `your messages, the agent's reasoning before each edit, and ${pending.plan.hunkCount} edit hunk${pending.plan.hunkCount !== 1 ? 's' : ''} from ${pending.plan.conversations.length} session${pending.plan.conversations.length !== 1 ? 's' : ''}` +
            (pending.plan.filePaths.length
              ? `, plus excerpts of ${pending.plan.filePaths.length} file${pending.plan.filePaths.length !== 1 ? 's' : ''} from ${pending.plan.repoKey?.replace(/^gh:/, '')}@${pending.plan.sha?.slice(0, 7)}${pending.plan.ref ? ` (${pending.plan.ref})` : ''}`
              : '') +
            (pending.ignoreCursor ? ' (full re-run)' : '') +
            '. Recovered decisions land pending review; quotes are stored capped with your understanding (encrypted in sync)'
          }
          confirmLabel="Send and recover"
          onConfirm={() => void handleConfirm()}
          onCancel={() => setPending(null)}
        />
      )}
      {historyObjectId && <HistoryDrawer objectId={historyObjectId} onClose={() => setHistoryObjectId(null)} />}
    </div>
  );
}

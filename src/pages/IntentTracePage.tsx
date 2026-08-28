// Intent Trace tab (SPEC-intent-trace §10): rows = intents, columns =
// Stated / Spec / Implementation. Two disclosed runs: extract intents from
// the project's conversations, and trace intents against the bound GitHub
// repository. Everything AI-produced lands pending; nothing auto-accepts.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { GitCompare, Loader2, Sparkles } from 'lucide-react';
import { db } from '../lib/db/schema';
import { setObjectReviewState } from '../lib/db/understanding';
import {
  loadIntentMatrix,
  ORIGIN_LABEL,
  POLARITY_LABEL,
  SPEC_STATUS_LABEL,
  IMPL_STATUS_LABEL,
  type IntentMatrix,
} from '../lib/understanding/intents/intentMatrix';
import { getIntentExtractableConversations, runIntentExtraction } from '../lib/understanding/intents/runExtraction';
import type { HeuristicMode } from '../lib/understanding/intents/heuristic';
import { planTrace, runTrace, type TracePlan, type TraceConfig } from '../lib/understanding/trace/runTrace';
import { buildDisclosure, type DisclosureSummary } from '../lib/understanding/runDiscovery';
import { listReadyProviders, getProviderInfo, getProviderAuthMode } from '../lib/providers';
import type { AuthMode, LLMProviderId } from '../lib/providers';
import { hasGitHubToken } from '../lib/github/credentials';
import { resolveRef } from '../lib/github/client';
import { DisclosureModal } from '../components/understanding/DisclosureModal';
import { HistoryDrawer } from '../components/understanding/HistoryDrawer';
import { RepoBindingCard } from '../components/intents/RepoBindingCard';
import { IntentTraceTable } from '../components/intents/IntentTraceTable';
import { useToastStore } from '../stores/toastStore';
import type { StoredConversation, DataSource } from '../types';
import type { ReviewState } from '../types/understanding';
import type { IntentOrigin, IntentPolarity, SpecStatus, ImplStatus } from '../types/intentTrace';

type PendingExtract = {
  kind: 'extract';
  disclosure: DisclosureSummary;
  authMode: AuthMode;
  ignoreCursor: boolean;
};
type PendingTrace = {
  kind: 'trace';
  disclosure: DisclosureSummary;
  authMode: AuthMode;
  plan: TracePlan;
  /** Set for a single-intent (re-)trace so the run uses the same selection. */
  config: TraceConfig;
};

const SELECT =
  'px-2 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100';

export function IntentTracePage() {
  const { id: projectId } = useParams<{ id: string }>();
  const addToast = useToastStore((s) => s.addToast);
  const [data, setData] = useState<IntentMatrix | null | undefined>(undefined);
  const [sourcesByConversation, setSourcesByConversation] = useState<Map<string, DataSource>>(new Map());
  const [providers, setProviders] = useState<LLMProviderId[]>([]);
  const [provider, setProvider] = useState<LLMProviderId | null>(null);
  const [heuristic, setHeuristic] = useState<HeuristicMode>('lenient');
  const [tokenPresent, setTokenPresent] = useState(false);
  const [pending, setPending] = useState<PendingExtract | PendingTrace | null>(null);
  const [progress, setProgress] = useState<{ label: string; done: number; total: number } | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [historyObjectId, setHistoryObjectId] = useState<string | null>(null);
  const [stale, setStale] = useState<string | null>(null);
  const [filters, setFilters] = useState<{
    origin: IntentOrigin | 'all';
    polarity: IntentPolarity | 'all';
    spec: SpecStatus | 'all';
    impl: ImplStatus | 'untraced' | 'all';
    review: ReviewState | 'all';
  }>({ origin: 'all', polarity: 'all', spec: 'all', impl: 'all', review: 'all' });

  const load = useCallback(async () => {
    if (!projectId) return;
    const [matrix, ready, token] = await Promise.all([
      loadIntentMatrix(projectId),
      listReadyProviders(),
      hasGitHubToken(),
    ]);
    setData(matrix);
    setProviders(ready);
    setProvider((prev) => prev ?? ready[0] ?? null);
    setTokenPresent(token);
    if (matrix) {
      const ids = [...new Set(matrix.rows.flatMap((r) => r.evidence.map((e) => e.conversationId)))];
      const convs = ids.length ? await db.conversations.where('id').anyOf(ids).toArray() : [];
      setSourcesByConversation(new Map(convs.map((c) => [c.id, c.source])));
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Stale hint: cheap ref resolve; failure is tolerated (offline, no token).
  useEffect(() => {
    const repo = data?.project.repository;
    const ref = data?.latestRepoRef;
    if (!repo || !ref || repo.pinnedRef) return;
    let cancelled = false;
    resolveRef(repo.owner, repo.repo, repo.defaultBranch ?? 'HEAD')
      .then(({ sha }) => {
        if (!cancelled && sha !== ref.commitSha) setStale(sha.slice(0, 7));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [data]);

  const rows = useMemo(() => {
    if (!data) return [];
    return data.rows.filter((r) => {
      if (filters.origin !== 'all' && r.origin !== filters.origin) return false;
      if (filters.polarity !== 'all' && r.polarity !== filters.polarity) return false;
      if (filters.review !== 'all' && r.object.reviewState !== filters.review) return false;
      if (filters.spec !== 'all' && r.latestTrace?.specStatus !== filters.spec) return false;
      if (filters.impl === 'untraced') return !r.latestTrace;
      if (filters.impl !== 'all' && r.latestTrace?.implStatus !== filters.impl) return false;
      return true;
    });
  }, [data, filters]);

  const handleReview = async (objectId: string, state: ReviewState) => {
    await setObjectReviewState(objectId, state);
    await load();
  };

  const handleExtractClick = async () => {
    if (!provider || !projectId) return;
    let ignoreCursor = false;
    let conversations = await getIntentExtractableConversations(projectId);
    if (conversations.length === 0) {
      conversations = await getIntentExtractableConversations(projectId, true);
      ignoreCursor = true;
    }
    if (conversations.length === 0) {
      addToast('No conversations associated with this project yet');
      return;
    }
    setPending({
      kind: 'extract',
      disclosure: buildDisclosure(conversations, provider),
      authMode: await getProviderAuthMode(provider),
      ignoreCursor,
    });
  };

  const handleTraceClick = async (intentObjectId?: string, extraPath?: string) => {
    if (!provider || !projectId) return;
    setProgress({ label: 'Planning trace', done: 0, total: 1 });
    const config: TraceConfig = {
      provider,
      ...(intentObjectId ? { intentObjectIds: [intentObjectId] } : {}),
      ...(intentObjectId && extraPath
        ? { extraPaths: { [intentObjectId]: [{ path: extraPath, reason: 'manual' as const }] } }
        : {}),
    };
    try {
      const plan = await planTrace(projectId, config);
      if (plan.intents.length === 0) {
        addToast(
          intentObjectId
            ? 'That intent is not traceable (rejected or missing)'
            : data?.latestRepoRef
              ? 'Every intent already has a trace at this commit'
              : 'No intents to trace yet — extract intents first'
        );
        setWarnings(plan.warnings);
        return;
      }
      const conversations: StoredConversation[] = plan.conversationIds.length
        ? await db.conversations.where('id').anyOf(plan.conversationIds).toArray()
        : [];
      setPending({
        kind: 'trace',
        disclosure: buildDisclosure(conversations, provider),
        authMode: await getProviderAuthMode(provider),
        plan,
        config,
      });
    } catch (err) {
      addToast(`Cannot trace: ${(err as Error).message}`, 'error');
    } finally {
      setProgress(null);
    }
  };

  const handleConfirm = async () => {
    if (!pending || !provider || !projectId) return;
    const run = pending;
    setPending(null);
    setWarnings([]);
    try {
      if (run.kind === 'extract') {
        setProgress({ label: 'Extracting intents', done: 0, total: 1 });
        const outcome = await runIntentExtraction(
          projectId,
          { provider, ignoreCursor: run.ignoreCursor, heuristic: { mode: heuristic } },
          { onProgress: (done, total) => setProgress({ label: 'Extracting intents', done, total }) }
        );
        addToast(
          `Extraction: ${outcome.intentsCreated} new intent${outcome.intentsCreated !== 1 ? 's' : ''}, ${
            outcome.intentsSupported
          } matched existing, ${outcome.pairsSent} of ${outcome.pairsConsidered} replies sent` +
            (outcome.warnings.length ? ` (${outcome.warnings.length} warnings)` : '')
        );
        setWarnings(outcome.warnings);
      } else {
        setProgress({ label: 'Tracing intents', done: 0, total: run.plan.intents.length });
        const outcome = await runTrace(projectId, run.plan, run.config, {
          onProgress: (done, total) => setProgress({ label: 'Tracing intents', done, total }),
        });
        addToast(
          `Trace: ${outcome.traced} traced, ${outcome.errored} errored` +
            (outcome.aborted ? ' — stopped by GitHub rate limit' : '') +
            (outcome.rateLimit.remaining !== undefined ? ` · ${outcome.rateLimit.remaining} GitHub requests left` : ''),
          outcome.aborted ? 'error' : 'success'
        );
        setWarnings(outcome.warnings);
      }
    } catch (err) {
      addToast(`${run.kind === 'extract' ? 'Extraction' : 'Trace'} failed: ${(err as Error).message}`, 'error');
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
  const traceDisabledReason = !repository
    ? 'Bind a repository first'
    : !provider
      ? 'Configure an LLM provider in Settings'
      : null;

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-violet-600 dark:text-violet-400">Intent Trace</p>
          <h1 className="mt-1 text-2xl font-semibold text-gray-900 dark:text-white">
            What you asked for, whether it is written down, and whether it is built
          </h1>
          <p className="mt-2 max-w-3xl text-sm text-gray-500 dark:text-gray-400">
            Intents are your own words from the project&apos;s conversations, marked{' '}
            <span className="font-medium">Unprompted</span> when you raised them yourself and{' '}
            <span className="font-medium">Reply to AI</span> when they answered an assistant. Every
            status carries a verbatim quote you can open; anything the model could not verify says
            “unknown”. This is triage, not a verdict — open the link before you trust a row.
          </p>
          {data.latestRepoRef && (
            <p className="mt-2 text-xs text-gray-400">
              Last traced against{' '}
              <span className="font-mono">
                {data.latestRepoRef.owner}/{data.latestRepoRef.repo}@{data.latestRepoRef.commitSha.slice(0, 7)}
              </span>
              {data.latestTracedAt && ` on ${data.latestTracedAt.toISOString().slice(0, 10)}`}
              {stale && (
                <span className="ml-2 text-amber-600 dark:text-amber-400">
                  · {repository?.defaultBranch ?? 'default branch'} has moved to {stale}
                </span>
              )}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {providers.length > 1 && (
            <select
              value={provider ?? ''}
              onChange={(e) => setProvider(e.target.value as LLMProviderId)}
              aria-label="LLM provider"
              className={SELECT}
            >
              {providers.map((p) => (
                <option key={p} value={p}>
                  {getProviderInfo(p).label}
                </option>
              ))}
            </select>
          )}
          <select
            value={heuristic}
            onChange={(e) => setHeuristic(e.target.value as HeuristicMode)}
            aria-label="Reply filter"
            title="Which replies are sent for extraction"
            className={SELECT}
          >
            <option value="lenient">Likely intents (default)</option>
            <option value="strict">Strict pattern match</option>
            <option value="off">Send all replies</option>
          </select>
          <button
            type="button"
            onClick={() => void handleExtractClick()}
            disabled={!provider || progress !== null}
            title={!provider ? 'Configure an LLM provider in Settings' : undefined}
            className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50"
          >
            <Sparkles size={14} /> Extract intents
          </button>
          <button
            type="button"
            onClick={() => void handleTraceClick()}
            disabled={traceDisabledReason !== null || progress !== null}
            title={traceDisabledReason ?? undefined}
            className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg border border-violet-300 dark:border-violet-800 text-violet-700 dark:text-violet-300 hover:bg-violet-50 dark:hover:bg-violet-900/20 disabled:opacity-50"
          >
            <GitCompare size={14} /> Trace against repo
          </button>
        </div>
      </section>

      {!repository && (
        <RepoBindingCard project={project} onSaved={() => void load()} />
      )}
      {repository && !tokenPresent && (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          No GitHub token on this device — public repositories trace at 60 requests/hour; private ones
          need a token in Settings → GitHub.
        </p>
      )}
      {provider === 'openai' && (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          The OpenAI subscription path adds roughly 14k tokens of overhead per call; prefer Anthropic
          for large runs.
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
          <summary className="cursor-pointer">
            {warnings.length} warning{warnings.length !== 1 ? 's' : ''} from the last run
          </summary>
          <ul className="mt-2 list-disc pl-4 space-y-0.5">
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </details>
      )}

      {data.rows.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <select aria-label="Origin filter" className={SELECT} value={filters.origin} onChange={(e) => setFilters({ ...filters, origin: e.target.value as typeof filters.origin })}>
            <option value="all">All origins</option>
            {(Object.keys(ORIGIN_LABEL) as IntentOrigin[]).map((o) => (
              <option key={o} value={o}>{ORIGIN_LABEL[o]}</option>
            ))}
          </select>
          <select aria-label="Polarity filter" className={SELECT} value={filters.polarity} onChange={(e) => setFilters({ ...filters, polarity: e.target.value as typeof filters.polarity })}>
            <option value="all">All polarities</option>
            {(Object.keys(POLARITY_LABEL) as IntentPolarity[]).map((p) => (
              <option key={p} value={p}>{POLARITY_LABEL[p]}</option>
            ))}
          </select>
          <select aria-label="Spec filter" className={SELECT} value={filters.spec} onChange={(e) => setFilters({ ...filters, spec: e.target.value as typeof filters.spec })}>
            <option value="all">Any spec status</option>
            {(Object.keys(SPEC_STATUS_LABEL) as SpecStatus[]).map((s) => (
              <option key={s} value={s}>{SPEC_STATUS_LABEL[s]}</option>
            ))}
          </select>
          <select aria-label="Implementation filter" className={SELECT} value={filters.impl} onChange={(e) => setFilters({ ...filters, impl: e.target.value as typeof filters.impl })}>
            <option value="all">Any implementation status</option>
            <option value="untraced">not traced</option>
            {(Object.keys(IMPL_STATUS_LABEL) as ImplStatus[]).map((s) => (
              <option key={s} value={s}>{IMPL_STATUS_LABEL[s]}</option>
            ))}
          </select>
          <select aria-label="Review filter" className={SELECT} value={filters.review} onChange={(e) => setFilters({ ...filters, review: e.target.value as typeof filters.review })}>
            <option value="all">Any review state</option>
            <option value="pending">pending</option>
            <option value="accepted">accepted</option>
            <option value="edited">edited</option>
          </select>
          <span className="text-gray-400">
            {rows.length} of {data.rows.length}
          </span>
        </div>
      )}

      {data.rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 p-8 text-center text-sm text-gray-500 dark:text-gray-400">
          No intents yet. Extract intents from this project&apos;s conversations to start.
        </div>
      ) : (
        <IntentTraceTable
          rows={rows}
          sourcesByConversation={sourcesByConversation}
          onReview={(objectId, state) => void handleReview(objectId, state)}
          onOpenHistory={setHistoryObjectId}
          onTrace={(objectId, extraPath) => void handleTraceClick(objectId, extraPath)}
          traceDisabledReason={progress ? 'A run is in progress' : traceDisabledReason}
        />
      )}

      {pending && (
        <DisclosureModal
          disclosure={pending.disclosure}
          authMode={pending.authMode}
          actionLabel={pending.kind === 'extract' ? 'Intent extraction' : 'Intent trace'}
          title={pending.kind === 'trace' ? `Send repository excerpts to ${pending.disclosure.providerLabel}?` : undefined}
          sendsDescription={
            pending.kind === 'trace'
              ? `${pending.plan.intents.length} intent statement${pending.plan.intents.length !== 1 ? 's' : ''}, excerpts of ${pending.plan.filePaths.length} file${pending.plan.filePaths.length !== 1 ? 's' : ''} from ${pending.plan.repoRef.owner}/${pending.plan.repoRef.repo}@${pending.plan.repoRef.commitSha.slice(0, 7)}, and ${pending.plan.specPaths.length} spec document${pending.plan.specPaths.length !== 1 ? 's' : ''}. Excerpts are stored with your understanding (encrypted in sync)`
              : pending.ignoreCursor
                ? `replies from all ${pending.disclosure.totalConversations} associated conversation${pending.disclosure.totalConversations !== 1 ? 's' : ''} (full re-run)`
                : undefined
          }
          confirmLabel={pending.kind === 'extract' ? 'Send and extract' : 'Send and trace'}
          onConfirm={() => void handleConfirm()}
          onCancel={() => setPending(null)}
        />
      )}
      {historyObjectId && <HistoryDrawer objectId={historyObjectId} onClose={() => setHistoryObjectId(null)} />}
    </div>
  );
}

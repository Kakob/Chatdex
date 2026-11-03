// Change Workspace — Assisted mode (SPEC-change-workspace §13, laws §2.3 /
// §2.7; CW-7). Six actions, each one provider call behind the disclosure
// modal. Outputs land only as `ai_inference` evidence, `learned.aiSuggested`,
// or an unsaved promotion draft the developer may copy — never as a status,
// an edge state, a hypothesis, or a promotion.

import { useEffect, useMemo, useState } from 'react';
import { Loader2, Sparkles, Unlock } from 'lucide-react';
import { getProviderAuthMode, getProviderInfo, listReadyProviders, type AuthMode, type LLMProviderId } from '../../lib/providers';
import { DisclosureModal } from '../understanding/DisclosureModal';
import type { DisclosureSummary } from '../../lib/understanding/runDiscovery';
import { getGitHubToken } from '../../lib/github/credentials';
import { latestCachedSnapshot, listRepoFiles } from '../../lib/db/repoFiles';
import {
  ASSISTED_ACTION_LABEL,
  applyAssistedOutcome,
  planAssisted,
  runAssisted,
  type AssistedAction,
  type AssistedPlan,
} from '../../lib/prepare/assisted';
import { promotionCandidates } from '../../lib/prepare/promote';
import { addHypothesis, setWorkspaceMode } from '../../lib/prepare/lifecycle';
import { canAppend } from '../../lib/prepare/editability';
import { generateId } from '../../lib/utils/ids';
import { useToastStore } from '../../stores/toastStore';
import { usePrepareWorkspaceStore } from '../../stores/prepareWorkspaceStore';
import type { PreparedChange } from '../../types/preparedChange';
import type { UnderstandingProject } from '../../types/understanding';
import type { RepoFileRow } from '../../types/repo';

interface Props {
  change: PreparedChange;
  project: UnderstandingProject;
  onChanged: (change: PreparedChange) => Promise<void>;
}

const ACTIONS: AssistedAction[] = ['explain', 'suggest_files', 'propose_hypotheses', 'check_interpretation', 'challenge_explanation', 'draft_promotion'];

export function AssistedSection({ change, project, onChanged }: Props) {
  const addToast = useToastStore((s) => s.addToast);
  const requestSearch = usePrepareWorkspaceStore((s) => s.requestSearch);
  const unlocked = change.mode === 'assisted';
  const [providers, setProviders] = useState<LLMProviderId[]>([]);
  const [provider, setProvider] = useState<LLMProviderId | null>(null);
  const [rows, setRows] = useState<RepoFileRow[]>([]);
  const [action, setAction] = useState<AssistedAction>('explain');
  const [targetPath, setTargetPath] = useState('');
  const [claim, setClaim] = useState('');
  const [selection, setSelection] = useState<{ evidenceIds: string[]; edgeIds: string[] }>({ evidenceIds: [], edgeIds: [] });
  const [pending, setPending] = useState<{ plan: AssistedPlan; disclosure: DisclosureSummary; authMode: AuthMode } | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastResult, setLastResult] = useState<{ action: AssistedAction; summary: string; hypotheses?: string[]; draft?: { title: string; body: string }; files?: string[] } | null>(null);

  const repoKey = project.repository ? `gh:${project.repository.owner}/${project.repository.repo}` : null;
  const candidates = useMemo(() => promotionCandidates(change), [change]);

  useEffect(() => {
    let cancelled = false;
    void listReadyProviders().then((ready) => {
      if (cancelled) return;
      setProviders(ready);
      setProvider((p) => p ?? ready[0] ?? null);
    });
    if (repoKey) {
      void latestCachedSnapshot(repoKey).then(async (sha) => {
        if (cancelled || !sha) return;
        setRows(await listRepoFiles(repoKey, sha));
      });
    }
    return () => {
      cancelled = true;
    };
  }, [repoKey]);

  const unlock = async () => {
    try {
      await onChanged(await setWorkspaceMode(change.id, 'assisted'));
      addToast('Assisted actions unlocked — every call is disclosed first');
    } catch (err) {
      addToast(err instanceof Error ? err.message : String(err), 'error');
    }
  };

  const prepare = async () => {
    if (!provider) return addToast('Configure an LLM provider in Settings first', 'error');
    setBusy(true);
    try {
      const plan = await planAssisted(action, provider, {
        change,
        rows,
        target: targetPath.trim() ? { path: targetPath.trim() } : undefined,
        claim,
        selection,
      });
      const info = getProviderInfo(provider);
      const disclosure: DisclosureSummary = { provider, providerLabel: info.label, totalConversations: 0, bySource: [], crossProviderSources: [] };
      setPending({ plan, disclosure, authMode: await getProviderAuthMode(provider) });
    } catch (err) {
      addToast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!pending) return;
    const { plan } = pending;
    setPending(null);
    setBusy(true);
    try {
      const token = await getGitHubToken();
      const result = await runAssisted(plan, { secrets: [token] });
      const applied = await applyAssistedOutcome(change, plan, result, generateId);
      await onChanged(applied.change);
      const o = result.outcome;
      setLastResult({
        action: plan.action,
        summary:
          o.kind === 'inference' ? o.text : o.kind === 'challenge' ? o.text : o.kind === 'suggested_files' ? `${o.paths.length} file(s) suggested` : o.kind === 'hypotheses' ? `${o.hypotheses.length} hypothesis proposal(s) recorded as AI inference` : 'Draft ready — copy it into Promote if you agree',
        ...(o.kind === 'hypotheses' ? { hypotheses: o.hypotheses } : {}),
        ...(o.kind === 'draft' ? { draft: o } : {}),
        ...(o.kind === 'suggested_files' ? { files: o.paths.map((p) => p.path) } : {}),
      });
      addToast(o.kind === 'challenge' ? 'Challenge placed beside your explanation' : o.kind === 'draft' ? 'Draft returned (not saved)' : 'Recorded as AI inference');
    } catch (err) {
      addToast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const adoptHypothesis = async (text: string) => {
    if (!canAppend(change, 'hypotheses')) return;
    try {
      await onChanged(await addHypothesis(change.id, text, 'ai'));
      addToast('Adopted as your hypothesis (marked AI-drafted)');
    } catch (err) {
      addToast(err instanceof Error ? err.message : String(err), 'error');
    }
  };

  const sends = (plan: AssistedPlan) =>
    [
      plan.excerpts.length ? `${plan.excerpts.length} repository excerpt${plan.excerpts.length === 1 ? '' : 's'} (${Math.ceil(plan.totalBytes / 1024)} KB${plan.redactions ? `, ${plan.redactions} secret-shaped string(s) redacted` : ''})` : null,
      plan.treePaths ? `a list of ${plan.treePaths} repository paths` : null,
      plan.includes.length ? `this workspace's ${plan.includes.join(', ')}` : null,
    ]
      .filter(Boolean)
      .join(', ');

  return (
    <section className="rounded-xl border border-amber-200 dark:border-amber-900/60 bg-white dark:bg-gray-900" data-testid="assisted-section">
      <div className="flex flex-wrap items-center gap-3 px-5 py-4 border-b border-amber-100 dark:border-amber-900/40">
        <Sparkles size={16} className="text-amber-600 dark:text-amber-400" />
        <h2 className="font-semibold text-gray-900 dark:text-white">Assisted</h2>
        <span className="text-xs text-gray-400">
          {unlocked ? 'unlocked · every call is disclosed · outputs are AI inference, never status' : 'locked — Guided mode makes no AI calls'}
        </span>
        {!unlocked && (
          <button type="button" onClick={() => void unlock()} className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-amber-300 dark:border-amber-800 text-amber-800 dark:text-amber-300">
            <Unlock size={14} /> Unlock Assisted actions
          </button>
        )}
      </div>

      {unlocked && (
        <div className="p-5 space-y-3">
          {providers.length === 0 ? (
            <p className="text-xs text-gray-500 dark:text-gray-400">No LLM provider is configured. Add one in Settings → LLM providers.</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <select value={provider ?? ''} onChange={(e) => setProvider(e.target.value as LLMProviderId)} aria-label="Assisted provider" className="px-2 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100">
                  {providers.map((p) => (
                    <option key={p} value={p}>{getProviderInfo(p).label}</option>
                  ))}
                </select>
                <select value={action} onChange={(e) => setAction(e.target.value as AssistedAction)} aria-label="Assisted action" className="px-2 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100">
                  {ACTIONS.map((a) => (
                    <option key={a} value={a}>{ASSISTED_ACTION_LABEL[a]}</option>
                  ))}
                </select>
                {action === 'explain' && (
                  <input value={targetPath} onChange={(e) => setTargetPath(e.target.value)} list="assisted-paths" placeholder="cached file path" aria-label="File to explain" className="flex-1 min-w-56 px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100" />
                )}
                <datalist id="assisted-paths">
                  {rows.slice(0, 500).map((r) => <option key={r.path} value={r.path} />)}
                </datalist>
                {action === 'check_interpretation' && (
                  <input value={claim} onChange={(e) => setClaim(e.target.value)} placeholder="my interpretation, e.g. SearchPage passes messageId through the route" aria-label="Interpretation to check" className="flex-1 min-w-64 px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100" />
                )}
                <button type="button" onClick={() => void prepare()} disabled={busy} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-amber-600 text-white disabled:opacity-50">
                  {busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} Prepare &amp; disclose
                </button>
              </div>
              {action === 'draft_promotion' && (
                <div className="text-xs text-gray-600 dark:text-gray-400 flex flex-wrap gap-3">
                  {candidates.evidence.map((e) => (
                    <label key={e.id} className="inline-flex items-center gap-1">
                      <input type="checkbox" checked={selection.evidenceIds.includes(e.id)} onChange={(ev) => setSelection((s) => ({ ...s, evidenceIds: ev.target.checked ? [...s.evidenceIds, e.id] : s.evidenceIds.filter((id) => id !== e.id) }))} />
                      {e.kind === 'code' ? `${e.path}:${e.startLine}` : e.kind}
                    </label>
                  ))}
                  {candidates.edges.map(({ edge, fromLabel, toLabel }) => (
                    <label key={edge.id} className="inline-flex items-center gap-1">
                      <input type="checkbox" checked={selection.edgeIds.includes(edge.id)} onChange={(ev) => setSelection((s) => ({ ...s, edgeIds: ev.target.checked ? [...s.edgeIds, edge.id] : s.edgeIds.filter((id) => id !== edge.id) }))} />
                      {fromLabel} → {toLabel}
                    </label>
                  ))}
                  {candidates.evidence.length === 0 && candidates.edges.length === 0 && <span>Nothing verified to draft from yet.</span>}
                </div>
              )}
              {rows.length === 0 && (action === 'explain' || action === 'suggest_files' || action === 'check_interpretation') && (
                <p className="text-xs text-amber-700 dark:text-amber-300">The repository is not indexed on this device — index it in Evidence first so excerpts come from the pinned commit.</p>
              )}
            </>
          )}

          {lastResult && (
            <div className="rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50/50 dark:bg-amber-900/10 p-3 text-xs space-y-2" data-testid="assisted-result">
              <p className="font-medium text-amber-800 dark:text-amber-300">{ASSISTED_ACTION_LABEL[lastResult.action]} — AI inference, not verification</p>
              <p className="whitespace-pre-wrap text-gray-700 dark:text-gray-300">{lastResult.summary}</p>
              {lastResult.files && lastResult.files.length > 0 && (
                <ul className="space-y-1">
                  {lastResult.files.map((p) => (
                    <li key={p}>
                      <button type="button" onClick={() => requestSearch('grep', '', p)} className="font-mono underline text-violet-600 dark:text-violet-400">{p}</button>
                    </li>
                  ))}
                </ul>
              )}
              {lastResult.hypotheses && (
                <ul className="space-y-1">
                  {lastResult.hypotheses.map((h) => (
                    <li key={h} className="flex flex-wrap items-center gap-2">
                      <span className="flex-1 text-gray-700 dark:text-gray-300">{h}</span>
                      {canAppend(change, 'hypotheses') && (
                        <button type="button" onClick={() => void adoptHypothesis(h)} className="underline text-amber-800 dark:text-amber-300">Adopt as my hypothesis</button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {lastResult.draft && (
                <div className="space-y-1">
                  <p className="font-medium text-gray-900 dark:text-white">{lastResult.draft.title}</p>
                  <p className="text-gray-700 dark:text-gray-300">{lastResult.draft.body}</p>
                  <p className="text-gray-500">Not saved. Copy it into Promote if you agree with it.</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {pending && (
        <DisclosureModal
          disclosure={pending.disclosure}
          authMode={pending.authMode}
          title={`Send repository excerpts to ${pending.disclosure.providerLabel}?`}
          actionLabel={ASSISTED_ACTION_LABEL[pending.plan.action]}
          sendsDescription={sends(pending.plan)}
          confirmLabel="Send"
          onConfirm={() => void confirm()}
          onCancel={() => setPending(null)}
        />
      )}
    </section>
  );
}

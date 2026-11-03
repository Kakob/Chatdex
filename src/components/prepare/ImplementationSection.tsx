// Change Workspace — Implementation section (SPEC-change-workspace §11, §14;
// CW-3). Chatdex never produces a diff (D6): the developer attaches one from a
// GitHub compare, a pull request, an ingested Claude Code session, or a pasted
// unified diff, and records its provenance. Attaching moves the workspace to
// `implementing` and freezes the open hypothesis (law §2.4).

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, GitPullRequest, History, Loader2, Paperclip } from 'lucide-react';
import { getGitHubToken } from '../../lib/github/credentials';
import { compareUrl, pullUrl } from '../../lib/github/client';
import { getAssociatedConversations } from '../../lib/understanding/reconcile';
import { attachImplementation } from '../../lib/prepare/lifecycle';
import { editabilityOf } from '../../lib/prepare/editability';
import {
  PROVENANCE_LABEL,
  implementationFromClaudeCodeSession,
  implementationFromCompare,
  implementationFromPastedDiff,
  implementationFromPull,
  implementationStats,
  type AttachInput,
  type CapReport,
} from '../../lib/prepare/implementation';
import { useToastStore } from '../../stores/toastStore';
import { recordInspection } from '../../lib/db/inspections';
import type { Implementation, ImplementationProvenance, PreparedChange } from '../../types/preparedChange';
import type { UnderstandingProject } from '../../types/understanding';

type SourceTab = 'session' | 'pr' | 'compare' | 'paste';

interface Props {
  change: PreparedChange;
  project: UnderstandingProject;
  onChanged: (change: PreparedChange) => Promise<void>;
}

const PROVENANCES: ImplementationProvenance[] = ['human', 'ai', 'human_ai', 'imported'];

export function ImplementationSection({ change, project, onChanged }: Props) {
  const addToast = useToastStore((s) => s.addToast);
  const editability = editabilityOf(change, 'implementation');
  const canAttach = editability === 'attachable' || editability === 'replaceable';
  const repository = project.repository;

  const [tab, setTab] = useState<SourceTab>('session');
  const [provenance, setProvenance] = useState<ImplementationProvenance>('ai');
  const [note, setNote] = useState('');
  const [keepPatches, setKeepPatches] = useState(true);
  const [sessions, setSessions] = useState<{ id: string; name: string; updatedAt: Date }[]>([]);
  const [sessionId, setSessionId] = useState('');
  const [prNumber, setPrNumber] = useState('');
  const [base, setBase] = useState('');
  const [head, setHead] = useState('');
  const [pasted, setPasted] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getAssociatedConversations(project.id).then((convs) => {
      if (cancelled) return;
      const cc = convs
        .filter((c) => c.source === 'claude-code')
        .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
        .map((c) => ({ id: c.id, name: c.name ?? c.id, updatedAt: c.updatedAt }));
      setSessions(cc);
      setSessionId((current) => current || cc[0]?.id || '');
    });
    return () => {
      cancelled = true;
    };
  }, [project.id]);

  useEffect(() => {
    if (!change.implementation) return;
    void recordInspection({ projectId: project.id, workspaceId: change.id, kind: 'diff', targetKey: `${change.implementation.source}:${change.implementation.attachedAt}` });
  }, [project.id, change.id, change.implementation]);

  useEffect(() => {
    // Sensible default per source: a Claude Code session is the agent's work.
    setProvenance(tab === 'session' ? 'ai' : tab === 'paste' ? 'human' : 'human_ai');
  }, [tab]);

  const attach = async (input: AttachInput, report?: CapReport) => {
    const updated = await attachImplementation(change.id, input);
    await onChanged(updated);
    const stats = implementationStats(input.files);
    const extras = [
      report && report.redactions > 0 ? `${report.redactions} secret-shaped string(s) redacted` : null,
      report && report.patchesDropped.length > 0 ? `${report.patchesDropped.length} patch(es) kept as stats only (size cap)` : null,
      change.state === 'draft' ? 'workspace marked ready' : null,
    ].filter(Boolean);
    addToast(`Attached ${stats.files} file(s), +${stats.additions} −${stats.deletions}${extras.length ? ` · ${extras.join('; ')}` : ''}`);
  };

  const submit = async () => {
    setBusy(true);
    try {
      const provenanceNote = note.trim() || undefined;
      if (tab === 'session') {
        if (!sessionId) throw new Error('Pick a Claude Code session');
        const { input } = await implementationFromClaudeCodeSession(sessionId, { provenance, provenanceNote });
        await attach(input);
      } else if (tab === 'paste') {
        const { input, report } = implementationFromPastedDiff(pasted, { provenance, provenanceNote, keepPatches });
        await attach(input, report);
        setPasted('');
      } else {
        if (!repository) throw new Error('Bind a repository first');
        const token = await getGitHubToken();
        const client = { token };
        if (tab === 'pr') {
          const n = Number(prNumber);
          const { input, report } = await implementationFromPull(repository.owner, repository.repo, n, { provenance, provenanceNote, keepPatches, client });
          await attach(input, report);
        } else {
          const { input, report } = await implementationFromCompare(repository.owner, repository.repo, base.trim(), head.trim(), { provenance, provenanceNote, keepPatches, client });
          await attach(input, report);
        }
      }
    } catch (err) {
      addToast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
      <div className="flex flex-wrap items-center gap-3 px-5 py-4 border-b border-gray-100 dark:border-gray-800">
        <GitPullRequest size={16} className="text-violet-600 dark:text-violet-400" />
        <h2 className="font-semibold text-gray-900 dark:text-white">Implementation</h2>
        <span className="text-xs text-gray-400">attached, never produced by Chatdex · provenance ≠ correctness</span>
      </div>

      <div className="p-5 space-y-5">
        {change.implementation && <AttachedImplementation implementation={change.implementation} repository={repository} />}
        {change.implementationHistory && change.implementationHistory.length > 0 && (
          <p className="inline-flex items-center gap-1 text-xs text-gray-400">
            <History size={12} /> {change.implementationHistory.length} earlier attachment{change.implementationHistory.length === 1 ? '' : 's'} kept in history
          </p>
        )}

        {canAttach && (
          <div className="space-y-3 rounded-lg bg-gray-50 dark:bg-gray-950 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                {editability === 'replaceable' ? 'Replace implementation from' : 'Attach implementation from'}
              </span>
              <div className="inline-flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden text-xs">
                {(
                  [
                    ['session', 'Claude Code session'],
                    ['pr', 'Pull request'],
                    ['compare', 'Compare refs'],
                    ['paste', 'Pasted diff'],
                  ] as [SourceTab, string][]
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setTab(key)}
                    className={`px-3 py-1.5 ${tab === key ? 'bg-violet-600 text-white' : 'text-gray-600 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-900'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {tab === 'session' && (
              sessions.length === 0 ? (
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  No Claude Code sessions are associated with this project. Import the session JSONL, then associate it under{' '}
                  <Link to={`/projects/${project.id}`} className="underline">the project overview</Link>.
                </p>
              ) : (
                <select
                  value={sessionId}
                  onChange={(e) => setSessionId(e.target.value)}
                  aria-label="Claude Code session"
                  className="w-full px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
                >
                  {sessions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} · {s.updatedAt.toLocaleDateString()}
                    </option>
                  ))}
                </select>
              )
            )}
            {tab === 'pr' && (
              <input
                value={prNumber}
                onChange={(e) => setPrNumber(e.target.value)}
                placeholder="pull request number"
                aria-label="Pull request number"
                inputMode="numeric"
                className="w-48 px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
              />
            )}
            {tab === 'compare' && (
              <div className="flex flex-wrap gap-2">
                <input value={base} onChange={(e) => setBase(e.target.value)} placeholder="base (main or sha)" aria-label="Base ref" className="flex-1 min-w-40 px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100" />
                <input value={head} onChange={(e) => setHead(e.target.value)} placeholder="head (branch or sha)" aria-label="Head ref" className="flex-1 min-w-40 px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100" />
              </div>
            )}
            {tab === 'paste' && (
              <textarea
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
                rows={8}
                placeholder="git diff output (unified diff)"
                aria-label="Pasted diff"
                className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 font-mono text-xs"
              />
            )}
            {(tab === 'pr' || tab === 'compare') && !repository && (
              <p className="text-xs text-amber-700 dark:text-amber-300">
                Bind a repository on the <Link to={`/projects/${project.id}/intents`} className="underline">Intent Trace tab</Link> first.
              </p>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <label className="text-xs text-gray-600 dark:text-gray-400 inline-flex items-center gap-2">
                Produced by
                <select
                  value={provenance}
                  onChange={(e) => setProvenance(e.target.value as ImplementationProvenance)}
                  aria-label="Implementation provenance"
                  className="px-2 py-1 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
                >
                  {PROVENANCES.map((p) => (
                    <option key={p} value={p}>{PROVENANCE_LABEL[p]}</option>
                  ))}
                </select>
              </label>
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="provenance note (optional)"
                aria-label="Provenance note"
                className="flex-1 min-w-48 px-3 py-1 text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
              />
              {tab !== 'session' && (
                <label className="inline-flex items-center gap-1 text-xs text-gray-600 dark:text-gray-400">
                  <input type="checkbox" checked={keepPatches} onChange={(e) => setKeepPatches(e.target.checked)} /> store patch text (scrubbed, ≤ 20 KB/file)
                </label>
              )}
              <button
                type="button"
                onClick={() => void submit()}
                disabled={busy}
                className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-violet-600 text-white disabled:opacity-50"
              >
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Paperclip size={14} />} Attach
              </button>
            </div>
            <p className="text-xs text-gray-400">
              Attaching freezes your open hypothesis{change.state === 'draft' ? ' and marks the workspace ready' : ''}. Chatdex reads the diff; it never writes to the repository.
            </p>
          </div>
        )}

        {!canAttach && !change.implementation && (
          <p className="text-xs text-gray-400">No implementation attached.</p>
        )}
      </div>
    </section>
  );
}

function AttachedImplementation({ implementation, repository }: { implementation: Implementation; repository?: { owner: string; repo: string } }) {
  const stats = implementationStats(implementation.files);
  let link: string | null = null;
  try {
    if (repository && implementation.source === 'github_pr' && implementation.prNumber) {
      link = pullUrl(repository.owner, repository.repo, implementation.prNumber);
    } else if (repository && implementation.source === 'github_compare' && implementation.baseSha && implementation.headSha) {
      link = compareUrl(repository.owner, repository.repo, implementation.baseSha, implementation.headSha);
    }
  } catch {
    link = null;
  }
  const SOURCE_LABEL: Record<Implementation['source'], string> = {
    github_compare: 'GitHub compare',
    github_pr: 'Pull request',
    claude_code_session: 'Claude Code session',
    pasted_diff: 'Pasted diff',
  };
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-3 text-sm space-y-2" data-testid="attached-implementation">
      <div className="flex flex-wrap items-center gap-2">
        <span className="px-1.5 py-0.5 rounded text-xs bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300">{SOURCE_LABEL[implementation.source]}</span>
        <span className="px-1.5 py-0.5 rounded text-xs bg-violet-50 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300">
          {PROVENANCE_LABEL[implementation.provenance]}
        </span>
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {stats.files} file{stats.files === 1 ? '' : 's'} · +{stats.additions} −{stats.deletions}
          {implementation.prNumber ? ` · #${implementation.prNumber}` : ''}
          {implementation.baseSha && implementation.headSha ? ` · ${implementation.baseSha.slice(0, 7)}…${implementation.headSha.slice(0, 7)}` : ''}
        </span>
        {link && (
          <a href={link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-violet-600 dark:text-violet-400">
            <ExternalLink size={12} /> open on GitHub
          </a>
        )}
        {implementation.conversationId && (
          <Link to={`/conversations/${implementation.conversationId}`} className="text-xs text-violet-600 dark:text-violet-400 underline">
            open session
          </Link>
        )}
        <span className="ml-auto text-xs text-gray-400">attached {new Date(implementation.attachedAt).toLocaleString()}</span>
      </div>
      {implementation.provenanceNote && <p className="text-xs text-gray-600 dark:text-gray-400">{implementation.provenanceNote}</p>}
      <ul className="text-xs font-mono text-gray-700 dark:text-gray-300 max-h-48 overflow-auto">
        {implementation.files.map((f) => (
          <li key={f.path} className="flex gap-3">
            <span className="flex-1 truncate">{f.path}</span>
            <span className="text-emerald-600 dark:text-emerald-400">+{f.additions}</span>
            <span className="text-red-600 dark:text-red-400">−{f.deletions}</span>
            {f.patch ? <span className="text-gray-400">patch</span> : <span className="text-gray-400">stats</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

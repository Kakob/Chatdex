// Guided action menu (SPEC-change-workspace §13, PRD §10; CW-6). The exact,
// deterministic action set for a symbol / file / trace node — nothing here
// calls a provider, so Guided mode cannot leak interpretation. Results
// render inline; repository history and related conversations are looked
// up on demand, and "open file" is logged as an inspection (PRD §17).

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, GitCommitHorizontal, Loader2, MessageSquare, MoreHorizontal, Plus, Search } from 'lucide-react';
import { blobUrl, isGitHubWebUrl, type CommitSummary } from '../../lib/github/client';
import { getGitHubToken } from '../../lib/github/credentials';
import { basename, commitsTouchingPath, findRelatedConversations, symbolFromLabel, type RelatedConversation } from '../../lib/prepare/guided';
import { recordInspection } from '../../lib/db/inspections';
import { usePrepareWorkspaceStore } from '../../stores/prepareWorkspaceStore';
import type { ProjectRepository } from '../../types/understanding';

interface Props {
  projectId: string;
  workspaceId?: string;
  repository?: ProjectRepository;
  /** Identifier to search for; derived from `label` when absent. */
  symbol?: string;
  /** Free-text label (e.g. a trace node) the symbol is derived from. */
  label?: string;
  path?: string;
  sha?: string;
  line?: number;
  /** Shown when the caller can turn the selection into evidence. */
  onAddEvidence?: () => void;
  compact?: boolean;
}

type Panel = 'commits' | 'conversations' | null;

export function GuidedActionMenu({ projectId, workspaceId, repository, symbol, label, path, sha, line, onAddEvidence, compact }: Props) {
  const requestSearch = usePrepareWorkspaceStore((s) => s.requestSearch);
  const requestQuestion = usePrepareWorkspaceStore((s) => s.requestQuestion);
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [loading, setLoading] = useState(false);
  const [commits, setCommits] = useState<CommitSummary[] | null>(null);
  const [related, setRelated] = useState<{ related: RelatedConversation[]; scanned: number; skipped: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ident = symbol ?? (label ? symbolFromLabel(label) : null);
  const term = ident ?? (path ? basename(path) : null);

  let fileHref: string | null = null;
  if (repository && path && sha) {
    try {
      fileHref = blobUrl(repository.owner, repository.repo, sha, path, line);
    } catch {
      fileHref = null;
    }
  }

  const showCommits = async () => {
    if (!repository || !path) return;
    setPanel('commits');
    if (commits) return;
    setLoading(true);
    setError(null);
    try {
      const token = await getGitHubToken();
      setCommits(await commitsTouchingPath(repository, path, { token }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const showConversations = async () => {
    if (!term) return;
    setPanel('conversations');
    if (related) return;
    setLoading(true);
    setError(null);
    try {
      setRelated(await findRelatedConversations(projectId, term));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const openFile = () => {
    if (path) void recordInspection({ projectId, workspaceId, kind: 'file', targetKey: path });
  };

  return (
    <div className="relative inline-block text-xs">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={`Guided actions for ${ident ?? path ?? label ?? 'item'}`}
        title="Guided actions"
        className={`inline-flex items-center gap-1 rounded border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 ${compact ? 'p-1' : 'px-2 py-1'}`}
      >
        <MoreHorizontal size={12} />
        {!compact && 'Actions'}
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-64 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg p-1 space-y-0.5" role="menu">
          {ident && (
            <>
              <MenuItem icon={<Search size={12} />} label={`Show references to ${ident}`} onClick={() => { requestSearch('references', ident); setOpen(false); }} />
              <MenuItem icon={<Search size={12} />} label={`Show declaration of ${ident}`} onClick={() => { requestSearch('symbol', ident); setOpen(false); }} />
            </>
          )}
          {fileHref && (
            <a href={fileHref} target="_blank" rel="noopener noreferrer" onClick={openFile} role="menuitem" className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-200">
              <ExternalLink size={12} /> Open file{line ? ` at line ${line}` : ''} on GitHub
            </a>
          )}
          {repository && path && (
            <MenuItem icon={<GitCommitHorizontal size={12} />} label="Show commits touching this path" onClick={() => void showCommits()} />
          )}
          {term && <MenuItem icon={<MessageSquare size={12} />} label={`Show conversations mentioning ${term}`} onClick={() => void showConversations()} />}
          {onAddEvidence && <MenuItem icon={<Plus size={12} />} label="Add as evidence" onClick={() => { onAddEvidence(); setOpen(false); }} />}
          <MenuItem
            icon={<Plus size={12} />}
            label="Add a question about this"
            onClick={() => {
              requestQuestion(`Why does ${ident ?? label ?? path ?? 'this'} …?`);
              setOpen(false);
            }}
          />
          <p className="px-2 pt-1 text-[10px] text-gray-400">Guided: deterministic lookups only. No AI call.</p>
        </div>
      )}
      {panel && (
        <div className="absolute z-20 mt-1 w-80 max-h-72 overflow-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg p-2 space-y-1" data-testid="guided-panel">
          <div className="flex items-center justify-between">
            <span className="font-medium text-gray-700 dark:text-gray-300">
              {panel === 'commits' ? `Commits touching ${path}` : `Conversations mentioning ${term}`}
            </span>
            <button type="button" onClick={() => setPanel(null)} className="text-gray-400">×</button>
          </div>
          {loading && <span className="inline-flex items-center gap-1 text-gray-500"><Loader2 size={12} className="animate-spin" /> looking up…</span>}
          {error && <p className="text-amber-700 dark:text-amber-300">{error}</p>}
          {panel === 'commits' && commits && (
            commits.length === 0 ? <p className="text-gray-400">No commits found for this path.</p> : (
              <ul className="space-y-1">
                {commits.map((c) => (
                  <li key={c.sha} className="flex items-start gap-2 text-gray-700 dark:text-gray-300">
                    <code className="shrink-0 text-gray-500">{c.sha.slice(0, 7)}</code>
                    <span className="flex-1 truncate" title={c.message}>{c.message.split('\n')[0]}</span>
                    {isGitHubWebUrl(c.htmlUrl) && (
                      <a href={c.htmlUrl} target="_blank" rel="noopener noreferrer" className="text-violet-600 dark:text-violet-400"><ExternalLink size={11} /></a>
                    )}
                  </li>
                ))}
              </ul>
            )
          )}
          {panel === 'conversations' && related && (
            related.related.length === 0 ? (
              <p className="text-gray-400">No associated conversation mentions it ({related.scanned} scanned{related.skipped ? `, ${related.skipped} skipped` : ''}).</p>
            ) : (
              <ul className="space-y-1">
                {related.related.map((r) => (
                  <li key={r.conversationId} className="flex items-center gap-2 text-gray-700 dark:text-gray-300">
                    <span className="px-1 rounded bg-gray-100 dark:bg-gray-800 text-[10px]">{r.source}</span>
                    <Link to={`/conversations/${r.conversationId}${r.firstMessageId ? `?scrollTo=${encodeURIComponent(r.firstMessageId)}` : ''}`} className="flex-1 truncate underline">
                      {r.name}
                    </Link>
                    <span className="text-gray-400">{r.hits}×</span>
                  </li>
                ))}
              </ul>
            )
          )}
        </div>
      )}
    </div>
  );
}

function MenuItem({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button type="button" role="menuitem" onClick={onClick} className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-left hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-200">
      {icon} {label}
    </button>
  );
}

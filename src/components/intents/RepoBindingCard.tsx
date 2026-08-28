// Repository binding for a project (SPEC-intent-trace §8.3). Validates
// `owner/repo` (or a github.com URL) against the API, records the default
// branch, and stores the binding on the UnderstandingProject. Read-only.

import { useEffect, useState } from 'react';
import { CheckCircle, CircleAlert, GitBranch, Loader2, Unlink } from 'lucide-react';
import { putUnderstandingProject } from '../../lib/db/understanding';
import { getGitHubToken } from '../../lib/github/credentials';
import { getRepo, parseRepoInput, GitHubError, type RepoInfo } from '../../lib/github/client';
import { useToastStore } from '../../stores/toastStore';
import type { UnderstandingProject, ProjectRepository } from '../../types/understanding';

interface Props {
  project: UnderstandingProject;
  onSaved: (project: UnderstandingProject) => void;
}

type Validation =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'ok'; owner: string; repo: string; info: RepoInfo }
  | { kind: 'failed'; message: string };

export function RepoBindingCard({ project, onSaved }: Props) {
  const addToast = useToastStore((s) => s.addToast);
  const bound = project.repository;
  const [input, setInput] = useState(bound ? `${bound.owner}/${bound.repo}` : '');
  const [pinnedRef, setPinnedRef] = useState(bound?.pinnedRef ?? '');
  const [validation, setValidation] = useState<Validation>({ kind: 'idle' });
  const [hasToken, setHasToken] = useState<boolean | null>(null);

  useEffect(() => {
    void getGitHubToken().then((t) => setHasToken(Boolean(t)));
  }, []);

  const parsed = parseRepoInput(input);

  const handleValidate = async () => {
    if (!parsed) {
      setValidation({ kind: 'failed', message: 'Enter owner/repo or a github.com URL.' });
      return;
    }
    setValidation({ kind: 'checking' });
    try {
      const token = await getGitHubToken();
      const info = await getRepo(parsed.owner, parsed.repo, { token });
      setValidation({ kind: 'ok', owner: parsed.owner, repo: parsed.repo, info });
    } catch (err) {
      const message =
        err instanceof GitHubError && (err.status === 404 || err.status === 401)
          ? 'Not found or no access. Private repositories need a token in Settings → GitHub.'
          : err instanceof Error
            ? err.message
            : String(err);
      setValidation({ kind: 'failed', message });
    }
  };

  const handleSave = async () => {
    if (validation.kind !== 'ok') return;
    const repository: ProjectRepository = {
      owner: validation.owner,
      repo: validation.repo,
      defaultBranch: validation.info.defaultBranch,
      ...(pinnedRef.trim() ? { pinnedRef: pinnedRef.trim() } : {}),
    };
    const next: UnderstandingProject = { ...project, repository, updatedAt: new Date() };
    await putUnderstandingProject(next);
    addToast(`Bound to ${repository.owner}/${repository.repo}`);
    setValidation({ kind: 'idle' });
    onSaved(next);
  };

  const handleUnbind = async () => {
    if (!confirm('Remove the repository binding? Existing traces are kept.')) return;
    const { repository: _dropped, ...rest } = project;
    void _dropped;
    const next: UnderstandingProject = { ...rest, updatedAt: new Date() };
    await putUnderstandingProject(next);
    setInput('');
    setPinnedRef('');
    setValidation({ kind: 'idle' });
    addToast('Repository binding removed');
    onSaved(next);
  };

  return (
    <section className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-semibold text-gray-900 dark:text-white">
            <GitBranch size={17} className="text-violet-500" />
            Repository
          </h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {bound
              ? `Bound to ${bound.owner}/${bound.repo}${bound.defaultBranch ? ` (${bound.pinnedRef ?? bound.defaultBranch})` : ''}. Intent Trace reads it at a pinned commit.`
              : 'Bind the GitHub repository so Intent Trace can check what is implemented. Read-only.'}
          </p>
        </div>
        {bound && (
          <button
            type="button"
            onClick={() => void handleUnbind()}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <Unlink size={13} /> Unbind
          </button>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <input
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setValidation({ kind: 'idle' });
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleValidate();
          }}
          placeholder="owner/repo or https://github.com/owner/repo"
          aria-label="Repository"
          className="flex-1 min-w-56 px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
        />
        <input
          value={pinnedRef}
          onChange={(e) => setPinnedRef(e.target.value)}
          placeholder="pinned ref (optional)"
          aria-label="Pinned ref"
          className="w-44 px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
        />
        <button
          type="button"
          onClick={() => void handleValidate()}
          disabled={!parsed || validation.kind === 'checking'}
          className="px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
        >
          {validation.kind === 'checking' ? (
            <span className="inline-flex items-center gap-1">
              <Loader2 size={13} className="animate-spin" /> Validating
            </span>
          ) : (
            'Validate'
          )}
        </button>
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={validation.kind !== 'ok'}
          className="px-3 py-2 text-sm rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50"
        >
          Save
        </button>
      </div>

      {validation.kind === 'ok' && (
        <div className="mt-3 space-y-1 text-xs">
          <div className="inline-flex items-center gap-1 text-green-600 dark:text-green-400">
            <CheckCircle size={12} /> {validation.owner}/{validation.repo} — default branch{' '}
            <span className="font-mono">{validation.info.defaultBranch}</span>
            {validation.info.isPrivate ? ' · private' : ' · public'}
          </div>
          {validation.info.canPush && (
            <div className="flex items-start gap-1 text-amber-600 dark:text-amber-400">
              <CircleAlert size={12} className="mt-0.5 shrink-0" />
              <span>
                Your token can push to this repository. Intent Trace only reads — a read-only
                fine-grained token is safer.
              </span>
            </div>
          )}
        </div>
      )}
      {validation.kind === 'failed' && (
        <div className="mt-3 inline-flex items-start gap-1 text-xs text-amber-600 dark:text-amber-400">
          <CircleAlert size={12} className="mt-0.5 shrink-0" /> {validation.message}
        </div>
      )}
      {hasToken === false && !bound && (
        <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
          No GitHub token on this device — public repositories still validate; private ones need
          a token in Settings → GitHub.
        </p>
      )}
    </section>
  );
}

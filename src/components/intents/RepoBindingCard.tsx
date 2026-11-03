// Repository binding for a project (SPEC-intent-trace §8.3). Validates
// `owner/repo` (or a github.com URL) against the API, records the default
// branch, and stores the binding — including the branch/tag/sha to track —
// on the UnderstandingProject. Read-only.

import { useEffect, useRef, useState } from 'react';
import { CheckCircle, CircleAlert, GitBranch, Loader2, Unlink } from 'lucide-react';
import { putUnderstandingProject } from '../../lib/db/understanding';
import { getGitHubToken } from '../../lib/github/credentials';
import {
  getRepo,
  parseRepoInput,
  resolveRef,
  GitHubError,
  type RepoInfo,
} from '../../lib/github/client';
import { useToastStore } from '../../stores/toastStore';
import type { UnderstandingProject, ProjectRepository } from '../../types/understanding';

interface Props {
  project: UnderstandingProject;
  onSaved: (project: UnderstandingProject) => void;
  /** Render as a one-line summary with a Change button when already bound. */
  collapsible?: boolean;
  /** One-click chips, e.g. shas/branches taken from session commits. */
  suggestedRefs?: Array<{ ref: string; label?: string }>;
}

type Validation =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | {
      kind: 'ok';
      owner: string;
      repo: string;
      info: RepoInfo;
      /** The ref that resolved, once one was asked for. */
      ref?: string;
      refSha?: string;
      /** Set when a ref was asked for and none of its candidates resolved. */
      refError?: string;
    }
  | { kind: 'failed'; message: string };

/** How many candidates a slashed `/tree/a/b/c` may cost in requests. */
const MAX_REF_ATTEMPTS = 3;
const MAX_SUGGESTED_REFS = 5;

export function RepoBindingCard({ project, onSaved, collapsible, suggestedRefs }: Props) {
  const addToast = useToastStore((s) => s.addToast);
  const bound = project.repository;
  const [input, setInput] = useState(bound ? `${bound.owner}/${bound.repo}` : '');
  const [ref, setRef] = useState(bound?.pinnedRef ?? '');
  const [refTouched, setRefTouched] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [validation, setValidation] = useState<Validation>({ kind: 'idle' });
  const [hasToken, setHasToken] = useState<boolean | null>(null);
  /** Alternatives for the last pasted URL, when its ref was ambiguous. */
  const pastedCandidates = useRef<string[] | undefined>(undefined);

  useEffect(() => {
    void getGitHubToken().then((t) => setHasToken(Boolean(t)));
  }, []);

  const parsed = parseRepoInput(input);
  const trackedRef = bound?.pinnedRef ?? bound?.defaultBranch;
  const defaultBranchHint =
    bound?.defaultBranch ?? (validation.kind === 'ok' ? validation.info.defaultBranch : undefined);

  const handleInputChange = (value: string) => {
    setInput(value);
    setValidation({ kind: 'idle' });
    const p = parseRepoInput(value);
    pastedCandidates.current = p?.refCandidates;
    // Prefill from a pasted /tree/<branch> URL, but never overwrite typing.
    if (p?.ref && !refTouched) setRef(p.ref);
  };

  const handleRefChange = (value: string) => {
    setRef(value);
    setRefTouched(true);
    setValidation({ kind: 'idle' });
  };

  /** Walk the candidates for a slashed ref; the first that exists wins. */
  const resolveChosenRef = async (
    owner: string,
    repo: string,
    wanted: string,
    token: string | undefined
  ): Promise<{ ref: string; sha: string } | { error: string }> => {
    const attempts = [...new Set([wanted, ...(pastedCandidates.current ?? [])])].slice(
      0,
      MAX_REF_ATTEMPTS
    );
    let lastError: unknown;
    for (const candidate of attempts) {
      try {
        const { sha } = await resolveRef(owner, repo, candidate, { token });
        return { ref: candidate, sha };
      } catch (err) {
        lastError = err;
      }
    }
    const notFound = lastError instanceof GitHubError && lastError.status === 404;
    return {
      error: notFound
        ? 'Ref not found in this repository.'
        : lastError instanceof Error
          ? lastError.message
          : 'Could not resolve the ref.',
    };
  };

  const handleValidate = async () => {
    if (!parsed) {
      setValidation({ kind: 'failed', message: 'Enter owner/repo or a github.com URL.' });
      return;
    }
    setValidation({ kind: 'checking' });
    try {
      const token = await getGitHubToken();
      const info = await getRepo(parsed.owner, parsed.repo, { token });
      const wanted = ref.trim();
      if (!wanted) {
        setValidation({ kind: 'ok', owner: parsed.owner, repo: parsed.repo, info });
        return;
      }
      const resolved = await resolveChosenRef(parsed.owner, parsed.repo, wanted, token);
      if ('error' in resolved) {
        setValidation({
          kind: 'ok',
          owner: parsed.owner,
          repo: parsed.repo,
          info,
          refError: resolved.error,
        });
        return;
      }
      setRef(resolved.ref);
      setValidation({
        kind: 'ok',
        owner: parsed.owner,
        repo: parsed.repo,
        info,
        ref: resolved.ref,
        refSha: resolved.sha,
      });
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
    if (validation.kind !== 'ok' || validation.refError) return;
    const repository: ProjectRepository = {
      owner: validation.owner,
      repo: validation.repo,
      defaultBranch: validation.info.defaultBranch,
      ...(validation.ref ? { pinnedRef: validation.ref } : {}),
    };
    const next: UnderstandingProject = { ...project, repository, updatedAt: new Date() };
    await putUnderstandingProject(next);
    addToast(
      `Bound to ${repository.owner}/${repository.repo} · ${repository.pinnedRef ?? repository.defaultBranch}`
    );
    setValidation({ kind: 'idle' });
    setRefTouched(false);
    setExpanded(false);
    onSaved(next);
  };

  const handleUnbind = async () => {
    if (!confirm('Remove the repository binding? Existing traces are kept.')) return;
    const { repository: _dropped, ...rest } = project;
    void _dropped;
    const next: UnderstandingProject = { ...rest, updatedAt: new Date() };
    await putUnderstandingProject(next);
    setInput('');
    setRef('');
    setRefTouched(false);
    setExpanded(false);
    setValidation({ kind: 'idle' });
    addToast('Repository binding removed');
    onSaved(next);
  };

  const handleExpand = () => {
    if (bound) {
      setInput(`${bound.owner}/${bound.repo}`);
      setRef(bound.pinnedRef ?? '');
    }
    setRefTouched(false);
    pastedCandidates.current = undefined;
    setValidation({ kind: 'idle' });
    setExpanded(true);
  };

  if (collapsible && bound && !expanded) {
    return (
      <section className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-2.5 text-sm">
        <GitBranch size={15} className="text-violet-500 shrink-0" />
        <span className="font-mono text-gray-900 dark:text-gray-100">
          {bound.owner}/{bound.repo}
        </span>
        <span className="text-gray-400">·</span>
        <span className="font-mono text-gray-600 dark:text-gray-300">{trackedRef ?? 'HEAD'}</span>
        <button
          type="button"
          onClick={handleExpand}
          aria-label="Change repository binding"
          className="ml-auto px-2.5 py-1 text-xs rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
        >
          Change
        </button>
      </section>
    );
  }

  const chips = suggestedRefs
    ? [...new Map(suggestedRefs.map((s) => [s.ref, s])).values()].slice(0, MAX_SUGGESTED_REFS)
    : [];

  return (
    <section className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-semibold text-gray-900 dark:text-white">
            <GitBranch size={17} className="text-violet-500" />
            Repository
          </h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {bound ? (
              <>
                Bound to {bound.owner}/{bound.repo} · tracking{' '}
                <span className="font-mono">{trackedRef ?? 'HEAD'}</span>. Intent Trace reads it at
                a pinned commit.
              </>
            ) : (
              'Bind the GitHub repository so Intent Trace can check what is implemented. Read-only.'
            )}
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
          onChange={(e) => handleInputChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleValidate();
          }}
          placeholder="owner/repo or https://github.com/owner/repo"
          aria-label="Repository"
          className="flex-1 min-w-56 px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
        />
        <input
          value={ref}
          onChange={(e) => handleRefChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleValidate();
          }}
          placeholder={
            defaultBranchHint ? `branch, tag, or sha (defaults to ${defaultBranchHint})` : 'branch, tag, or sha'
          }
          aria-label="Branch or ref"
          className="w-72 px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
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
          disabled={validation.kind !== 'ok' || Boolean(validation.refError)}
          className="px-3 py-2 text-sm rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50"
        >
          Save
        </button>
      </div>

      {chips.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
          <span>Use:</span>
          {chips.map((chip) => (
            <button
              key={chip.ref}
              type="button"
              onClick={() => handleRefChange(chip.ref)}
              className="px-2 py-0.5 rounded-md border border-gray-200 dark:border-gray-700 font-mono text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              {chip.label ?? chip.ref}
            </button>
          ))}
        </div>
      )}

      {validation.kind === 'ok' && (
        <div className="mt-3 space-y-1 text-xs">
          <div className="inline-flex flex-wrap items-center gap-1 text-green-600 dark:text-green-400">
            <CheckCircle size={12} /> {validation.owner}/{validation.repo} —{' '}
            {validation.ref && validation.refSha ? (
              <>
                tracking <span className="font-mono">{validation.ref}</span> @{' '}
                <span className="font-mono">{validation.refSha.slice(0, 7)}</span>
                <span className="text-gray-400 dark:text-gray-500">
                  · default branch <span className="font-mono">{validation.info.defaultBranch}</span>
                </span>
              </>
            ) : (
              <>
                tracking default branch{' '}
                <span className="font-mono">{validation.info.defaultBranch}</span>
              </>
            )}
            <span className="text-gray-400 dark:text-gray-500">
              · {validation.info.isPrivate ? 'private' : 'public'}
            </span>
          </div>
          {validation.refError && (
            <div className="flex items-start gap-1 text-amber-600 dark:text-amber-400">
              <CircleAlert size={12} className="mt-0.5 shrink-0" />
              <span>
                {validation.refError} Fix or clear the branch — the binding is not saved with a ref
                that does not exist.
              </span>
            </div>
          )}
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

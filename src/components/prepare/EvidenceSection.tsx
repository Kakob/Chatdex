// Change Workspace — Evidence section (SPEC-change-workspace §9, §14; CW-1).
// Deterministic repository search over the LOCAL-ONLY file cache: index the
// bound repository at a pinned sha, grep / find symbol / find references,
// and add exact lines as `code` evidence. No LLM call happens here (§13
// Guided mode); GitHub is read through the hardened client only (§2.5).

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Database, ExternalLink, FileCode2, Loader2, Plus, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import { getGitHubToken } from '../../lib/github/credentials';
import { blobUrl, resolveRef, GitHubError } from '../../lib/github/client';
import { createGitHubSource } from '../../lib/repo/githubSource';
import { describeSkips, ensureIndexed, type IndexReport } from '../../lib/repo/index';
import {
  buildCodeEvidence,
  findReferences,
  findSymbol,
  grep,
  type SearchHit,
  type SearchResult,
} from '../../lib/repo/search';
import { parseRepoKey } from '../../lib/repo/sources';
import { countRepoFiles, listRepoFiles } from '../../lib/db/repoFiles';
import { addEvidenceItems } from '../../lib/prepare/lifecycle';
import { canAppend } from '../../lib/prepare/editability';
import { generateId } from '../../lib/utils/ids';
import { useToastStore } from '../../stores/toastStore';
import { usePrepareWorkspaceStore } from '../../stores/prepareWorkspaceStore';
import { recordInspection } from '../../lib/db/inspections';
import { GuidedActionMenu } from './GuidedActionMenu';
import type { PreparedChange } from '../../types/preparedChange';
import type { UnderstandingProject } from '../../types/understanding';
import type { EvidenceItem } from '../../types/evidence';
import type { RepoFileRow } from '../../types/repo';

type Mode = 'grep' | 'symbol' | 'references';

interface Props {
  change: PreparedChange;
  project: UnderstandingProject;
  onChanged: (change: PreparedChange) => Promise<void>;
}

export function EvidenceSection({ change, project, onChanged }: Props) {
  const addToast = useToastStore((s) => s.addToast);
  const repository = project.repository;
  const repoKey = repository ? `gh:${repository.owner}/${repository.repo}` : null;
  const appendable = canAppend(change, 'evidence');

  const [token, setToken] = useState<string | undefined>();
  const [sha, setSha] = useState<string | null>(null);
  const [shaError, setShaError] = useState<string | null>(null);
  const [cacheCount, setCacheCount] = useState<number>(0);
  const [confirmIndex, setConfirmIndex] = useState(false);
  const [indexing, setIndexing] = useState<{ done: number; total: number } | null>(null);
  const [report, setReport] = useState<IndexReport | null>(null);

  const [mode, setMode] = useState<Mode>('grep');
  const [query, setQuery] = useState('');
  const [regex, setRegex] = useState(false);
  const [pathGlob, setPathGlob] = useState('');
  const [rows, setRows] = useState<RepoFileRow[] | null>(null);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [manual, setManual] = useState({ path: '', start: '', end: '' });
  const pendingSearch = usePrepareWorkspaceStore((s) => s.pendingSearch);
  const consumeSearch = usePrepareWorkspaceStore((s) => s.consumeSearch);

  // Resolve the pinned sha + cache count for the banner.
  const refreshCache = useCallback(async (currentSha: string | null) => {
    if (!repoKey || !currentSha) return setCacheCount(0);
    setCacheCount(await countRepoFiles(repoKey, currentSha));
  }, [repoKey]);

  useEffect(() => {
    let cancelled = false;
    void getGitHubToken().then((t) => !cancelled && setToken(t));
    if (!repository) return;
    const ref = repository.pinnedRef ?? repository.defaultBranch ?? 'HEAD';
    setShaError(null);
    getGitHubToken()
      .then((t) => resolveRef(repository.owner, repository.repo, ref, { token: t }))
      .then(async ({ sha: resolved }) => {
        if (cancelled) return;
        setSha(resolved);
        await refreshCache(resolved);
      })
      .catch((err) => {
        if (cancelled) return;
        setShaError(err instanceof GitHubError ? `GitHub ${err.status}` : err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [repository, refreshCache]);

  const runIndex = async () => {
    if (!repository || !sha) return;
    setConfirmIndex(false);
    setIndexing({ done: 0, total: 0 });
    try {
      const source = createGitHubSource(repository.owner, repository.repo, { token });
      const next = await ensureIndexed(source, sha, { onProgress: (p) => setIndexing(p) });
      setReport(next);
      setRows(null);
      await refreshCache(sha);
      if (next.rateLimitedUntil) {
        addToast(`GitHub rate limit reached — ${next.fetched} files cached; retry after ${next.rateLimitedUntil.toLocaleTimeString()}`, 'error');
      } else {
        addToast(`Indexed ${next.indexed} files at ${sha.slice(0, 7)}`);
      }
    } catch (err) {
      addToast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setIndexing(null);
    }
  };

  const loadRows = async (): Promise<RepoFileRow[]> => {
    if (rows) return rows;
    if (!repoKey || !sha) return [];
    const loaded = await listRepoFiles(repoKey, sha);
    setRows(loaded);
    return loaded;
  };

  const runSearch = async () => {
    setSearchError(null);
    const q = query.trim();
    if (!q) return setResult(null);
    try {
      const files = await loadRows();
      const opts = { pathGlob: pathGlob.trim() || undefined };
      const next =
        mode === 'grep'
          ? grep(files, q, { ...opts, regex })
          : mode === 'symbol'
            ? findSymbol(files, q, opts)
            : findReferences(files, q, opts);
      setResult(next);
    } catch (err) {
      setResult(null);
      setSearchError(err instanceof Error ? err.message : String(err));
    }
  };

  const addRange = async (path: string, startLine: number, endLine: number, addedVia: 'search' | 'manual') => {
    const files = await loadRows();
    const row = files.find((r) => r.path === path);
    if (!row) throw new Error(`${path} is not in the cache — index the repository first`);
    const { item, redactions, truncated } = await buildCodeEvidence(row, startLine, endLine, {
      id: generateId(),
      addedVia,
    });
    const updated = await addEvidenceItems(change.id, [item]);
    await onChanged(updated);
    const notes = [
      redactions > 0 ? `${redactions} secret-shaped string${redactions === 1 ? '' : 's'} redacted` : null,
      truncated ? 'quote truncated to 500 characters' : null,
    ].filter(Boolean);
    addToast(`Added ${path}:${item.startLine}–${item.endLine}${notes.length ? ` (${notes.join('; ')})` : ''}`);
  };

  const addHit = async (hit: SearchHit) => {
    const key = `${hit.path}:${hit.line}`;
    setAdding(key);
    try {
      await addRange(hit.path, hit.line - hit.before.length, hit.line + hit.after.length, 'search');
    } catch (err) {
      addToast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setAdding(null);
    }
  };

  const addManual = async () => {
    const start = Number(manual.start);
    const end = Number(manual.end || manual.start);
    if (!manual.path.trim() || !Number.isInteger(start) || start < 1 || !Number.isInteger(end)) {
      return addToast('Enter a cached path and a 1-based line range', 'error');
    }
    setAdding('manual');
    try {
      await addRange(manual.path.trim(), start, end, 'manual');
      setManual({ path: '', start: '', end: '' });
    } catch (err) {
      addToast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setAdding(null);
    }
  };

  // A Guided action elsewhere on the page (a trace node, a file) hands us a search.
  useEffect(() => {
    if (!pendingSearch || !repoKey || !sha) return;
    setMode(pendingSearch.mode);
    setQuery(pendingSearch.query);
    setPathGlob(pendingSearch.pathGlob ?? '');
    setRegex(false);
    consumeSearch();
    const run = async () => {
      try {
        const files = await loadRows();
        const opts = { pathGlob: pendingSearch.pathGlob || undefined };
        setResult(
          pendingSearch.mode === 'grep'
            ? grep(files, pendingSearch.query, opts)
            : pendingSearch.mode === 'symbol'
              ? findSymbol(files, pendingSearch.query, opts)
              : findReferences(files, pendingSearch.query, opts)
        );
        setSearchError(null);
        document.getElementById('ws-evidence')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (err) {
        setSearchError(err instanceof Error ? err.message : String(err));
      }
    };
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingSearch?.nonce, repoKey, sha]);

  const evidence = change.evidence ?? [];

  return (
    <section className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
      <div className="flex flex-wrap items-center gap-3 px-5 py-4 border-b border-gray-100 dark:border-gray-800">
        <FileCode2 size={16} className="text-violet-600 dark:text-violet-400" />
        <h2 className="font-semibold text-gray-900 dark:text-white">Evidence</h2>
        <span className="text-xs text-gray-400">
          {evidence.length} item{evidence.length === 1 ? '' : 's'} · Guided: search is deterministic, no LLM call
        </span>
      </div>

      <div className="p-5 space-y-5">
        {!repository ? (
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Bind a GitHub repository to this project to search its code.{' '}
            <Link to={`/projects/${project.id}/intents`} className="text-violet-600 dark:text-violet-400 underline">
              Bind repository
            </Link>
          </p>
        ) : (
          <IndexBanner
            label={`${repository.owner}/${repository.repo}`}
            sha={sha}
            shaError={shaError}
            cacheCount={cacheCount}
            indexing={indexing}
            report={report}
            confirming={confirmIndex}
            onRequestIndex={() => (cacheCount > 0 ? void runIndex() : setConfirmIndex(true))}
            onConfirm={() => void runIndex()}
            onCancel={() => setConfirmIndex(false)}
          />
        )}

        {repository && sha && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden text-xs">
                {(['grep', 'symbol', 'references'] as Mode[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMode(m)}
                    className={`px-3 py-1.5 ${mode === m ? 'bg-violet-600 text-white' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'}`}
                  >
                    {m === 'grep' ? 'Search text' : m === 'symbol' ? 'Find symbol' : 'Find references'}
                  </button>
                ))}
              </div>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void runSearch()}
                placeholder={mode === 'grep' ? 'text or /regex/' : 'identifier, e.g. handleResultClick'}
                aria-label="Repository search"
                className="flex-1 min-w-56 px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100"
              />
              <input
                value={pathGlob}
                onChange={(e) => setPathGlob(e.target.value)}
                placeholder="path glob (src/**/*.tsx)"
                aria-label="Path glob"
                className="w-48 px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100"
              />
              {mode === 'grep' && (
                <label className="inline-flex items-center gap-1 text-xs text-gray-600 dark:text-gray-400">
                  <input type="checkbox" checked={regex} onChange={(e) => setRegex(e.target.checked)} /> regex
                </label>
              )}
              <button
                type="button"
                onClick={() => void runSearch()}
                disabled={cacheCount === 0}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 disabled:opacity-50"
              >
                <Search size={14} /> Search
              </button>
            </div>
            {searchError && <p className="text-xs text-amber-700 dark:text-amber-300">{searchError}</p>}
            {result && (
              <SearchResults
                result={result}
                repository={repository}
                adding={adding}
                appendable={appendable}
                onAdd={(hit) => void addHit(hit)}
                projectId={project.id}
                workspaceId={change.id}
                onOpen={(path) => void recordInspection({ projectId: project.id, workspaceId: change.id, kind: 'file', targetKey: path })}
              />
            )}
            {appendable && cacheCount > 0 && (
              <div className="flex flex-wrap items-end gap-2 rounded-lg bg-gray-50 dark:bg-gray-950 p-3">
                <span className="text-xs text-gray-500 dark:text-gray-400 w-full">Add exact lines from a cached file</span>
                <input value={manual.path} onChange={(e) => setManual({ ...manual, path: e.target.value })} placeholder="src/pages/SearchPage.tsx" aria-label="Path" className="flex-1 min-w-48 px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100" />
                <input value={manual.start} onChange={(e) => setManual({ ...manual, start: e.target.value })} placeholder="from" aria-label="Start line" className="w-20 px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100" />
                <input value={manual.end} onChange={(e) => setManual({ ...manual, end: e.target.value })} placeholder="to" aria-label="End line" className="w-20 px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100" />
                <button type="button" onClick={() => void addManual()} disabled={adding === 'manual'} className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200">
                  <Plus size={14} /> Add
                </button>
              </div>
            )}
          </div>
        )}

        <EvidenceList items={evidence} />
      </div>
    </section>
  );
}

function IndexBanner({
  label, sha, shaError, cacheCount, indexing, report, confirming, onRequestIndex, onConfirm, onCancel,
}: {
  label: string;
  sha: string | null;
  shaError: string | null;
  cacheCount: number;
  indexing: { done: number; total: number } | null;
  report: IndexReport | null;
  confirming: boolean;
  onRequestIndex: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const skips = report ? describeSkips(report.skipped) : '';
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-3 text-sm space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <Database size={14} className="text-gray-400" />
        <span className="font-medium text-gray-900 dark:text-white">{label}</span>
        {sha ? (
          <span className="text-xs text-gray-500 dark:text-gray-400">
            at <code>{sha.slice(0, 7)}</code> · {cacheCount} file{cacheCount === 1 ? '' : 's'} cached on this device
          </span>
        ) : shaError ? (
          <span className="text-xs text-amber-700 dark:text-amber-300">could not resolve the commit ({shaError})</span>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs text-gray-400"><Loader2 size={12} className="animate-spin" /> resolving commit…</span>
        )}
        <div className="ml-auto">
          {indexing ? (
            <span className="inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
              <Loader2 size={12} className="animate-spin" /> {indexing.total ? `${indexing.done}/${indexing.total}` : 'listing files…'}
            </span>
          ) : (
            <button
              type="button"
              onClick={onRequestIndex}
              disabled={!sha || confirming}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 disabled:opacity-50"
            >
              <RefreshCw size={12} /> {cacheCount > 0 ? 'Re-index' : 'Index repository'}
            </button>
          )}
        </div>
      </div>
      {confirming && (
        <div className="rounded-lg bg-violet-50 dark:bg-violet-900/20 p-3 text-xs text-gray-700 dark:text-gray-300 space-y-2">
          <p className="flex items-start gap-2">
            <ShieldCheck size={14} className="mt-0.5 shrink-0 text-violet-600 dark:text-violet-400" />
            <span>
              Chatdex stores a read-only copy of these files <strong>on this device</strong> so search runs locally and offline.
              Nothing is uploaded, synced, or sent to an LLM. Sensitive paths (.env, keys, credentials) and generated
              directories are never fetched; files over 200 KB are skipped. Clear the cache any time in Settings → GitHub.
            </span>
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={onConfirm} className="px-3 py-1.5 rounded-lg bg-violet-600 text-white">Index on this device</button>
            <button type="button" onClick={onCancel} className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700">Cancel</button>
          </div>
        </div>
      )}
      {report && (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Last run: {report.fetched} fetched, {report.alreadyCached} already cached
          {skips ? ` · skipped ${skips}` : ''}
          {report.truncated ? ' · tree was truncated by GitHub' : ''}
          {report.stopped ? ' · stopped' : ''}
        </p>
      )}
    </div>
  );
}

function SearchResults({
  result, repository, adding, appendable, onAdd, projectId, workspaceId, onOpen,
}: {
  result: SearchResult;
  repository: { owner: string; repo: string };
  adding: string | null;
  appendable: boolean;
  onAdd: (hit: SearchHit) => void;
  projectId: string;
  workspaceId: string;
  onOpen: (path: string) => void;
}) {
  const grouped = useMemo(() => {
    const byPath = new Map<string, SearchHit[]>();
    for (const hit of result.hits) byPath.set(hit.path, [...(byPath.get(hit.path) ?? []), hit]);
    return [...byPath.entries()];
  }, [result]);

  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-500 dark:text-gray-400">
        {result.hits.length} hit{result.hits.length === 1 ? '' : 's'} in {grouped.length} file{grouped.length === 1 ? '' : 's'} ({result.filesScanned} scanned)
        {result.capped ? ' · capped — narrow the search' : ''}
        {result.timedOut.length ? ` · ${result.timedOut.length} file(s) skipped for time` : ''}
      </p>
      <div className="max-h-[28rem] overflow-auto rounded-lg border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
        {grouped.map(([path, hits]) => (
          <div key={path} className="p-3">
            <div className="flex items-center gap-2 text-xs">
              <span className="font-mono text-gray-700 dark:text-gray-300">{path}</span>
              <span onClick={() => onOpen(path)}>
                <SafeBlobLink repository={repository} sha={hits[0].sha} path={path} />
              </span>
              <GuidedActionMenu projectId={projectId} workspaceId={workspaceId} repository={repository} path={path} sha={hits[0].sha} compact />
            </div>
            <ul className="mt-2 space-y-2">
              {hits.map((hit) => {
                const key = `${hit.path}:${hit.line}`;
                return (
                  <li key={key} className="flex gap-3">
                    <pre className="flex-1 overflow-x-auto rounded bg-gray-50 dark:bg-gray-950 p-2 text-[11px] leading-4 text-gray-700 dark:text-gray-300">
                      {hit.before.map((l, i) => <div key={`b${i}`} className="opacity-60">{`${hit.line - hit.before.length + i}  ${l}`}</div>)}
                      <div className="font-semibold text-gray-900 dark:text-white">{`${hit.line}  ${hit.text}`}</div>
                      {hit.after.map((l, i) => <div key={`a${i}`} className="opacity-60">{`${hit.line + 1 + i}  ${l}`}</div>)}
                    </pre>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      {hit.declaration && <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300">declaration</span>}
                      {appendable && (
                        <button type="button" onClick={() => onAdd(hit)} disabled={adding === key} className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 disabled:opacity-50">
                          {adding === key ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} Add as evidence
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

function SafeBlobLink({ repository, sha, path, startLine, endLine }: { repository: { owner: string; repo: string }; sha: string; path: string; startLine?: number; endLine?: number }) {
  let href: string | null = null;
  try {
    href = blobUrl(repository.owner, repository.repo, sha, path, startLine, endLine);
  } catch {
    href = null;
  }
  if (!href) return null;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-violet-600 dark:text-violet-400" title="Open on GitHub at this commit">
      <ExternalLink size={12} />
    </a>
  );
}

const KIND_LABEL: Record<EvidenceItem['kind'], string> = {
  code: 'Code',
  test_runtime: 'Test / runtime',
  intent_history: 'Intent / history',
  human_hypothesis: 'Hypothesis',
  ai_inference: 'AI inference',
};

export function EvidenceList({ items }: { items: EvidenceItem[] }) {
  if (items.length === 0) {
    return <p className="text-xs text-gray-400">No evidence yet. Search the repository and add the exact lines that support a claim.</p>;
  }
  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={item.id} className="rounded-lg border border-gray-200 dark:border-gray-800 p-3 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`px-1.5 py-0.5 rounded ${item.kind === 'ai_inference' ? 'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300'}`}>
              {KIND_LABEL[item.kind]}
            </span>
            {item.kind === 'code' && (
              <>
                <span className="font-mono text-gray-700 dark:text-gray-300">
                  {item.path}:{item.startLine}{item.endLine > item.startLine ? `–${item.endLine}` : ''}
                </span>
                <CodeLink item={item} />
              </>
            )}
            <span className="ml-auto text-gray-400">{item.origin === 'ai' ? 'AI' : 'you'} · {item.addedVia}</span>
          </div>
          {item.kind === 'code' && (
            <pre className="mt-2 overflow-x-auto rounded bg-gray-50 dark:bg-gray-950 p-2 text-[11px] leading-4 text-gray-700 dark:text-gray-300 whitespace-pre">{item.quote}</pre>
          )}
          {item.kind === 'ai_inference' && <p className="mt-1 text-gray-600 dark:text-gray-400">{item.text}</p>}
          {item.note && <p className="mt-1 text-gray-500 dark:text-gray-400">{item.note}</p>}
        </li>
      ))}
    </ul>
  );
}

function CodeLink({ item }: { item: Extract<EvidenceItem, { kind: 'code' }> }) {
  const parsed = parseRepoKey(item.repoKey);
  if (!parsed || parsed.kind !== 'gh') return null;
  return <SafeBlobLink repository={{ owner: parsed.owner, repo: parsed.repo }} sha={item.sha} path={item.path} startLine={item.startLine} endLine={item.endLine} />;
}

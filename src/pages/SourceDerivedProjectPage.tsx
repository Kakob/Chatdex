/**
 * Real, project-bound structural model from repository source.
 * This view is deliberately separate from authored Landscape concepts.
 * No fixtures, model mutation, LLM calls, source writes or inferred behavior.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, BookOpen, FileCode2, GitBranch, Network, RefreshCw } from 'lucide-react';
import { getUnderstandingProject } from '../lib/db/understanding';
import { analyzeBoundProject, type BoundSourceAnalysisResult, type SourceAnalysisProgress } from '../lib/engineering/core/fromRepository';
import { analyzeBundledExample, type BundledSourceAnalysisResult } from '../lib/engineering/core/fromBundled';
import { engineeringExampleKind } from '../lib/engineering/demoProjects';
import { SourceGraphCanvas } from '../components/engineering/SourceGraphCanvas';
import { OperationExplorer } from '../components/engineering/OperationExplorer';
import { sourceOperations } from '../lib/engineering/core/operationLens';
import {
  restoreSourceAnalysis, saveSourceAnalysis, saveSourceSelection,
  forgetSourceAnalysis,
} from '../lib/engineering/core/sourceAnalysisCache';

type AnalyzedProjectSource = BoundSourceAnalysisResult | BundledSourceAnalysisResult;
import type { SourceEntity } from '../lib/engineering/core/contracts';
import { button, muted, primaryButton } from '../components/engineering/ui';
import type { UnderstandingProject } from '../types/understanding';

function progressText(progress: SourceAnalysisProgress | null): string {
  if (!progress) return 'Preparing source analysis…';
  if (progress.phase === 'listing') return 'Listing repository files at a pinned commit…';
  if (progress.phase === 'indexing') return 'Caching selected source: ' + progress.progress.done + '/' + progress.progress.total;
  return 'Constructing the deterministic TypeScript model…';
}

function SourceModelResult({ result, scope, projectId, initialSelectedId }: {
  result: AnalyzedProjectSource;
  scope: string;
  projectId: string;
  initialSelectedId: string | null;
}) {
  const { graph, coverage } = result;
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    if (initialSelectedId && graph.entities.some((item) => item.id === initialSelectedId)) {
      return initialSelectedId;
    }
    return sourceOperations(graph)[0]?.entity.id ?? null;
  });
  const [showRawGraph, setShowRawGraph] = useState(false);
  const selectEntity = (entityId: string) => {
    setSelectedId(entityId);
    setFullSource(false);
    void saveSourceSelection(projectId, entityId).catch(() => {
      // Selection is still usable even if the browser declines persistence.
    });
  };
  const [filter, setFilter] = useState('');
  const [fullSource, setFullSource] = useState(false);

  const entitiesById = useMemo(() => new Map(graph.entities.map((entity) => [entity.id, entity])), [graph]);
  const children = useMemo(() => {
    const groups = new Map<string, SourceEntity[]>();
    for (const entity of graph.entities) {
      if (entity.parentId === null) continue;
      const items = groups.get(entity.parentId) ?? [];
      items.push(entity);
      groups.set(entity.parentId, items);
    }
    for (const group of groups.values()) group.sort((a, b) => a.location.startOffset - b.location.startOffset || a.id.localeCompare(b.id));
    return groups;
  }, [graph]);
  const modules = graph.entities.filter((entity) => entity.kind === 'module').sort((a, b) => {
    const isTest = (path: string) => /(?:\.test\.|\.spec\.|\/__tests__\/|\/tests?\/)/.test(path);
    return Number(isTest(a.path)) - Number(isTest(b.path)) || a.path.localeCompare(b.path);
  });
  const selected = selectedId ? entitiesById.get(selectedId) : undefined;
  const active = selected ?? modules[0] ?? null;
  const source = active ? result.sourceFiles.find((file) => file.path === active.path) : undefined;
  const codeLines = source?.text.split('\n') ?? [];
  const from = fullSource || !active ? 0 : Math.max(0, active.location.startLine - 4);
  const to = fullSource || !active ? codeLines.length : Math.min(codeLines.length, active.location.endLine + 6, from + 100);
  const visible = codeLines.slice(from, to);
  const linked = active
    ? graph.relations.filter((relation) => relation.fromId === active.id || relation.toId === active.id).slice(0, 35)
    : [];

  const showEntity = (entity: SourceEntity, depth: number): ReactNode => (
    <div key={entity.id}>
      <button type="button" aria-label={entity.kind + " " + entity.name} onClick={() => { selectEntity(entity.id); }}
        aria-pressed={entity.id === active?.id}
        className={'flex min-h-9 w-full items-center gap-1 rounded-md px-2 py-1 text-left text-xs ' +
          (entity.id === active?.id ? 'bg-violet-100 font-semibold text-violet-800 dark:bg-violet-900/50 dark:text-violet-100' : 'hover:bg-gray-100 dark:hover:bg-gray-800')}
        style={{ paddingLeft: Math.min(8 + depth * 12, 72) }}>
        <span className={'shrink-0 text-[10px] ' + muted}>{entity.kind}</span>
        <span className="min-w-0 truncate">{entity.name}</span>
      </button>
      {(children.get(entity.id) ?? []).map((child) => showEntity(child, depth + 1))}
    </div>
  );

  return (
    <div className="space-y-3" aria-label="Generated source model">
      <section className="rounded-xl border border-gray-200 bg-white p-3 text-xs dark:border-gray-700 dark:bg-gray-900">
        <p className="font-semibold">Source-derived · read-only · {graph.entities.length} entities · {graph.relations.length} relationships</p>
        <p className={'mt-1 break-all ' + muted}>{'repository' in result
          ? `${result.repository.owner}/${result.repository.repo} · ${result.repository.ref} · ${result.repository.sha}`
          : `${result.bundled.label} · shipped source snapshot (not Git-pinned)`}</p>
        <p className={'mt-1 ' + muted}>
          Scope: {scope || ('repository' in result ? '(repository root)' : '(bundled example files)')} · Analyzed {coverage.analyzedCount} of {coverage.candidateCount} TypeScript files in scope
        </p>
        {coverage.partial && (
          <p role="alert" className="mt-2 rounded-md border border-amber-300 p-2 text-amber-800 dark:text-amber-200">
            Partial model: {coverage.excludedForLimit} files beyond the {coverage.selectedCount}-file selection,
            {' '}{coverage.deniedCount} excluded by source policy,
            {' '}{coverage.skipped.length} skipped during indexing or analysis
            {coverage.treeTruncated ? ', and the repository tree was truncated' : ''}.
            {'repository' in result ? 'Narrow the folder scope to analyze a particular subsystem.' : 'The bundled example is incomplete.'} Missing relationships may reflect incomplete input.
          </p>
        )}
        <details className={'mt-2 ' + muted}>
          <summary className="cursor-pointer text-[11px]">About this model and its limits</summary>
          <p className="mt-1">Compiler-derived structure is not a software concept or behavioral verification. No source files were modified or sent to an LLM.</p>
        </details>
      </section>

      {graph.entities.length === 0 ? (
        <p className={'rounded-lg border p-4 text-sm ' + muted}>No supported TypeScript entities were found in this selection. Try a different folder scope.</p>
      ) : (
        <>
          <OperationExplorer graph={graph} sourceFiles={result.sourceFiles}
            selectedId={active?.id ?? null} onSelect={selectEntity}/>
          <details className="rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-900">
            <summary className="cursor-pointer text-sm font-medium">
              Raw source relationship map (advanced)
            </summary>
            <p className={'my-2 text-xs ' + muted}>
              The complete structural graph is noisy and isn't a model of runtime behavior.
              Use this to inspect individual low-level edges.
            </p>
            {showRawGraph ? <SourceGraphCanvas graph={graph} selectedId={active?.id ?? null}
              onSelect={selectEntity}/> : (
              <button type="button" className={button} onClick={() => setShowRawGraph(true)}>
                Show raw graph
              </button>
            )}
          </details>
          <div className="grid gap-3 lg:grid-cols-[minmax(0,.9fr)_minmax(0,1.1fr)]">
          <section aria-label="Derived source structure" className="order-2 min-w-0 rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-900 lg:order-1">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
              <Network size={16}/> Source list (alternative view)
            </div>
            <input aria-label="Filter source entities" value={filter} onChange={(event) => setFilter(event.target.value)}
              placeholder="Find a function, type, file…" className="mb-2 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"/>
            <div className="max-h-[38dvh] min-h-28 space-y-1 overflow-y-auto rounded-lg border border-gray-100 dark:border-gray-800 lg:max-h-[68dvh]">
              {filter.trim() ? (
                graph.entities.filter((entity) => entity.name.toLowerCase().includes(filter.trim().toLowerCase()) ||
                  entity.path.toLowerCase().includes(filter.trim().toLowerCase()))
                  .slice(0, 120).map((entity) => (
                    <button type="button" key={entity.id} aria-label={entity.kind + " " + entity.name} onClick={() => { selectEntity(entity.id); }}
                      className={'block w-full rounded-md p-2 text-left text-xs hover:bg-gray-100 dark:hover:bg-gray-800 ' +
                        (entity.id === active?.id ? 'bg-violet-100 dark:bg-violet-900/40' : '')}>
                      <span className="font-medium">{entity.name}</span>
                      <span className={'ml-2 ' + muted}>{entity.kind} · {entity.path}</span>
                    </button>
                  ))
              ) : (
                modules.map((module, index) => (
                  <details key={module.id} open={index === 0}
                    className="rounded-lg border border-gray-100 px-1 py-1 dark:border-gray-800">
                    <summary className="cursor-pointer break-all px-2 py-1 text-xs font-semibold">{module.path}</summary>
                    {showEntity(module, 0)}
                  </details>
                ))
              )}
            </div>
            <p className={'mt-2 text-[11px] ' + muted}>Select a source entity. Files and symbols come from actual analyzed source text, not an authored model.</p>
          </section>

          <section aria-label="Derived source inspector" className="order-1 min-w-0 space-y-3 rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-900 lg:order-2">
            {active && (
              <>
                <div className="flex items-center gap-2">
                  <FileCode2 size={17}/>
                  <div className="min-w-0">
                    <h2 className="text-base font-semibold">{active.name}</h2>
                    <p className={'break-all text-xs ' + muted}>{active.kind} · {active.path}:{active.location.startLine}</p>
                  </div>
                </div>
                <p className={'break-all text-xs ' + muted}>Signature: {active.signature.slice(0, 240) || '(none)'}</p>
                <div className="overflow-x-hidden rounded-lg bg-gray-950 text-gray-100" aria-label="Analyzed source text">
                  <pre className="max-h-[52dvh] overflow-y-auto whitespace-pre-wrap break-words p-3 font-mono text-[11px] leading-5">
                    {visible.map((line, index) => (
                      <span className="block" key={from + index}>
                        <span className="select-none text-gray-500">{String(from + index + 1).padStart(4, ' ')} </span>
                        <span className={active.location.startLine === from + index + 1 ? 'bg-violet-900/60' : ''}>{line || ' '}</span>
                      </span>
                    ))}
                  </pre>
                </div>
                <button type="button" className={button} onClick={() => setFullSource((value) => !value)}>
                  {fullSource ? 'Show selected excerpt' : 'Read full file'}
                </button>
                <div className="space-y-1">
                  <h3 className="text-xs font-semibold">Resolved relationships ({linked.length}{graph.relations.filter((r) => r.fromId === active.id || r.toId === active.id).length > linked.length ? '+' : ''})</h3>
                  {linked.length === 0 ? <p className={'text-xs ' + muted}>No analyzer-supported relationships in this selection.</p> :
                    linked.map((relation) => {
                      const otherId = relation.fromId === active.id ? relation.toId : relation.fromId;
                      const other = entitiesById.get(otherId);
                      return <button type="button" key={relation.id} onClick={() => { selectEntity(otherId); }}
                        className="block w-full rounded-md border border-gray-200 px-2 py-1.5 text-left text-xs dark:border-gray-700">
                        {relation.fromId === active.id ? '→ ' : '← '}{relation.kind} · {other?.name ?? otherId}
                        <span className={'ml-1 ' + muted}>{other?.path ?? ''}</span>
                      </button>;
                    })}
                </div>
              </>
            )}
          </section>
          </div>
        </>
      )}

      {graph.diagnostics.length > 0 && (
        <details className="rounded-xl border border-gray-200 bg-white p-3 text-xs dark:border-gray-700 dark:bg-gray-900">
          <summary className="cursor-pointer font-semibold">Analyzer diagnostics ({graph.diagnostics.length})</summary>
          <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">
            {graph.diagnostics.slice(0, 80).map((d, i) => (
              <li key={i} className="break-all">{d.kind}: {d.path}{d.line ? ':' + d.line : ''} — {d.message}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

export function SourceDerivedProjectPage() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<UnderstandingProject | null>(null);
  const [loadingProject, setLoadingProject] = useState(true);
  const [prefix, setPrefix] = useState('');
  const [progress, setProgress] = useState<SourceAnalysisProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    projectId: string;
    scope: string;
    data: AnalyzedProjectSource;
    selectedId: string | null;
    savedAt: number;
  } | null>(null);
  const [cacheWarning, setCacheWarning] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadingProject(true);
    setProject(null);
    setResult(null);
    setRestored(false);
    setCacheWarning(null);
    if (id) {
      void (async () => {
        try {
          const p = await getUnderstandingProject(id);
          if (cancelled) return;
          setProject(p ?? null);
          if (p) {
            const saved = await restoreSourceAnalysis(p);
            if (cancelled) return;
            if (saved) {
              setResult(saved);
              setPrefix(saved.scope);
              setRestored(true);
            }
          }
        } catch (reason) {
          if (!cancelled) {
            setError(reason instanceof Error ? reason.message : String(reason));
          }
        } finally {
          if (!cancelled) setLoadingProject(false);
        }
      })();
    } else {
      setLoadingProject(false);
    }
    return () => { cancelled = true; };
  }, [id]);

  async function runAnalysis() {
    if (!project || busy) return;
    setBusy(true);
    setError(null);
    setCacheWarning(null);
    try {
      const example = engineeringExampleKind(project.id);
      const data = project.repository
        ? await analyzeBoundProject(project, { prefix, onProgress: setProgress })
        : example
          ? await analyzeBundledExample(example)
          : null;
      if (!data) throw new Error('No repository or bundled source is available for this project.');
      const saved = {
        projectId: project.id,
        scope: project.repository ? prefix.trim() : '',
        data,
        selectedId: null,
        savedAt: Date.now(),
      };
      try {
        await saveSourceAnalysis(saved);
      } catch {
        setCacheWarning('This browser could not save the analysis locally. It may need to be rerun after a reload.');
      }
      setRestored(false);
      setResult(saved);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  const bundledKind = project ? engineeringExampleKind(project.id) : null;

  return (
    <main className="mx-auto max-w-7xl space-y-3 text-gray-900 dark:text-gray-100">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2"><BookOpen size={18}/><h1 className="text-lg font-semibold">Source-derived engineering model</h1></div>
          <p className={'mt-1 text-xs ' + muted}>Real TypeScript source · generic deterministic analyzer · read-only</p>
        </div>
        <Link to={id ? '/projects/' + id + '/engineering' : '/projects'} className={button}><ArrowLeft size={14}/> Existing engineering model</Link>
      </header>
      {loadingProject && <p className={'text-sm ' + muted}>Loading project binding…</p>}
      {!loadingProject && !project && <p role="alert" className="text-sm">Project not found.</p>}
      {project && !project.repository && !bundledKind && (
        <section className="rounded-lg border border-amber-300 p-4 text-sm">
          This project has no GitHub repository binding. <Link className="font-medium text-violet-700 underline dark:text-violet-300" to={'/projects/' + project.id}>Open project overview and bind a repository</Link> to analyze real source.
        </section>
      )}
      {project && (project.repository || bundledKind) && (
        <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-900"
          aria-label={project.repository ? 'Repository source analysis controls' : 'Bundled source analysis controls'}>
          {project.repository ? (
            <>
              <div className="flex items-center gap-2 text-sm font-medium">
                <GitBranch size={16}/> {project.repository.owner}/{project.repository.repo}
                <span className={'text-xs ' + muted}>· {project.repository.pinnedRef || project.repository.defaultBranch || 'default branch'}</span>
              </div>
              <label className="block space-y-1 text-xs font-medium">
                Folder or file to analyze (optional)
                <input aria-label="Source folder scope" value={prefix} onChange={(event) => setPrefix(event.target.value)}
                  placeholder="e.g. src/ or packages/core/" className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"/>
              </label>
              {!result && <p className={'text-xs leading-5 ' + muted}>
                Reads up to 40 supported TypeScript files and 3 MB from a pinned GitHub commit.
                Larger repositories need a narrower folder scope. Files are cached locally on this device only.
              </p>}
            </>
          ) : (
            <>
              <p className="flex items-center gap-2 text-sm font-medium"><FileCode2 size={16}/> Bundled {bundledKind === 'todo-list' ? 'Todo List' : 'Event Queue'} source</p>
              {!result && <p className={'text-xs leading-5 ' + muted}>
                Analyze the actual implementation and tests shipped with this Chatdex build, without a repository binding.
                This is a read-only build-time snapshot, not a live local working tree or a Git-pinned revision.
              </p>}
            </>
          )}
          <button type="button" disabled={busy} className={primaryButton} onClick={() => void runAnalysis()}>
            <RefreshCw size={15}/> {busy ? 'Analyzing…' : result ? 'Reanalyze source' : project.repository ? 'Analyze repository source' : 'Analyze bundled source'}
          </button>
          {busy && <p role="status" className={'text-xs ' + muted}>
            {project.repository ? progressText(progress) : 'Analyzing bundled source…'}
          </p>}
        </section>
      )}
      {error && <p role="alert" className="rounded-lg border border-red-400 p-3 text-sm text-red-700 dark:text-red-300">{error}</p>}
      {cacheWarning && <p role="alert" className="rounded-lg border border-amber-400 p-3 text-sm text-amber-700 dark:text-amber-300">{cacheWarning}</p>}
      {result && result.projectId === id && (
        <>
          <div className={'flex flex-wrap items-center justify-between gap-2 text-xs ' + muted}>
            <span>{restored ? 'Restored saved analysis' : 'Saved locally'} · {new Date(result.savedAt).toLocaleString()}
              {'repository' in result.data ? ' · at the recorded Git SHA (branch may have moved)' : ' · bundled build snapshot'}</span>
            <button type="button" className={button} onClick={() => {
              void forgetSourceAnalysis(result.projectId).then(() => {
                setResult(null);
                setRestored(false);
              }).catch(() => setCacheWarning('Could not clear the saved local analysis.'));
            }}>Forget saved analysis</button>
          </div>
          <SourceModelResult key={result.data.graph.snapshotFingerprint + ':' + result.scope}
            projectId={result.projectId} result={result.data} scope={result.scope}
            initialSelectedId={result.selectedId}/>
        </>
      )}
    </main>
  );
}

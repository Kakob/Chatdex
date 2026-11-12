/**
 * Fallback Explorer for ANY native Chatdex project with authored concepts.
 * There is no project-specific diagram, symbol table, or runtime adapter here.
 * Structure and links are projected solely from common model records.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, BookOpen, Boxes, GitBranch, Maximize2, Minimize2 } from 'lucide-react';
import { ModelInspector } from '../components/engineering/ModelInspector';
import { BoundSourceInspector } from '../components/engineering/BoundSourceInspector';
import { useEngineeringModel } from '../lib/engineering/useEngineeringModel';
import { projectGraph } from '../lib/engineering/modelGraph';
import { button, muted } from '../components/engineering/ui';

type Tab = 'understand' | 'code' | 'tests';

export function GenericEngineeringExplorerPage({ projectId, projectName }: { projectId: string; projectName: string }) {
  const { model, refresh, error } = useEngineeringModel(projectId);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('understand');
  const [readerExpanded, setReaderExpanded] = useState(false);

  if (error) return <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>;
  if (!model) return <p className="text-sm text-gray-500">Loading project engineering model…</p>;
  const graph = projectGraph(model);
  const activeId = selected && graph.nodes.some((node) => node.id === selected) ? selected : graph.nodes[0]?.id;
  const node = graph.nodes.find((entry) => entry.id === activeId);
  const name = node?.title ?? 'No modeled components';

  return (
    <div className="mx-auto flex h-[calc(100dvh-5.5rem)] min-h-[440px] max-w-7xl flex-col gap-3 overflow-hidden text-gray-900 dark:text-gray-100 sm:h-[calc(100dvh-6.5rem)]">
      <header className="flex shrink-0 items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2"><BookOpen size={17} className="shrink-0 text-violet-600" />
            <h1 className="truncate text-base font-semibold sm:text-xl">{projectName}</h1>
          </div>
          <p className={'text-[11px] ' + muted}>Generic engineering model · authored concepts and local source bindings</p>
        </div>
        <Link to={'/projects/' + projectId} className={button}><ArrowLeft size={14} /> Project</Link>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-3 lg:grid lg:grid-cols-[minmax(0,1.05fr)_minmax(370px,.95fr)]">
        <div className={(readerExpanded ? 'hidden lg:flex' : 'flex') + ' min-h-0 shrink-0 flex-col gap-2 lg:min-h-0 lg:shrink'}>
          <section className="min-h-[150px] shrink-0 overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900 lg:flex-1" aria-label="Generic engineering structure">
            <div className="flex items-center justify-between border-b border-gray-200 px-3 py-2 text-xs font-semibold dark:border-gray-700">
              <span className="inline-flex items-center gap-1"><Boxes size={15} /> System structure</span>
              <span className={muted}>{graph.nodes.length} entities · {graph.edges.length} relationships</span>
            </div>
            <div className="max-h-[clamp(130px,32dvh,310px)] space-y-1 overflow-y-auto px-2 py-2 lg:max-h-[56dvh]">
              {graph.nodes.length === 0 && (
                <p className={'p-2 text-xs ' + muted}>
                  No modeled components yet. Start by authoring concepts in the project's Understanding Landscape.
                  This Explorer will not invent code or engineering architecture.
                </p>
              )}
              {graph.nodes.map((entry) => (
                <button key={entry.id} type="button"
                  onClick={() => setSelected(entry.id)}
                  data-model-id={entry.id}
                  aria-pressed={entry.id === activeId}
                  className={'flex min-h-10 w-full items-center justify-between gap-2 rounded-lg border px-2 py-1.5 text-left text-xs ' +
                    (entry.id === activeId ? 'border-violet-500 bg-violet-50 dark:bg-violet-950/40' :
                      'border-gray-200 hover:border-violet-300 dark:border-gray-700') +
                    (entry.proposed ? ' border-dashed !border-amber-500' : '')}
                  style={{ paddingLeft: Math.min(4 + entry.depth * 12, 76) + 'px' }}>
                  <span className="min-w-0 truncate">
                    <span className="block truncate font-semibold">{entry.title}</span>
                    <span className={'block text-[10px] ' + muted}>{entry.kind}{entry.proposed ? ' · proposed only' : ''}</span>
                  </span>
                  {entry.children.length > 0 && <span className="shrink-0 font-mono text-[10px]">{entry.children.length}</span>}
                </button>
              ))}
            </div>
          </section>
          <section className="shrink-0 rounded-xl border border-gray-200 bg-gray-50 p-3 text-xs dark:border-gray-700 dark:bg-gray-900" aria-label="Model coverage">
            <p className="font-semibold"><GitBranch size={13} className="mr-1 inline" /> {graph.edges.length} typed relationships</p>
            <p className={'mt-1 leading-5 ' + muted}>
              This project does not have an executable engineering adapter. The general view navigates authored model structure and indexed code when bound.
              It does not claim to infer implementation details or execute the application.
            </p>
            {graph.danglingEdgeIds.length > 0 && <p role="alert" className="mt-1 text-amber-700 dark:text-amber-300">{graph.danglingEdgeIds.length} relationships have missing endpoints.</p>}
          </section>
        </div>

        <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900" aria-label="Generic engineering inspector">
          <div className="flex shrink-0 items-center justify-between gap-2 px-3 py-2">
            <div className="min-w-0"><p className={'text-[10px] uppercase tracking-wide ' + muted}>Selected engineering entity</p><h2 className="truncate font-semibold">{name}</h2></div>
            <button type="button" className="flex h-10 w-10 items-center justify-center rounded-lg border border-gray-300 dark:border-gray-700 lg:hidden" aria-label={readerExpanded ? 'Show structure' : 'Expand inspector'}
              onClick={() => setReaderExpanded(!readerExpanded)}>
              {readerExpanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>
          </div>
          <div role="tablist" aria-label="Generic inspection modes" className="flex shrink-0 border-b border-gray-200 dark:border-gray-700">
            {(['understand', 'code', 'tests'] as const).map((item) => (
              <button key={item} type="button" role="tab" aria-selected={tab === item} onClick={() => { setTab(item); if (item !== 'understand') setReaderExpanded(true); }}
                className={'min-h-11 flex-1 border-b-2 text-sm ' + (tab === item ? 'border-violet-600 font-semibold text-violet-700 dark:text-violet-300' : 'border-transparent text-gray-500')}>
                {item.charAt(0).toUpperCase() + item.slice(1)}
              </button>
            ))}
          </div>
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-3" key={activeId + ':' + tab} role="tabpanel">
            {!activeId && <p className={'text-xs ' + muted}>No selectable engineering entity.</p>}
            {activeId && tab === 'understand' && (
              <div className="space-y-3 text-sm">
                <p className="font-medium">{node?.currentTitle}</p>
                <p className="leading-6">{node?.description || 'No description authored for this concept.'}</p>
                <ModelInspector key={activeId} projectId={projectId} nodeId={activeId} model={model} onRefresh={refresh} />
                <nav aria-label="Related project workflows" className="flex flex-wrap gap-2 border-t border-gray-200 pt-3 text-xs dark:border-gray-700">
                  <Link className={button} to={'/projects/' + projectId + '/investigate'}>History</Link>
                  <Link className={button} to={'/projects/' + projectId + '/understanding'}>Understanding</Link>
                  <Link className={button} to={'/projects/' + projectId + '/prepare'}>Prepare Change</Link>
                </nav>
              </div>
            )}
            {activeId && tab === 'code' && <BoundSourceInspector model={model} targetId={activeId} role="implementation" title={name} onModelRefresh={refresh} />}
            {activeId && tab === 'tests' && <BoundSourceInspector model={model} targetId={activeId} role="test" title={name} />}
          </div>
        </section>
      </div>
    </div>
  );
}

/**
 * Interactive visualization of REAL, compiler-derived source entities and
 * their directed relationships. The graph/layout never introduces authored
 * demo entities or infers software behavior.
 *
 * Module grouping conveys source containment; edges are from DerivedGraph.
 * On narrow screens, the map scrolls in two directions and has explicit
 * zoom/fit controls. "Connections" traces one-hop neighbors without implying
 * an observed runtime execution path.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { GitBranch, Maximize2, Minus, Move, Network, Plus } from 'lucide-react';
import type { DerivedGraph, SourceRelationKind } from '../lib/engineering/core/contracts';
import {
  layoutSourceOverview, layoutSourceConnections, sourceEdgePath,
  type PositionedSourceGraph,
} from '../lib/engineering/core/graphLayout';

type ViewMode = 'map' | 'connections';
type RelationFilter = SourceRelationKind | 'all';

const RELATION_COLORS: Record<SourceRelationKind, string> = {
  contains: '#64748b',
  imports: '#38bdf8',
  exports: '#2dd4bf',
  calls: '#c084fc',
  references: '#fbbf24',
};
const RELATION_LABELS: Record<SourceRelationKind, string> = {
  contains: 'Contains',
  imports: 'Imports',
  exports: 'Exports',
  calls: 'Calls',
  references: 'References',
};
const KINDS: readonly SourceRelationKind[] = ['calls', 'references', 'imports', 'exports', 'contains'];

interface Props {
  graph: DerivedGraph;
  selectedId: string | null;
  onSelect: (entityId: string) => void;
}

function kindTone(kind: string): string {
  switch (kind) {
    case 'module': return 'border-sky-500/70 bg-sky-950/95 text-sky-100';
    case 'class': case 'interface': case 'type': case 'enum':
      return 'border-teal-500/65 bg-teal-950/95 text-teal-100';
    case 'function': case 'method': case 'constructor':
      return 'border-violet-500/65 bg-violet-950/95 text-violet-100';
    default: return 'border-slate-500/70 bg-slate-800/95 text-slate-100';
  }
}

function NodeMap({
  layout, graph, selectedId, onSelect, scale, showAll, filter,
  markerPrefix,
}: {
  layout: PositionedSourceGraph;
  graph: DerivedGraph;
  selectedId: string | null;
  onSelect: (entityId: string) => void;
  scale: number;
  showAll: boolean;
  filter: RelationFilter;
  markerPrefix: string;
}) {
  const positions = useMemo(() => new Map(layout.nodes.map((node) => [node.entity.id, node])), [layout]);
  const selectedEdges = layout.edges.filter((edge) =>
    (filter === 'all' || edge.kind === filter) &&
    (edge.fromId === selectedId || edge.toId === selectedId));
  const drawnEdges = layout.edges.filter((edge) =>
    (filter === 'all' || edge.kind === filter) &&
    (showAll || edge.fromId === selectedId || edge.toId === selectedId));
  const highlighted = new Set(selectedEdges.map((edge) => edge.id));
  const isRelated = new Set(selectedEdges.flatMap((edge) => [edge.fromId, edge.toId]));
  const visibleById = new Set(layout.nodes.map((node) => node.entity.id));

  return (
    <div data-testid="source-graph-canvas"
      style={{ width: layout.width * scale, height: layout.height * scale, position: 'relative', flexShrink: 0 }}>
      <div className="absolute left-0 top-0 select-none"
        style={{
          width: layout.width, height: layout.height,
          transform: 'scale(' + scale + ')', transformOrigin: 'top left',
        }}>
        {layout.groups.map((group) => (
          <div key={group.path} className="absolute rounded-2xl border border-sky-900/90 bg-slate-900/80"
            style={{ left: group.x, top: group.y, width: group.width, height: group.height }}>
            <p className="truncate px-3 pt-3 font-mono text-[11px] font-medium text-sky-200"
              title={group.path}>{group.path}</p>
          </div>
        ))}
        <svg aria-label="Directed source relationships" role="img"
          width={layout.width} height={layout.height}
          className="pointer-events-none absolute inset-0 overflow-visible"
          viewBox={'0 0 ' + layout.width + ' ' + layout.height}>
          <title>Source-derived relationships between program entities</title>
          <defs>
            {KINDS.map((kind) => (
              <marker key={kind} id={markerPrefix + '-' + kind}
                markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"
                markerUnits="userSpaceOnUse">
                <path d="M0 0 L7 3.5 L0 7 Z" fill={RELATION_COLORS[kind]}/>
              </marker>
            ))}
          </defs>
          {drawnEdges.map((edge) => {
            const from = positions.get(edge.fromId);
            const to = positions.get(edge.toId);
            if (!from || !to) return null;
            const active = highlighted.has(edge.id);
            return (
              <path key={edge.id} data-relation-id={edge.id} data-relation-kind={edge.kind}
                d={sourceEdgePath(from, to)} fill="none"
                stroke={RELATION_COLORS[edge.kind]}
                strokeWidth={active ? 2.6 : 1.1}
                opacity={active ? 0.95 : 0.27}
                strokeDasharray={edge.kind === 'references' ? '3 3' : undefined}
                markerEnd={'url(#' + markerPrefix + '-' + edge.kind + ')'}
              />
            );
          })}
        </svg>
        {layout.nodes.map(({ entity, x, y, width, height }) => {
          const chosen = entity.id === selectedId;
          const dim = selectedId && !chosen && !isRelated.has(entity.id);
          return (
            <button key={entity.id} type="button"
              data-entity-id={entity.id}
              aria-label={'Graph entity ' + entity.kind + ' ' + entity.name + ' in ' + entity.path}
              aria-pressed={chosen}
              title={entity.kind + ' ' + entity.name + '\n' + entity.path + ':' + entity.location.startLine}
              onClick={() => onSelect(entity.id)}
              className={'absolute flex flex-col items-start justify-center overflow-hidden rounded-lg border px-2 text-left shadow-sm transition-colors ' +
                kindTone(entity.kind) +
                (chosen ? ' !border-amber-300 ring-2 ring-amber-300 shadow-lg shadow-amber-500/30' : '')}
              style={{ left: x, top: y, width, height, opacity: dim ? 0.59 : 1 }}
            >
              <span className="truncate text-[10px] uppercase tracking-wide opacity-75">{entity.kind}</span>
              <span className="w-full truncate text-[12px] font-semibold">{entity.name}</span>
            </button>
          );
        })}
        {layout.groups.length === 0 && (
          <div className="absolute left-3 top-3 text-[11px] text-slate-400">
            <GitBranch className="mr-1 inline" size={13}/>
            One-hop neighborhood
          </div>
        )}
        {visibleById.size === 0 && <p className="p-4 text-sm text-slate-300">No graph entities to display.</p>}
      </div>
      <span className="sr-only">This map contains {layout.nodes.length} program entities and {drawnEdges.length} drawn relations.</span>
      <span className="sr-only">Source graph has {graph.entities.length} entities and {graph.relations.length} relations overall.</span>
    </div>
  );
}

export function SourceGraphCanvas({ graph, selectedId, onSelect }: Props) {
  const [mode, setMode] = useState<ViewMode>('map');
  const [filter, setFilter] = useState<RelationFilter>('all');
  const [showAll, setShowAll] = useState(false);
  const [scale, setScale] = useState(1);
  const viewport = useRef<HTMLDivElement | null>(null);
  const markerPrefix = useId().replace(/:/g, '') + '-edge';
  const ids = useMemo(() => new Set(graph.entities.map((entity) => entity.id)), [graph]);
  const currentId = selectedId && ids.has(selectedId) ? selectedId : graph.entities[0]?.id ?? null;
  const current = graph.entities.find((entity) => entity.id === currentId);
  const layout = useMemo(() => {
    if (mode === 'connections' && currentId) return layoutSourceConnections(graph, currentId);
    return layoutSourceOverview(graph);
  }, [graph, currentId, mode]);
  const inScopeEdges = mode === 'connections'
    ? graph.relations.filter((edge) => edge.fromId === currentId || edge.toId === currentId)
    : graph.relations;
  const edgeCounts = KINDS.map((kind) => ({
    kind,
    count: inScopeEdges.filter((edge) => edge.kind === kind).length,
  }));
  const relationCount = layout.edges.filter((edge) =>
    filter === 'all' || edge.kind === filter).length;
  const relatedCount = layout.edges.filter((edge) =>
    (filter === 'all' || edge.kind === filter) &&
    (edge.fromId === currentId || edge.toId === currentId)).length;
  const shownCount = showAll || mode === 'connections' ? relationCount : relatedCount;

  // Recenter the neighborhood on mobile; native scroll remains the way to pan
  // the (potentially huge) overview without intercepting touch gestures.
  useEffect(() => {
    if (mode !== 'connections' || !viewport.current) return;
    const element = viewport.current;
    element.scrollLeft = Math.max(0, layout.width * scale / 2 - element.clientWidth / 2);
    element.scrollTop = Math.max(0, layout.height * scale / 2 - element.clientHeight / 2);
  }, [mode, currentId, layout.width, layout.height, scale]);

  const chooseMode = (next: ViewMode) => {
    setMode(next);
    setScale(1);
  };

  return (
    <section aria-label="Visual source relationship graph"
      className="min-w-0 space-y-3 rounded-xl border border-violet-400/40 bg-slate-950 p-3 text-slate-100"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Network size={17} className="text-violet-300"/> Visual source model
          </h2>
          <p className="mt-1 text-[11px] text-slate-400">
            {graph.entities.length} source entities · {graph.relations.length} directed relationships
          </p>
        </div>
        <div role="group" aria-label="Graph view" className="flex gap-1 rounded-lg bg-slate-800 p-1 text-xs">
          <button type="button" aria-pressed={mode === 'map'} onClick={() => chooseMode('map')}
            className={'rounded-md px-3 py-2 ' + (mode === 'map' ? 'bg-violet-600 text-white' : 'text-slate-300')}>System map</button>
          <button type="button" aria-pressed={mode === 'connections'} onClick={() => chooseMode('connections')}
            className={'rounded-md px-3 py-2 ' + (mode === 'connections' ? 'bg-violet-600 text-white' : 'text-slate-300')}>Connections</button>
        </div>
      </div>

      <div role="group" aria-label="Relationship filters"
        className="flex gap-1 overflow-x-auto pb-1 text-[11px]">
        <button type="button" aria-pressed={filter === 'all'}
          onClick={() => setFilter('all')}
          className={'shrink-0 rounded-full border px-3 py-1.5 ' + (filter === 'all' ? 'border-white bg-slate-700' : 'border-slate-600 text-slate-300')}>
          All ({inScopeEdges.length})
        </button>
        {edgeCounts.filter(({ count }) => count > 0).map(({ kind, count }) => (
          <button type="button" key={kind} aria-pressed={filter === kind} onClick={() => setFilter(kind)}
            className={'flex shrink-0 items-center gap-1 rounded-full border px-3 py-1.5 ' +
              (filter === kind ? 'border-white bg-slate-700' : 'border-slate-600 text-slate-300')}>
            <span className="h-2 w-2 rounded-full" style={{ background: RELATION_COLORS[kind] }}/>
            {RELATION_LABELS[kind]} ({count})
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
        <p className="text-slate-300">
          {mode === 'connections' ? 'Connections of ' : showAll ? 'All relationships · ' : 'Selected entity · '}
          <strong className="text-amber-200">{current?.name ?? 'None'}</strong>
          {' · '}{shownCount} visible links
        </p>
        <div className="flex items-center gap-2">
          {mode === 'map' && (
            <button type="button" aria-pressed={showAll}
              onClick={() => setShowAll((value) => !value)}
              className="rounded-md border border-slate-600 px-2 py-1.5 text-slate-100">
              {showAll ? 'Only selected links' : 'Show all links'}
            </button>
          )}
          <div role="group" aria-label="Graph zoom" className="flex items-center gap-1">
            <button type="button" aria-label="Zoom out" disabled={scale <= 0.6}
              className="rounded border border-slate-600 p-1.5 disabled:opacity-40"
              onClick={() => setScale((value) => Math.max(0.6, Math.round((value - 0.2) * 10) / 10))}>
              <Minus size={14}/>
            </button>
            <span className="w-8 text-center tabular-nums">{Math.round(scale * 100)}%</span>
            <button type="button" aria-label="Zoom in" disabled={scale >= 1.8}
              className="rounded border border-slate-600 p-1.5 disabled:opacity-40"
              onClick={() => setScale((value) => Math.min(1.8, Math.round((value + 0.2) * 10) / 10))}>
              <Plus size={14}/>
            </button>
            <button type="button" aria-label="Reset graph zoom"
              className="rounded border border-slate-600 p-1.5" onClick={() => setScale(1)}>
              <Maximize2 size={14}/>
            </button>
          </div>
        </div>
      </div>

      <div ref={viewport} role="group" aria-label="Scrollable source graph canvas"
        className="h-[50dvh] min-h-[310px] max-h-[600px] overflow-auto rounded-xl border border-slate-700 bg-slate-900 shadow-inner"
        style={{ touchAction: 'pan-x pan-y', overscrollBehavior: 'contain' }}>
        <NodeMap layout={layout} graph={graph} selectedId={currentId}
          onSelect={onSelect} scale={scale} filter={filter}
          showAll={showAll || mode === 'connections'} markerPrefix={markerPrefix}/>
      </div>
      <p className="flex items-center gap-1 text-[11px] leading-5 text-slate-400">
        <Move size={14} className="shrink-0"/> Drag to explore · tap a node to inspect its source · Connections shows direct neighbors
      </p>
      {(layout.omittedNodes > 0 || layout.omittedEdges > 0) && (
        <p role="status" className="rounded-lg border border-amber-600/30 p-2 text-[11px] text-amber-200">
          {mode === 'map'
            ? 'Overview limit: ' + layout.omittedNodes + ' entities and ' + layout.omittedEdges +
              ' relationships are not drawn. Use Connections or search the source list to inspect them.'
            : 'Neighborhood only: ' + layout.omittedNodes + ' other entities are outside this view and ' +
              layout.omittedEdges + ' connections from the selection are not drawn.'}
        </p>
      )}
      {current && (
        <p className="break-all border-t border-slate-700 pt-2 text-[11px] text-slate-300">
          <span className="font-semibold text-amber-200">{current.kind} {current.name}</span>
          {' · '}{current.path}:{current.location.startLine}
        </p>
      )}
    </section>
  );
}

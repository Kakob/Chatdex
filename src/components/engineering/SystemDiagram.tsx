/**
 * A compact, authored systems diagram. The nodes are real controls, not SVG
 * hit targets, so touch and keyboard navigation use the same interaction.
 * Scenario colors represent an illustrative step, never observed execution.
 */
import type { CSSProperties } from 'react';

export type DiagramNodeId =
  | 'producer'
  | 'queue'
  | 'worker'
  | 'pending'
  | 'leased'
  | 'acked'
  | 'tests'
  | 'retry'
  | 'dead-letter';

export type DiagramEdgeId =
  | 'enqueue'
  | 'dispatch'
  | 'store'
  | 'claim'
  | 'to-lease'
  | 'ack'
  | 'expire'
  | 'requeue'
  | 'dead-letter';

interface DiagramNode {
  id: DiagramNodeId;
  title: string;
  subtitle: string;
  x: number;
  y: number;
}

const NODES: DiagramNode[] = [
  { id: 'producer', title: 'Producer', subtitle: 'Submit job', x: 10, y: 23 },
  { id: 'queue', title: 'Queue', subtitle: 'Holds jobs', x: 132, y: 23 },
  { id: 'worker', title: 'Worker', subtitle: 'Processes', x: 254, y: 23 },
  { id: 'pending', title: 'Pending', subtitle: 'Waiting', x: 10, y: 134 },
  { id: 'leased', title: 'Leased', subtitle: 'In flight', x: 132, y: 134 },
  { id: 'acked', title: 'Completed', subtitle: 'Ack removes', x: 254, y: 134 },
  { id: 'tests', title: 'Tests', subtitle: 'Inspect evidence', x: 10, y: 246 },
  { id: 'retry', title: 'Retry', subtitle: 'Lease expires', x: 132, y: 246 },
  { id: 'dead-letter', title: 'Dead letter', subtitle: 'Attempts spent', x: 254, y: 246 },
];

const EDGES: { id: DiagramEdgeId; d: string }[] = [
  { id: 'enqueue', d: 'M106 50 H132' },
  { id: 'dispatch', d: 'M228 50 H254' },
  { id: 'store', d: 'M180 77 V110 H58 V134' },
  { id: 'claim', d: 'M302 77 V112 H180 V134' },
  { id: 'to-lease', d: 'M106 160 H132' },
  { id: 'ack', d: 'M228 160 H254' },
  { id: 'expire', d: 'M180 188 V246' },
  { id: 'requeue', d: 'M132 273 H58 V189' },
  { id: 'dead-letter', d: 'M228 273 H254' },
];

function position(x: number, y: number): CSSProperties {
  return {
    left: String((x / 360) * 100) + '%',
    top: String((y / 316) * 100) + '%',
    width: String((96 / 360) * 100) + '%',
    height: String((54 / 316) * 100) + '%',
  };
}

interface Props {
  selected: DiagramNodeId;
  highlighted: readonly DiagramNodeId[];
  highlightedEdge?: DiagramEdgeId;
  onSelect: (id: DiagramNodeId) => void;
}

export function SystemDiagram({ selected, highlighted, highlightedEdge, onSelect }: Props) {
  return (
    <div
      className="relative h-full w-full select-none overflow-hidden rounded-xl border border-gray-200 bg-gray-50/80 dark:border-gray-700 dark:bg-gray-950"
      role="group"
      aria-label="Event queue system diagram"
    >
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-full w-full"
        viewBox="0 0 360 316"
        preserveAspectRatio="none"
      >
        <defs>
          <marker id="explorer-arrow-neutral" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <path d="M0 0 L6 3 L0 6 Z" fill="#9ca3af" />
          </marker>
          <marker id="explorer-arrow-active" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <path d="M0 0 L6 3 L0 6 Z" fill="#059669" />
          </marker>
        </defs>
        <text x="10" y="14" fill="currentColor" opacity=".55" fontSize="9">SYSTEM FLOW</text>
        <text x="10" y="124" fill="currentColor" opacity=".55" fontSize="9">JOB LIFECYCLE</text>
        <text x="10" y="235" fill="currentColor" opacity=".55" fontSize="9">RECOVERY / EVIDENCE</text>
        {EDGES.map((edge) => {
          const active = edge.id === highlightedEdge;
          return (
            <path
              key={edge.id}
              data-edge={edge.id}
              data-highlighted={active ? 'true' : undefined}
              d={edge.d}
              fill="none"
              stroke={active ? '#059669' : '#9ca3af'}
              strokeWidth={active ? 3 : 1.5}
              strokeDasharray={edge.id === 'requeue' ? '4 3' : undefined}
              markerEnd={active ? 'url(#explorer-arrow-active)' : 'url(#explorer-arrow-neutral)'}
            />
          );
        })}
      </svg>
      {NODES.map((node) => {
        const active = highlighted.includes(node.id);
        const chosen = selected === node.id;
        return (
          <button
            type="button"
            key={node.id}
            aria-label={node.title}
            aria-pressed={chosen}
            title={node.title + ': ' + node.subtitle}
            data-node={node.id}
            data-highlighted={active ? 'true' : undefined}
            style={position(node.x, node.y)}
            onClick={() => onSelect(node.id)}
            className={
              'absolute flex min-h-[44px] flex-col items-center justify-center rounded-lg border px-1 text-center shadow-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600 ' +
              (active
                ? 'border-emerald-500 bg-emerald-50 text-emerald-950 dark:bg-emerald-950 dark:text-emerald-100 '
                : 'border-gray-300 bg-white text-gray-900 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 ') +
              (chosen ? 'ring-2 ring-violet-500 ring-offset-1 ring-offset-gray-50 dark:ring-offset-gray-950' : 'hover:border-violet-400')
            }
          >
            <span className="block text-[11px] font-semibold leading-tight sm:text-xs">{node.title}</span>
            <span className="mt-0.5 block text-[9px] leading-tight opacity-70 sm:text-[10px]">{node.subtitle}</span>
          </button>
        );
      })}
    </div>
  );
}

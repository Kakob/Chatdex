import { Waypoints } from 'lucide-react';
import type { ProjectMap, MapNode } from '../../lib/understanding/map';
import type { UnderstandingStatus } from '../../types/understanding';

// Chain-lane timeline (U4.4 spike, PRD §13): one row per supersession chain,
// evolution reading left → right. Hand-rolled SVG — no graph library, no
// force layout.

const PAD = 16;
const COL_W = 200;
const ROW_H = 72;
const NODE_W = 168;
const NODE_H = 48;

const STATUS_STROKE: Record<UnderstandingStatus, string> = {
  current: 'stroke-violet-400 dark:stroke-violet-500',
  superseded: 'stroke-gray-300 dark:stroke-gray-700',
  resolved: 'stroke-blue-400 dark:stroke-blue-500',
};

const STATUS_TITLE_FILL: Record<UnderstandingStatus, string> = {
  current: 'fill-gray-900 dark:fill-white',
  superseded: 'fill-gray-500 dark:fill-gray-400',
  resolved: 'fill-gray-700 dark:fill-gray-300',
};

const truncate = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

function MapNodeRect({
  node,
  onOpenHistory,
}: {
  node: MapNode;
  onOpenHistory: (objectId: string) => void;
}) {
  const x = PAD + node.col * COL_W;
  const y = PAD + node.row * ROW_H;
  return (
    <g
      role="button"
      tabIndex={0}
      onClick={() => onOpenHistory(node.objectId)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpenHistory(node.objectId);
      }}
      className="cursor-pointer"
    >
      <title>{`${node.title} — ${node.type}, ${node.status}${
        node.reviewState === 'pending' ? ', pending review' : ''
      }. Click for history.`}</title>
      <rect
        x={x}
        y={y}
        width={NODE_W}
        height={NODE_H}
        rx={10}
        strokeWidth={1.5}
        strokeDasharray={node.reviewState === 'pending' ? '4 3' : undefined}
        className={`fill-white dark:fill-gray-900 ${STATUS_STROKE[node.status]}`}
      />
      <text
        x={x + 10}
        y={y + 20}
        className={`text-[12px] font-medium ${STATUS_TITLE_FILL[node.status]}`}
      >
        {truncate(node.title, 24)}
      </text>
      <text x={x + 10} y={y + 36} className="text-[10px] fill-gray-400">
        {truncate(node.type, 12)} · {node.firstSeenAt.toLocaleDateString()}
      </text>
    </g>
  );
}

/**
 * SVG map over a project's understanding objects. Solid arrows are applied
 * supersessions; dashed arrows are pending proposals; dashed node borders are
 * objects awaiting review. Clicking a node opens its history drawer.
 */
export function ProjectMapView({
  map,
  onOpenHistory,
}: {
  map: ProjectMap;
  onOpenHistory: (objectId: string) => void;
}) {
  if (map.nodes.length === 0) {
    return (
      <div className="text-center py-16 text-gray-500 dark:text-gray-400">
        <Waypoints size={48} className="mx-auto mb-4 opacity-50" />
        <p>Nothing to map yet</p>
      </div>
    );
  }

  const nodeAt = new Map(map.nodes.map((n) => [n.objectId, n]));
  const width = PAD * 2 + (map.colCount - 1) * COL_W + NODE_W;
  const height = PAD * 2 + (map.rowCount - 1) * ROW_H + NODE_H;

  return (
    <div>
      <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
        <svg width={width} height={height} className="block">
          <defs>
            <marker
              id="map-arrow"
              viewBox="0 0 8 8"
              refX={7}
              refY={4}
              markerWidth={7}
              markerHeight={7}
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 8 4 L 0 8 z" className="fill-gray-400 dark:fill-gray-600" />
            </marker>
          </defs>
          {map.edges.map((edge) => {
            const from = nodeAt.get(edge.fromId);
            const to = nodeAt.get(edge.toId);
            if (!from || !to) return null;
            const x1 = PAD + from.col * COL_W + NODE_W;
            const y1 = PAD + from.row * ROW_H + NODE_H / 2;
            const x2 = PAD + to.col * COL_W;
            const y2 = PAD + to.row * ROW_H + NODE_H / 2;
            return (
              <line
                key={`${edge.fromId}-${edge.toId}`}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                strokeWidth={1.5}
                strokeDasharray={edge.applied ? undefined : '4 3'}
                markerEnd="url(#map-arrow)"
                className={
                  edge.applied
                    ? 'stroke-gray-400 dark:stroke-gray-600'
                    : 'stroke-amber-400 dark:stroke-amber-500'
                }
              />
            );
          })}
          {map.nodes.map((node) => (
            <MapNodeRect key={node.objectId} node={node} onOpenHistory={onOpenHistory} />
          ))}
        </svg>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-400">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded border-[1.5px] border-violet-400" />
          current
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded border-[1.5px] border-gray-300 dark:border-gray-700" />
          superseded
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded border-[1.5px] border-blue-400" />
          resolved
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded border-[1.5px] border-dashed border-gray-400" />
          pending review
        </span>
        <span>solid arrow = replaced by · dashed arrow = proposed replacement</span>
        <span>click a node for its history</span>
      </div>
    </div>
  );
}

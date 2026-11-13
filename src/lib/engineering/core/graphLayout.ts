/**
 * Deterministic, source-driven positions for the engineering graph UI.
 *
 * The layout never invents entities or relationships. It only places a
 * bounded subset of the analyzer's graph into module groups or a one-hop
 * neighborhood. Omitted nodes/edges are reported explicitly.
 */
import type { DerivedGraph, SourceEntity, SourceRelation } from './contracts';

export interface PlacedSourceNode {
  entity: SourceEntity;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SourceFileGroup {
  path: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PositionedSourceGraph {
  width: number;
  height: number;
  nodes: PlacedSourceNode[];
  edges: SourceRelation[];
  groups: SourceFileGroup[];
  omittedNodes: number;
  omittedEdges: number;
}

const MODULE_WIDTH = 354;
const MODULE_GAP = 24;
const ENTITY_WIDTH = 160;
const ENTITY_HEIGHT = 44;
const ROW_HEIGHT = 57;
const MARGIN = 18;
const cmp = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

function byPosition(a: SourceEntity, b: SourceEntity): number {
  return a.location.startOffset - b.location.startOffset ||
    cmp(a.id, b.id);
}

function visibleRelations(graph: DerivedGraph, ids: ReadonlySet<string>): SourceRelation[] {
  return graph.relations.filter((edge) => ids.has(edge.fromId) && ids.has(edge.toId))
    .sort((a, b) => cmp(a.id, b.id));
}

/**
 * Group nodes by actual source file, two file groups per row.
 * "contains" is also represented by grouping, but remains an actual edge
 * that can be shown and inspected in the visual map.
 */
export function layoutSourceOverview(
  graph: DerivedGraph,
  maxEntities = 180,
): PositionedSourceGraph {
  if (!Number.isInteger(maxEntities) || maxEntities < 1) {
    throw new Error('maxEntities must be a positive integer');
  }

  const entities = new Map(graph.entities.map((entity) => [entity.id, entity]));
  const modules = [...graph.entities]
    .filter((entity) => entity.kind === 'module')
    .sort((a, b) => cmp(a.path, b.path));
  const nonModules = [...graph.entities]
    .filter((entity) => entity.kind !== 'module')
    .sort((a, b) => cmp(a.path, b.path) || byPosition(a, b));

  const selected = new Set<string>();
  // Reserve one module header for every visible module before allocating
  // declarations, so an excerpt never loses its parent file context.
  for (const module of modules.slice(0, maxEntities)) selected.add(module.id);
  for (const entity of nonModules) {
    if (selected.size >= maxEntities) break;
    if (modules.some((module) => module.path === entity.path && selected.has(module.id))) {
      selected.add(entity.id);
    }
  }

  const nodes: PlacedSourceNode[] = [];
  const groups: SourceFileGroup[] = [];
  const moduleGroups = modules.filter((module) => selected.has(module.id));
  let nextY = MARGIN;
  for (let row = 0; row < Math.ceil(moduleGroups.length / 2); row++) {
    const pair = moduleGroups.slice(row * 2, row * 2 + 2);
    let height = 0;
    for (let col = 0; col < pair.length; col++) {
      const module = pair[col];
      const x = MARGIN + col * (MODULE_WIDTH + MODULE_GAP);
      const members = nonModules.filter((entity) =>
        selected.has(entity.id) && entity.path === module.path);
      const groupHeight = 111 + Math.ceil(members.length / 2) * ROW_HEIGHT;
      groups.push({ path: module.path, x, y: nextY, width: MODULE_WIDTH, height: groupHeight });
      nodes.push({
        entity: module,
        x: x + 12, y: nextY + 42,
        width: MODULE_WIDTH - 24, height: ENTITY_HEIGHT,
      });
      members.forEach((entity, i) => nodes.push({
        entity,
        x: x + 12 + (i % 2) * 170,
        y: nextY + 95 + Math.floor(i / 2) * ROW_HEIGHT,
        width: ENTITY_WIDTH, height: ENTITY_HEIGHT,
      }));
      height = Math.max(height, groupHeight);
    }
    nextY += height + MODULE_GAP;
  }
  // Declared source entities are never synthesized by the layout. Count
  // missing endpoints separately instead of drawing phantom connections.
  const edges = visibleRelations(graph, selected);
  return {
    width: MARGIN * 2 + (moduleGroups.length > 1 ? MODULE_WIDTH * 2 + MODULE_GAP : MODULE_WIDTH),
    height: Math.max(190, nextY + MARGIN),
    nodes, edges, groups,
    omittedNodes: Math.max(0, entities.size - nodes.length),
    omittedEdges: Math.max(0, graph.relations.length - edges.length),
  };
}

/** Select one real entity and place up to maxNeighbors directly connected peers around it. */
export function layoutSourceConnections(
  graph: DerivedGraph,
  centerId: string,
  maxNeighbors = 14,
): PositionedSourceGraph {
  const byId = new Map(graph.entities.map((entity) => [entity.id, entity]));
  const center = byId.get(centerId);
  if (!center) throw new Error('The selected source entity is absent from this graph');
  if (!Number.isInteger(maxNeighbors) || maxNeighbors < 1) {
    throw new Error('maxNeighbors must be a positive integer');
  }

  const relevant = graph.relations.filter((edge) =>
    (edge.fromId === centerId || edge.toId === centerId) &&
    byId.has(edge.fromId) && byId.has(edge.toId));
  const incomingIds = [...new Set(relevant
    .filter((edge) => edge.toId === centerId).map((edge) => edge.fromId))].sort(cmp);
  const outgoingIds = [...new Set(relevant
    .filter((edge) => edge.fromId === centerId).map((edge) => edge.toId))].sort(cmp);
  const chosen: string[] = [];
  for (const id of [...incomingIds, ...outgoingIds]) {
    if (id === centerId || chosen.includes(id)) continue;
    if (chosen.length >= maxNeighbors) break;
    chosen.push(id);
  }
  const incoming = chosen.filter((id) => incomingIds.includes(id));
  const outgoing = chosen.filter((id) => !incoming.includes(id));
  const rowCount = Math.max(3, incoming.length, outgoing.length);
  const height = 92 + rowCount * 64;
  const centerY = Math.round(height / 2) - ENTITY_HEIGHT / 2;
  const nodes: PlacedSourceNode[] = [{
    entity: center, x: 270, y: centerY, width: 188, height: ENTITY_HEIGHT + 12,
  }];
  const slot = (count: number, i: number) => Math.round(height / 2 - count * 64 / 2 + i * 64);
  incoming.forEach((id, i) => nodes.push({
    entity: byId.get(id)!, x: 24, y: slot(incoming.length, i), width: 198, height: ENTITY_HEIGHT,
  }));
  outgoing.forEach((id, i) => nodes.push({
    entity: byId.get(id)!, x: 506, y: slot(outgoing.length, i), width: 198, height: ENTITY_HEIGHT,
  }));
  const included = new Set(nodes.map((node) => node.entity.id));
  const edges = relevant.filter((edge) => included.has(edge.fromId) && included.has(edge.toId));
  return {
    width: 730, height,
    nodes, edges, groups: [],
    omittedNodes: Math.max(0, graph.entities.length - nodes.length),
    omittedEdges: Math.max(0, relevant.length - edges.length),
  };
}

/** Curved directed connection from the real source entity to its target. */
export function sourceEdgePath(from: PlacedSourceNode, to: PlacedSourceNode): string {
  const fromMid = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
  const toMid = { x: to.x + to.width / 2, y: to.y + to.height / 2 };
  const rightward = toMid.x >= fromMid.x;
  const horizontal = Math.abs(toMid.x - fromMid.x) > 78;
  if (horizontal) {
    const sx = from.x + (rightward ? from.width : 0);
    const ex = to.x + (rightward ? 0 : to.width);
    const bend = Math.max(34, Math.abs(ex - sx) * 0.43);
    return 'M ' + sx + ' ' + fromMid.y +
      ' C ' + (sx + (rightward ? bend : -bend)) + ' ' + fromMid.y +
      ', ' + (ex + (rightward ? -bend : bend)) + ' ' + toMid.y +
      ', ' + ex + ' ' + toMid.y;
  }
  const downward = toMid.y >= fromMid.y;
  const sy = from.y + (downward ? from.height : 0);
  const ey = to.y + (downward ? 0 : to.height);
  const bend = Math.max(30, Math.abs(ey - sy) * 0.43);
  return 'M ' + fromMid.x + ' ' + sy +
    ' C ' + fromMid.x + ' ' + (sy + (downward ? bend : -bend)) +
    ', ' + toMid.x + ' ' + (ey + (downward ? -bend : bend)) +
    ', ' + toMid.x + ' ' + ey;
}

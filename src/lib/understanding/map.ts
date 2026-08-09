// Project map spike (PRD §13, phase U4.4).
//
// Deliberately NOT a force-directed graph (§13 warns against building one
// just because the data is graph-shaped). The only true cross-object edge in
// the data model is supersession, so the map is a chain-lane timeline: each
// supersession chain occupies one row and reads left → right as evolution;
// objects nothing ever replaced sit in single-node rows. Pending proposals
// draw as dashed edges — visible, but distinguishable from applied history.

import { db } from '../db/schema';
import { getObjectsForProject } from '../db/understanding';
import type {
  UnderstandingObject,
  UnderstandingEvent,
  UnderstandingStatus,
  ReviewState,
} from '../../types/understanding';

export interface MapNode {
  objectId: string;
  title: string;
  type: string;
  status: UnderstandingStatus;
  reviewState: ReviewState;
  /** Earliest non-rejected event moment (source timeline); createdAt fallback. */
  firstSeenAt: Date;
  /** Lane index, 0 = top. */
  row: number;
  /** Position within the lane, 0 = chain start. */
  col: number;
}

export interface MapEdge {
  fromId: string;
  toId: string;
  /** false = pending supersession proposal (drawn dashed). */
  applied: boolean;
}

export interface ProjectMap {
  nodes: MapNode[];
  edges: MapEdge[];
  rowCount: number;
  colCount: number;
}

/**
 * Pure layout over already-loaded rows (exported for tests; the Dexie loader
 * below feeds it). Inclusion mirrors the panel: rejected objects excluded,
 * pending rendered. Rejected supersessions never draw; pending ones draw
 * dashed and still group their chain.
 */
export function assembleProjectMap(
  objects: UnderstandingObject[],
  events: UnderstandingEvent[]
): ProjectMap {
  const included = objects.filter((o) => o.reviewState !== 'rejected');
  const ids = new Set(included.map((o) => o.id));

  const firstSeenAt = new Map<string, Date>(included.map((o) => [o.id, o.createdAt]));
  for (const event of events) {
    if (event.reviewState === 'rejected' || !ids.has(event.objectId)) continue;
    const current = firstSeenAt.get(event.objectId)!;
    if (event.occurredAt < current) firstSeenAt.set(event.objectId, event.occurredAt);
  }

  // One edge per from→to pair; an applied event wins over a pending one.
  const edgeMap = new Map<string, MapEdge>();
  for (const event of events) {
    if (event.op !== 'superseded' || event.reviewState === 'rejected') continue;
    const toId = event.supersededByObjectId;
    if (!toId || toId === event.objectId || !ids.has(event.objectId) || !ids.has(toId)) {
      continue;
    }
    const applied = event.reviewState === 'accepted' || event.reviewState === 'edited';
    const key = `${event.objectId}→${toId}`;
    const existing = edgeMap.get(key);
    if (!existing) {
      edgeMap.set(key, { fromId: event.objectId, toId, applied });
    } else if (applied) {
      existing.applied = true;
    }
  }
  const edges = [...edgeMap.values()];

  // Rows = connected components over supersession edges (undirected).
  const neighbours = new Map<string, string[]>();
  for (const edge of edges) {
    neighbours.set(edge.fromId, [...(neighbours.get(edge.fromId) ?? []), edge.toId]);
    neighbours.set(edge.toId, [...(neighbours.get(edge.toId) ?? []), edge.fromId]);
  }
  const componentOf = new Map<string, number>();
  const components: string[][] = [];
  for (const object of included) {
    if (componentOf.has(object.id)) continue;
    const component: string[] = [];
    const queue = [object.id];
    componentOf.set(object.id, components.length);
    while (queue.length > 0) {
      const id = queue.shift()!;
      component.push(id);
      for (const next of neighbours.get(id) ?? []) {
        if (componentOf.has(next)) continue;
        componentOf.set(next, components.length);
        queue.push(next);
      }
    }
    components.push(component);
  }

  const objectById = new Map(included.map((o) => [o.id, o]));
  const byFirstSeen = (a: string, b: string) =>
    firstSeenAt.get(a)!.getTime() - firstSeenAt.get(b)!.getTime() ||
    objectById.get(a)!.title.localeCompare(objectById.get(b)!.title);

  // Within a lane: topological order (predecessors left of successors),
  // first-seen as tiebreak; a cycle from bad AI output just falls back to
  // first-seen order for whatever remains.
  const orderComponent = (members: string[]): string[] => {
    const memberSet = new Set(members);
    const indegree = new Map(members.map((id) => [id, 0]));
    for (const edge of edges) {
      if (memberSet.has(edge.fromId) && memberSet.has(edge.toId)) {
        indegree.set(edge.toId, indegree.get(edge.toId)! + 1);
      }
    }
    const ordered: string[] = [];
    const ready = members.filter((id) => indegree.get(id) === 0).sort(byFirstSeen);
    while (ready.length > 0) {
      const id = ready.shift()!;
      ordered.push(id);
      for (const edge of edges) {
        if (edge.fromId !== id || !memberSet.has(edge.toId)) continue;
        const remaining = indegree.get(edge.toId)! - 1;
        indegree.set(edge.toId, remaining);
        if (remaining === 0) {
          ready.push(edge.toId);
          ready.sort(byFirstSeen);
        }
      }
    }
    const leftover = members.filter((id) => !ordered.includes(id)).sort(byFirstSeen);
    return [...ordered, ...leftover];
  };

  // Most recently started chain on top — matches the product's recency bias.
  const newestOf = (members: string[]) =>
    Math.max(...members.map((id) => firstSeenAt.get(id)!.getTime()));
  const sortedComponents = components
    .map(orderComponent)
    .sort((a, b) => newestOf(b) - newestOf(a) || byFirstSeen(a[0], b[0]));

  const nodes: MapNode[] = sortedComponents.flatMap((members, row) =>
    members.map((id, col) => {
      const object = objectById.get(id)!;
      return {
        objectId: id,
        title: object.title,
        type: object.type,
        status: object.status,
        reviewState: object.reviewState,
        firstSeenAt: firstSeenAt.get(id)!,
        row,
        col,
      };
    })
  );

  return {
    nodes,
    edges,
    rowCount: sortedComponents.length,
    colCount: Math.max(0, ...sortedComponents.map((m) => m.length)),
  };
}

/** Load the map for one project (null = the unassigned bucket). */
export async function loadProjectMap(projectId: string | null): Promise<ProjectMap> {
  const objects = await getObjectsForProject(projectId);
  const events = await db.understandingEvents
    .where('objectId')
    .anyOf(objects.map((o) => o.id))
    .toArray();
  return assembleProjectMap(objects, events);
}

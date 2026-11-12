/**
 * Pure, application-agnostic engineering graph projection and impact preview.
 * Does not infer runtime behavior, automatically approve a proposal, or write
 * source. Stable project concept IDs and relationship IDs are the API.
 */
import type { ProjectEngineeringModel } from './modelStore';
import type { EngineeringSourceBinding } from './sourceCatalog';

export interface GraphNode {
  id: string;
  parentId: string | null;
  title: string;
  currentTitle: string;
  description: string;
  kind: string;
  depth: number;
  proposed: boolean;
  stale: boolean;
  children: string[];
}

export interface GraphEdge {
  id: string;
  fromId: string;
  toId: string;
  kind: string;
  title: string;
  proposed: boolean;
}

export interface EngineeringGraph {
  projectId: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Only valid edges. Bad model references are reported rather than invented. */
  danglingEdgeIds: string[];
}

export interface ImpactPreview {
  targetId: string;
  directlyConnectedIds: string[];
  candidateNodeIds: string[];
  relevantRelationIds: string[];
  sourceBindings: EngineeringSourceBinding[];
  /** All effects here are possible areas to inspect, not proven changes. */
  status: 'potential-only';
}

export function projectGraph(model: ProjectEngineeringModel): EngineeringGraph {
  const ids = new Set(model.concepts.map((c) => c.id));
  const parent = new Map(model.concepts.map((c) => [c.id, c.parentRegionId]));
  const children = new Map<string, string[]>();
  for (const concept of model.concepts) {
    if (!concept.parentRegionId || !ids.has(concept.parentRegionId)) continue;
    children.set(concept.parentRegionId, [...(children.get(concept.parentRegionId) ?? []), concept.id]);
  }
  const depth = (id: string, seen = new Set<string>()): number => {
    const above = parent.get(id);
    if (!above || !ids.has(above) || seen.has(id) || above === id) return 0;
    const next = new Set(seen);
    next.add(id);
    return 1 + depth(above, next);
  };

  const nodes = [...model.concepts]
    .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title) || a.id.localeCompare(b.id))
    .map((concept) => {
      const element = model.elements[concept.id];
      return {
        id: concept.id,
        parentId: concept.parentRegionId && ids.has(concept.parentRegionId) ? concept.parentRegionId : null,
        title: element?.proposed?.title ?? concept.title,
        currentTitle: concept.title,
        description: element?.proposed?.description ?? concept.summary ?? '',
        kind: concept.kind ?? 'concept',
        depth: depth(concept.id),
        proposed: Boolean(element?.proposed),
        stale: Boolean(element?.stale),
        children: children.get(concept.id) ?? [],
      };
    });
  const danglingEdgeIds = model.transitions
    .filter((edge) => !ids.has(edge.fromConceptId) || !ids.has(edge.toConceptId))
    .map((edge) => edge.id);
  const edges = model.transitions.filter((edge) =>
    ids.has(edge.fromConceptId) && ids.has(edge.toConceptId)
  ).sort((a, b) =>
    a.fromConceptId.localeCompare(b.fromConceptId) ||
    a.toConceptId.localeCompare(b.toConceptId) ||
    a.kind.localeCompare(b.kind) ||
    a.title.localeCompare(b.title) ||
    a.id.localeCompare(b.id)
  ).map((edge) => ({
    id: edge.id,
    fromId: edge.fromConceptId,
    toId: edge.toConceptId,
    kind: edge.kind,
    title: model.elements[edge.id]?.proposed?.title ?? edge.title,
    proposed: Boolean(model.elements[edge.id]?.proposed),
  }));
  return { projectId: model.projectId, nodes, edges, danglingEdgeIds };
}

/** Directed, bounded impact candidates; never says a change is verified. */
export function previewModelImpact(model: ProjectEngineeringModel, targetId: string, maxHops = 2): ImpactPreview {
  if (!model.elements[targetId]) throw new Error('Model target not found in this project');
  if (!Number.isInteger(maxHops) || maxHops < 0 || maxHops > 5) throw new Error('Impact depth must be 0 to 5');
  const graph = projectGraph(model);
  const nodes = new Set(graph.nodes.map((node) => node.id));
  const relIds = new Set(graph.edges.map((edge) => edge.id));
  const targetEdge = graph.edges.find((edge) => edge.id === targetId);
  const starting = targetEdge ? [targetEdge.fromId, targetEdge.toId] : nodes.has(targetId) ? [targetId] : [];
  const queue = starting.map((id) => ({ id, depth: 0 }));
  const visited = new Set(starting);
  const traversed = new Set<string>();
  // Walk outward along authored relations only. This is a navigation preview,
  // not a sound dependency analysis: do not infer unknown reverse call paths.
  for (let i = 0; i < queue.length; i++) {
    const { id, depth } = queue[i];
    if (depth >= maxHops) continue;
    for (const edge of graph.edges) {
      if (edge.fromId !== id || !nodes.has(edge.toId)) continue;
      traversed.add(edge.id);
      if (!visited.has(edge.toId)) {
        visited.add(edge.toId);
        queue.push({ id: edge.toId, depth: depth + 1 });
      }
    }
  }
  if (targetEdge) traversed.add(targetEdge.id);
  const direct = graph.edges.filter((edge) =>
    starting.includes(edge.fromId) || starting.includes(edge.toId)
  );
  const directIds = new Set<string>();
  for (const edge of direct) {
    directIds.add(edge.fromId);
    directIds.add(edge.toId);
  }
  for (const id of starting) directIds.delete(id);
  const candidates = new Set([...visited, ...directIds]);
  // Include relations touching the selected target even if they are not
  // followed by the directed traversal (for source inspection, not effect).
  const related = new Set([...traversed, ...direct.map((edge) => edge.id)]);
  if (relIds.has(targetId)) related.add(targetId);
  const targets = new Set([...candidates, ...related, targetId]);
  const sourceBindings = model.sourceBindings
    .filter((binding) => targets.has(binding.targetId))
    .sort((a, b) => a.path.localeCompare(b.path) || a.id.localeCompare(b.id));
  return {
    targetId,
    directlyConnectedIds: [...directIds],
    candidateNodeIds: [...candidates],
    relevantRelationIds: [...related],
    sourceBindings,
    status: 'potential-only',
  };
}

/** Stable lookup by full concept ID; no app names or special cases. */
export function relationshipsOf(model: ProjectEngineeringModel, conceptId: string) {
  return model.transitions.filter((edge) => edge.fromConceptId === conceptId || edge.toConceptId === conceptId);
}

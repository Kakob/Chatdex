// Understanding trace (SPEC-change-workspace §10, PRD §8). Pure functions
// over the embedded `WorkspaceTrace`: an ordered main sequence of nodes,
// optional branch nodes hanging off any node, and one edge per adjacency.
// Edge verification is DERIVED from attached evidence (D4, law §2.2) — the
// only stored override is a human-set `contradicted` with a note. Unknown
// nodes (`???`) are first-class: an incomplete trace beats an invented one.

import { generateId } from '../utils/ids';
import { isMechanicalEvidence, type EvidenceItem } from '../../types/evidence';
import type { TraceEdge, TraceNode, TraceNodeKind, WorkspaceTrace } from '../../types/preparedChange';

export type EdgeVerification = 'verified' | 'hypothesis' | 'ai_inference' | 'contradicted' | 'unknown';

export const EDGE_VERIFICATION_LABEL: Record<EdgeVerification, string> = {
  verified: 'Verified',
  hypothesis: 'Hypothesis',
  ai_inference: 'AI inference',
  contradicted: 'Contradicted',
  unknown: 'Unknown',
};

export const TRACE_NODE_KINDS: readonly TraceNodeKind[] = [
  'behavior',
  'component',
  'function',
  'route',
  'endpoint',
  'service',
  'db',
  'event',
  'state',
  'external',
  'test',
  'unknown',
  'other',
];

export const UNKNOWN_LABEL = '???';

// --- derivation (D4) ---

function classify(evidenceIds: string[], evidence: EvidenceItem[]): Exclude<EdgeVerification, 'contradicted'> {
  const byId = new Map(evidence.map((e) => [e.id, e]));
  const attached = evidenceIds.map((id) => byId.get(id)).filter((e): e is EvidenceItem => Boolean(e));
  if (attached.some(isMechanicalEvidence)) return 'verified';
  if (attached.some((e) => e.kind === 'human_hypothesis')) return 'hypothesis';
  if (attached.some((e) => e.kind === 'ai_inference')) return 'ai_inference';
  return 'unknown';
}

/**
 * contradicted  — human override (with note)
 * verified      — ≥ 1 mechanical item (code, test/runtime, commit history)
 * hypothesis    — otherwise ≥ 1 human hypothesis
 * ai_inference  — otherwise ≥ 1 AI item
 * unknown       — nothing attached (or only dangling ids)
 */
export function deriveEdgeVerification(edge: TraceEdge, evidence: EvidenceItem[]): EdgeVerification {
  if (edge.override?.verification === 'contradicted') return 'contradicted';
  return classify(edge.evidenceIds, evidence);
}

/** Same ladder for a node's own evidence (what supports "this thing exists / does this"). */
export function deriveNodeSupport(node: TraceNode, evidence: EvidenceItem[]): Exclude<EdgeVerification, 'contradicted'> {
  return classify(node.evidenceIds, evidence);
}

export interface TraceSummary {
  nodes: number;
  unknownNodes: number;
  edges: number;
  byVerification: Record<EdgeVerification, number>;
}

export function traceSummary(trace: WorkspaceTrace | undefined, evidence: EvidenceItem[]): TraceSummary {
  const byVerification: Record<EdgeVerification, number> = {
    verified: 0,
    hypothesis: 0,
    ai_inference: 0,
    contradicted: 0,
    unknown: 0,
  };
  if (!trace) return { nodes: 0, unknownNodes: 0, edges: 0, byVerification };
  for (const edge of trace.edges) byVerification[deriveEdgeVerification(edge, evidence)] += 1;
  return {
    nodes: trace.nodes.length,
    unknownNodes: trace.nodes.filter((n) => n.kind === 'unknown').length,
    edges: trace.edges.length,
    byVerification,
  };
}

// --- structure ---

export function emptyTrace(): WorkspaceTrace {
  return { nodes: [], edges: [] };
}

function byOrder(a: TraceNode, b: TraceNode): number {
  return a.order - b.order;
}

export function mainSequence(trace: WorkspaceTrace): TraceNode[] {
  return trace.nodes.filter((n) => !n.branchOf).sort(byOrder);
}

export function branchesOf(trace: WorkspaceTrace, nodeId: string): TraceNode[] {
  return trace.nodes.filter((n) => n.branchOf === nodeId).sort(byOrder);
}

/** Display order: each main node followed (depth-first) by its branches. */
export function orderedNodes(trace: WorkspaceTrace): { node: TraceNode; depth: number }[] {
  const out: { node: TraceNode; depth: number }[] = [];
  const visit = (node: TraceNode, depth: number, seen: Set<string>) => {
    if (seen.has(node.id)) return;
    seen.add(node.id);
    out.push({ node, depth });
    for (const child of branchesOf(trace, node.id)) visit(child, depth + 1, seen);
  };
  const seen = new Set<string>();
  for (const node of mainSequence(trace)) visit(node, 0, seen);
  // Orphans (branchOf pointing at a removed node) still render, flat.
  for (const node of trace.nodes.sort(byOrder)) visit(node, 0, seen);
  return out;
}

/** The single edge feeding `nodeId` (its predecessor in the main sequence, or its branch parent). */
export function incomingEdge(trace: WorkspaceTrace, nodeId: string): TraceEdge | undefined {
  return trace.edges.find((e) => e.to === nodeId);
}

function expectedAdjacencies(trace: WorkspaceTrace): Array<{ from: string; to: string }> {
  const pairs: Array<{ from: string; to: string }> = [];
  const main = mainSequence(trace);
  for (let i = 1; i < main.length; i++) pairs.push({ from: main[i - 1].id, to: main[i].id });
  const ids = new Set(trace.nodes.map((n) => n.id));
  for (const node of trace.nodes) {
    if (node.branchOf && ids.has(node.branchOf)) pairs.push({ from: node.branchOf, to: node.id });
  }
  return pairs;
}

/**
 * Keep exactly one edge per adjacency: preserve existing edges (claim,
 * evidence, override) whose endpoints are still adjacent, drop the rest,
 * create the missing ones. Renumbers `order` densely.
 */
export function reconcileEdges(trace: WorkspaceTrace, idFactory: () => string = generateId): WorkspaceTrace {
  const nodes = renumber(trace.nodes);
  const working = { nodes, edges: trace.edges };
  const wanted = expectedAdjacencies(working);
  const existing = new Map(trace.edges.map((e) => [`${e.from}→${e.to}`, e]));
  const edges: TraceEdge[] = wanted.map(
    ({ from, to }) => existing.get(`${from}→${to}`) ?? { id: idFactory(), from, to, evidenceIds: [], origin: 'user' }
  );
  return { nodes, edges };
}

function renumber(nodes: TraceNode[]): TraceNode[] {
  const groups = new Map<string, TraceNode[]>();
  for (const node of nodes) {
    const key = node.branchOf ?? '';
    groups.set(key, [...(groups.get(key) ?? []), node]);
  }
  const out: TraceNode[] = [];
  for (const group of groups.values()) {
    group.sort(byOrder).forEach((node, index) => out.push({ ...node, order: index }));
  }
  return out;
}

export interface AddNodeInput {
  label: string;
  kind: TraceNodeKind;
  /** Insert right after this main-sequence node; omitted = append to the end. */
  afterNodeId?: string | null;
  /** Make this a branch hanging off the given node instead of a main-sequence node. */
  branchOf?: string;
  evidenceIds?: string[];
  id?: string;
}

export function addNode(trace: WorkspaceTrace, input: AddNodeInput, idFactory: () => string = generateId): WorkspaceTrace {
  const label = input.label.trim() || (input.kind === 'unknown' ? UNKNOWN_LABEL : '');
  if (!label) throw new Error('Trace node needs a label');
  const id = input.id ?? idFactory();
  if (trace.nodes.some((n) => n.id === id)) throw new Error(`Trace node ${id} already exists`);
  if (input.branchOf && !trace.nodes.some((n) => n.id === input.branchOf)) {
    throw new Error('Branch parent not found');
  }
  const siblings = input.branchOf ? branchesOf(trace, input.branchOf) : mainSequence(trace);
  let order: number;
  if (input.branchOf) {
    order = siblings.length;
  } else if (input.afterNodeId) {
    const anchor = siblings.find((n) => n.id === input.afterNodeId);
    if (!anchor) throw new Error('Anchor node not found in the main sequence');
    order = anchor.order + 0.5;
  } else {
    order = siblings.length;
  }
  const node: TraceNode = {
    id,
    label,
    kind: input.kind,
    evidenceIds: [...new Set(input.evidenceIds ?? [])],
    order,
    ...(input.branchOf ? { branchOf: input.branchOf } : {}),
  };
  return reconcileEdges({ nodes: [...trace.nodes, node], edges: trace.edges }, idFactory);
}

export function addUnknownNode(trace: WorkspaceTrace, afterNodeId?: string | null, idFactory: () => string = generateId): WorkspaceTrace {
  return addNode(trace, { label: UNKNOWN_LABEL, kind: 'unknown', afterNodeId }, idFactory);
}

/** Removes the node and every branch under it. */
export function removeNode(trace: WorkspaceTrace, id: string, idFactory: () => string = generateId): WorkspaceTrace {
  const doomed = new Set<string>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const node of trace.nodes) {
      if (node.branchOf && doomed.has(node.branchOf) && !doomed.has(node.id)) {
        doomed.add(node.id);
        grew = true;
      }
    }
  }
  return reconcileEdges(
    { nodes: trace.nodes.filter((n) => !doomed.has(n.id)), edges: trace.edges.filter((e) => !doomed.has(e.from) && !doomed.has(e.to)) },
    idFactory
  );
}

export function moveNode(trace: WorkspaceTrace, id: string, direction: 'up' | 'down', idFactory: () => string = generateId): WorkspaceTrace {
  const node = trace.nodes.find((n) => n.id === id);
  if (!node) throw new Error(`Trace node not found: ${id}`);
  const siblings = node.branchOf ? branchesOf(trace, node.branchOf) : mainSequence(trace);
  const index = siblings.findIndex((n) => n.id === id);
  const target = direction === 'up' ? index - 1 : index + 1;
  if (target < 0 || target >= siblings.length) return trace;
  const other = siblings[target];
  const nodes = trace.nodes.map((n) =>
    n.id === node.id ? { ...n, order: other.order } : n.id === other.id ? { ...n, order: node.order } : n
  );
  return reconcileEdges({ nodes, edges: trace.edges }, idFactory);
}

export function updateNode(
  trace: WorkspaceTrace,
  id: string,
  patch: Partial<Pick<TraceNode, 'label' | 'kind' | 'evidenceIds'>>
): WorkspaceTrace {
  if (!trace.nodes.some((n) => n.id === id)) throw new Error(`Trace node not found: ${id}`);
  return {
    ...trace,
    nodes: trace.nodes.map((n) => {
      if (n.id !== id) return n;
      const next = { ...n, ...patch };
      if (patch.label !== undefined) next.label = patch.label.trim() || (next.kind === 'unknown' ? UNKNOWN_LABEL : n.label);
      if (patch.evidenceIds) next.evidenceIds = [...new Set(patch.evidenceIds)];
      return next;
    }),
  };
}

export function updateEdge(
  trace: WorkspaceTrace,
  id: string,
  patch: Partial<Pick<TraceEdge, 'claim' | 'evidenceIds' | 'override'>>
): WorkspaceTrace {
  if (!trace.edges.some((e) => e.id === id)) throw new Error(`Trace edge not found: ${id}`);
  if (patch.override && !patch.override.note.trim()) {
    throw new Error('Marking an edge contradicted needs a note saying what contradicts it');
  }
  return {
    ...trace,
    edges: trace.edges.map((e) => {
      if (e.id !== id) return e;
      const next: TraceEdge = { ...e };
      if (patch.claim !== undefined) {
        const claim = patch.claim.trim();
        if (claim) next.claim = claim;
        else delete next.claim;
      }
      if (patch.evidenceIds) next.evidenceIds = [...new Set(patch.evidenceIds)];
      if ('override' in patch) {
        if (patch.override) next.override = { verification: 'contradicted', note: patch.override.note.trim() };
        else delete next.override;
      }
      return next;
    }),
  };
}

/** Drop evidence ids that no longer exist in the workspace (after evidence deletion, if ever). */
export function pruneEvidenceRefs(trace: WorkspaceTrace, evidence: EvidenceItem[]): WorkspaceTrace {
  const ids = new Set(evidence.map((e) => e.id));
  return {
    nodes: trace.nodes.map((n) => ({ ...n, evidenceIds: n.evidenceIds.filter((id) => ids.has(id)) })),
    edges: trace.edges.map((e) => ({ ...e, evidenceIds: e.evidenceIds.filter((id) => ids.has(id)) })),
  };
}

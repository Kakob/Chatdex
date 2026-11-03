// SPEC-change-workspace §10 trace model (§16 CW-2): derivation table, structure ops, summary.
import { describe, expect, it } from 'vitest';
import {
  addNode,
  addUnknownNode,
  deriveEdgeVerification,
  deriveNodeSupport,
  emptyTrace,
  incomingEdge,
  mainSequence,
  moveNode,
  orderedNodes,
  pruneEvidenceRefs,
  reconcileEdges,
  removeNode,
  traceSummary,
  updateEdge,
  updateNode,
} from './trace';
import type { EvidenceItem } from '../../types/evidence';
import type { TraceEdge, WorkspaceTrace } from '../../types/preparedChange';

const iso = '2026-08-28T10:00:00.000Z';
const evidence: EvidenceItem[] = [
  { id: 'code', kind: 'code', createdAt: iso, origin: 'user', addedVia: 'search', repoKey: 'gh:a/b', sha: 'a'.repeat(40), path: 'x.ts', startLine: 1, endLine: 1, quote: 'x', quoteHash: 'h' },
  { id: 'test', kind: 'test_runtime', createdAt: iso, origin: 'user', addedVia: 'manual', source: 'manual', outcome: 'pass' },
  { id: 'commit', kind: 'intent_history', createdAt: iso, origin: 'user', addedVia: 'manual', source: 'commit', commitSha: 'b'.repeat(40) },
  { id: 'conv', kind: 'intent_history', createdAt: iso, origin: 'user', addedVia: 'manual', source: 'conversation', conversationId: 'c1' },
  { id: 'hyp', kind: 'human_hypothesis', createdAt: iso, origin: 'user', addedVia: 'manual', hypothesisId: 'h1' },
  { id: 'ai', kind: 'ai_inference', createdAt: iso, origin: 'ai', addedVia: 'assisted', runId: 'r', provider: 'anthropic', promptDigest: 'd', text: 't' },
];

const edge = (evidenceIds: string[], override?: TraceEdge['override']): TraceEdge => ({
  id: 'e',
  from: 'a',
  to: 'b',
  evidenceIds,
  origin: 'user',
  ...(override ? { override } : {}),
});

let counter = 0;
const ids = () => `id-${++counter}`;

describe('deriveEdgeVerification (D4, law §2.2)', () => {
  it.each([
    [[], 'unknown'],
    [['missing'], 'unknown'],
    [['ai'], 'ai_inference'],
    [['hyp'], 'hypothesis'],
    [['hyp', 'ai'], 'hypothesis'],
    [['conv'], 'unknown'],
    [['commit'], 'verified'],
    [['test'], 'verified'],
    [['code'], 'verified'],
    [['ai', 'code'], 'verified'],
    [['ai', 'hyp', 'conv'], 'hypothesis'],
  ] as const)('%j ⇒ %s', (attached, expected) => {
    expect(deriveEdgeVerification(edge([...attached]), evidence)).toBe(expected);
  });

  it('honours the single human override and never an AI one', () => {
    expect(deriveEdgeVerification(edge(['code'], { verification: 'contradicted', note: 'runtime disagrees' }), evidence)).toBe('contradicted');
    expect(deriveNodeSupport({ id: 'n', label: 'x', kind: 'function', evidenceIds: ['ai'], order: 0 }, evidence)).toBe('ai_inference');
  });
});

describe('structure', () => {
  it('builds a main sequence with one edge per adjacency and inserts after an anchor', () => {
    let trace = addNode(emptyTrace(), { label: 'SearchPage', kind: 'component', id: 'n1' }, ids);
    trace = addNode(trace, { label: 'ConversationsPage', kind: 'component', id: 'n3' }, ids);
    trace = addNode(trace, { label: 'navigate', kind: 'function', id: 'n2', afterNodeId: 'n1' }, ids);
    expect(mainSequence(trace).map((n) => [n.id, n.order])).toEqual([['n1', 0], ['n2', 1], ['n3', 2]]);
    expect(trace.edges.map((e) => `${e.from}→${e.to}`)).toEqual(['n1→n2', 'n2→n3']);
    expect(incomingEdge(trace, 'n1')).toBeUndefined();
    expect(incomingEdge(trace, 'n3')?.from).toBe('n2');
  });

  it('keeps edge claims/evidence across reconciliation and moves', () => {
    let trace = addNode(emptyTrace(), { label: 'a', kind: 'other', id: 'a' }, ids);
    trace = addNode(trace, { label: 'b', kind: 'other', id: 'b' }, ids);
    trace = addNode(trace, { label: 'c', kind: 'other', id: 'c' }, ids);
    const ab = trace.edges.find((e) => e.from === 'a' && e.to === 'b')!;
    trace = updateEdge(trace, ab.id, { claim: ' calls ', evidenceIds: ['code', 'code'] });
    expect(trace.edges.find((e) => e.id === ab.id)).toMatchObject({ claim: 'calls', evidenceIds: ['code'] });

    // Moving c above b breaks a→b; the a→c edge is fresh, b's old edge is gone.
    trace = moveNode(trace, 'c', 'up', ids);
    expect(mainSequence(trace).map((n) => n.id)).toEqual(['a', 'c', 'b']);
    expect(trace.edges.map((e) => `${e.from}→${e.to}`)).toEqual(['a→c', 'c→b']);
    expect(trace.edges.find((e) => e.id === ab.id)).toBeUndefined();
    // Moving back restores adjacency but not the dropped edge's data (edges are per adjacency, not per node).
    trace = moveNode(trace, 'c', 'down', ids);
    expect(trace.edges.map((e) => `${e.from}→${e.to}`)).toEqual(['a→b', 'b→c']);
    expect(moveNode(trace, 'a', 'up', ids)).toBe(trace);
  });

  it('supports branches and unknown nodes, and removes subtrees', () => {
    let trace = addNode(emptyTrace(), { label: 'router.push', kind: 'function', id: 'push' }, ids);
    trace = addUnknownNode(trace, undefined, ids);
    const unknown = mainSequence(trace)[1];
    expect(unknown).toMatchObject({ label: '???', kind: 'unknown' });
    trace = addNode(trace, { label: 'mobile restore', kind: 'behavior', id: 'mob', branchOf: 'push' }, ids);
    trace = addNode(trace, { label: 'deep', kind: 'other', id: 'deep', branchOf: 'mob' }, ids);
    expect(orderedNodes(trace).map((x) => [x.node.id, x.depth])).toEqual([
      ['push', 0],
      ['mob', 1],
      ['deep', 2],
      [unknown.id, 0],
    ]);
    expect(trace.edges.map((e) => `${e.from}→${e.to}`).sort()).toEqual([`mob→deep`, `push→${unknown.id}`, 'push→mob']);

    trace = removeNode(trace, 'mob', ids);
    expect(trace.nodes.map((n) => n.id)).toEqual(['push', unknown.id]);
    expect(trace.edges.map((e) => `${e.from}→${e.to}`)).toEqual([`push→${unknown.id}`]);
    expect(() => addNode(trace, { label: 'x', kind: 'other', branchOf: 'nope' }, ids)).toThrow(/parent/);
    expect(() => addNode(trace, { label: '', kind: 'other' }, ids)).toThrow(/label/);
  });

  it('updates nodes, requires a note for contradiction, and prunes dangling evidence', () => {
    let trace = addNode(emptyTrace(), { label: 'a', kind: 'other', id: 'a' }, ids);
    trace = addNode(trace, { label: 'b', kind: 'other', id: 'b' }, ids);
    trace = updateNode(trace, 'a', { label: '  ', kind: 'unknown' });
    expect(trace.nodes.find((n) => n.id === 'a')?.label).toBe('???');
    trace = updateNode(trace, 'a', { evidenceIds: ['code', 'gone'] });
    const e = trace.edges[0];
    expect(() => updateEdge(trace, e.id, { override: { verification: 'contradicted', note: ' ' } })).toThrow(/note/);
    trace = updateEdge(trace, e.id, { override: { verification: 'contradicted', note: 'seen otherwise' }, evidenceIds: ['gone'] });
    expect(deriveEdgeVerification(trace.edges[0], evidence)).toBe('contradicted');
    trace = updateEdge(trace, e.id, { override: undefined });
    expect(trace.edges[0].override).toBeUndefined();
    trace = pruneEvidenceRefs(trace, evidence);
    expect(trace.nodes.find((n) => n.id === 'a')?.evidenceIds).toEqual(['code']);
    expect(trace.edges[0].evidenceIds).toEqual([]);
  });

  it('reconcileEdges drops edges whose endpoints vanished', () => {
    const trace: WorkspaceTrace = {
      nodes: [{ id: 'a', label: 'a', kind: 'other', evidenceIds: [], order: 3 }],
      edges: [{ id: 'x', from: 'a', to: 'ghost', evidenceIds: [], origin: 'user' }],
    };
    expect(reconcileEdges(trace, ids)).toEqual({ nodes: [{ ...trace.nodes[0], order: 0 }], edges: [] });
  });
});

describe('traceSummary', () => {
  it('counts nodes, unknowns, and edges by derived state', () => {
    let trace = addNode(emptyTrace(), { label: 'a', kind: 'other', id: 'a' }, ids);
    trace = addNode(trace, { label: 'b', kind: 'other', id: 'b' }, ids);
    trace = addUnknownNode(trace, undefined, ids);
    trace = updateEdge(trace, trace.edges[0].id, { evidenceIds: ['code'] });
    expect(traceSummary(trace, evidence)).toEqual({
      nodes: 3,
      unknownNodes: 1,
      edges: 2,
      byVerification: { verified: 1, hypothesis: 0, ai_inference: 0, contradicted: 0, unknown: 1 },
    });
    expect(traceSummary(undefined, evidence).nodes).toBe(0);
  });
});

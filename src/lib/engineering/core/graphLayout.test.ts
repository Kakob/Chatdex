import { describe, expect, it } from 'vitest';
import { analyzeTypeScript } from './analyzeTypeScript';
import { layoutSourceConnections, layoutSourceOverview, sourceEdgePath } from './graphLayout';
import type { DerivedGraph } from './contracts';

const source = {
  files: [
    {
      path: 'src/math.ts',
      text: 'export function add(x: number, y: number) { return x + y; }\n' +
        'export function double(x: number) { return add(x, x); }\n',
    },
    {
      path: 'src/app.ts',
      text: "import { add, double } from './math.js';\n" +
        'export function compute() { return double(add(2, 3)); }\n',
    },
  ],
};
const graph = analyzeTypeScript(source);
const entity = (g: DerivedGraph, name: string) => {
  const found = g.entities.find((item) => item.name === name);
  if (!found) throw new Error('Unknown source entity: ' + name);
  return found;
};

describe('deterministic source graph visualization layout', () => {
  it('places actual source entities in file groups and preserves every real edge for a small graph', () => {
    const layout = layoutSourceOverview(graph);
    expect(layout.groups).toHaveLength(2);
    expect(layout.nodes).toHaveLength(graph.entities.length);
    expect(layout.omittedNodes).toBe(0);
    expect(layout.edges.map((edge) => edge.id)).toEqual(graph.relations.map((edge) => edge.id).sort());
    expect(layout.omittedEdges).toBe(0);
    expect(new Set(layout.nodes.map((node) => node.entity.id)).size).toBe(graph.entities.length);

    const groupByPath = new Map(layout.groups.map((group) => [group.path, group]));
    for (const node of layout.nodes) {
      const group = groupByPath.get(node.entity.path);
      expect(group).toBeDefined();
      expect(node.x).toBeGreaterThanOrEqual(group!.x);
      expect(node.y).toBeGreaterThan(group!.y);
      expect(node.x + node.width).toBeLessThanOrEqual(group!.x + group!.width);
      expect(node.y + node.height).toBeLessThanOrEqual(group!.y + group!.height);
    }
    expect(layout.width).toBeGreaterThan(350);
    expect(layout.height).toBeGreaterThan(140);
  });

  it('is stable when the same real graph is ordered differently by the caller', () => {
    const left = layoutSourceOverview(graph);
    const shuffled: DerivedGraph = {
      ...graph,
      entities: [...graph.entities].reverse(),
      relations: [...graph.relations].reverse(),
    };
    const right = layoutSourceOverview(shuffled);
    expect(right).toEqual(left);
  });

  it('focuses the selected entity and connects only its actual one-hop neighbors', () => {
    const center = entity(graph, 'compute');
    const layout = layoutSourceConnections(graph, center.id);
    expect(layout.groups).toEqual([]);
    expect(layout.nodes.some((node) => node.entity.id === center.id)).toBe(true);
    expect(layout.edges.length).toBeGreaterThan(0);
    expect(layout.edges.every((edge) => edge.fromId === center.id || edge.toId === center.id)).toBe(true);
    expect(layout.edges.every((edge) =>
      layout.nodes.some((node) => node.entity.id === edge.fromId) &&
      layout.nodes.some((node) => node.entity.id === edge.toId))).toBe(true);
    const link = layout.edges[0];
    const a = layout.nodes.find((node) => node.entity.id === link.fromId)!;
    const b = layout.nodes.find((node) => node.entity.id === link.toId)!;
    expect(sourceEdgePath(a, b)).toMatch(/^M .* C .*$/);
  });

  it('reports truncated entities and relationships rather than pretending to draw the full model', () => {
    const layout = layoutSourceOverview(graph, 2);
    expect(layout.nodes.length).toBe(2);
    expect(layout.omittedNodes).toBe(graph.entities.length - 2);
    expect(layout.omittedEdges).toBe(graph.relations.length - layout.edges.length);
    expect(layout.edges.every((edge) =>
      layout.nodes.some((node) => node.entity.id === edge.fromId) &&
      layout.nodes.some((node) => node.entity.id === edge.toId))).toBe(true);
    expect(() => layoutSourceOverview(graph, 0)).toThrow(/maxEntities/);
    expect(() => layoutSourceConnections(graph, 'invented')).toThrow(/absent/);
    expect(() => layoutSourceConnections(graph, entity(graph, 'add').id, 0)).toThrow(/maxNeighbors/);
  });
});

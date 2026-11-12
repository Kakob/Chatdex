import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { analyzeTypeScript } from './analyzeTypeScript';
import { fingerprintText, normalizeSnapshot, type SourceSnapshot } from './contracts';

const files: SourceSnapshot['files'] = [
  {
    path: 'src/library/math.ts',
    text: [
      'export interface Pair { left: number; right: number }',
      'export type Mode = "add" | "subtract";',
      'export function sum(a: number, b: number): number { return a + b; }',
      'export class Calculator {',
      '  value = 0;',
      '  operate(input: Pair): number { return sum(input.left, input.right); }',
      '}',
    ].join('\n'),
  },
  {
    path: 'src/app.ts',
    text: [
      "import { Calculator, sum, type Pair } from './library/math.js';",
      'export function compute(pair: Pair) {',
      '  const instance = new Calculator();',
      '  return instance.operate(pair) + sum(1, 2);',
      '}',
    ].join('\n'),
  },
];

function find(graph: ReturnType<typeof analyzeTypeScript>, name: string, path?: string) {
  const item = graph.entities.find((entity) => entity.name === name && (!path || entity.path === path));
  expect(item, 'Expected source entity ' + name).toBeDefined();
  return item!;
}
function linked(graph: ReturnType<typeof analyzeTypeScript>, kind: string, source: string, target: string) {
  return graph.relations.some((rel) => rel.kind === kind && rel.fromId === source && rel.toId === target);
}

describe('portable deterministic TypeScript analyzer', () => {
  it('accepts empty input and returns a stable serializable empty graph', () => {
    const empty = analyzeTypeScript({ files: [] });
    expect(empty.schemaVersion).toBe('chatdex.derived-source-graph/v1');
    expect(empty.entities).toEqual([]);
    expect(empty.relations).toEqual([]);
    expect(empty.diagnostics).toEqual([]);
    expect(JSON.parse(JSON.stringify(empty))).toEqual(empty);
    expect(analyzeTypeScript({ files: [], revision: 'manual-1' }).revision).toBe('manual-1');
  });

  it('reconstructs declarations, membership, exports and calls across arbitrary modules', () => {
    const graph = analyzeTypeScript({ files });
    expect(graph.diagnostics).toEqual([]);
    expect(graph.entities.filter((e) => e.kind === 'module')).toHaveLength(2);

    const math = find(graph, 'math.ts');
    const app = find(graph, 'app.ts');
    const pair = find(graph, 'Pair', 'src/library/math.ts');
    const mode = find(graph, 'Mode');
    const sum = find(graph, 'sum');
    const calculator = find(graph, 'Calculator');
    const method = find(graph, 'operate');
    const property = find(graph, 'value');
    const compute = find(graph, 'compute');

    expect([pair.kind, mode.kind, sum.kind, calculator.kind, method.kind, property.kind])
      .toEqual(['interface', 'type', 'function', 'class', 'method', 'property']);
    expect(calculator.parentId).toBe(math.id);
    expect(method.parentId).toBe(calculator.id);
    expect(property.parentId).toBe(calculator.id);
    expect(sum.exported).toBe(true);
    expect(linked(graph, 'contains', math.id, sum.id)).toBe(true);
    expect(linked(graph, 'exports', math.id, pair.id)).toBe(true);
    expect(linked(graph, 'imports', app.id, math.id)).toBe(true);
    expect(linked(graph, 'calls', compute.id, sum.id)).toBe(true);
    expect(linked(graph, 'calls', method.id, sum.id)).toBe(true);
    expect(linked(graph, 'references', compute.id, pair.id)).toBe(true);
    expect(sum.location.path).toBe('src/library/math.ts');
    expect(sum.location.startLine).toBe(3);
    expect(sum.location.startColumn).toBe(1);
    expect(sum.location.endOffset).toBeGreaterThan(sum.location.startOffset);
    expect(graph.entities.map((x) => x.id)).toEqual([...graph.entities.map((x) => x.id)].sort());
  });

  it('is deterministic independent of caller file ordering and serializes the exact same graph', () => {
    const left = analyzeTypeScript({ files, revision: 'rev-1' });
    const right = analyzeTypeScript({ files: [...files].reverse(), revision: 'rev-1' });
    expect(right).toEqual(left);
    expect(JSON.stringify(right)).toEqual(JSON.stringify(left));
    expect(left.revision).toBe('rev-1');
    expect(left.snapshotFingerprint).not.toBe(fingerprintText(''));
  });

  it('keeps a stable symbol path/signature across a body edit and changes its body fingerprint', () => {
    const before = analyzeTypeScript({ files });
    const modified = files.map((f) => ({ ...f, text: f.text.replace('return a + b', 'return a - b') }));
    const after = analyzeTypeScript({ files: modified });
    const oldSum = find(before, 'sum');
    const newSum = find(after, 'sum');
    expect(newSum.id).toBe(oldSum.id);
    expect(newSum.signatureFingerprint).toBe(oldSum.signatureFingerprint);
    expect(newSum.bodyFingerprint).not.toBe(oldSum.bodyFingerprint);
    expect(after.snapshotFingerprint).not.toBe(before.snapshotFingerprint);
  });

  it('reports invalid syntax, missing relative imports and unsupported files without fabricating symbols', () => {
    const graph = analyzeTypeScript({ files: [
      { path: 'README.md', text: '# Contents' },
      { path: 'src/main.ts', text: "import { x } from './missing';\nexport const ok = true;\nexport function broken( {" },
      { path: 'src/third-party.ts', text: "import { useState } from 'react';\nexport const value = 3;" },
    ] });
    expect(graph.skippedPaths).toEqual(['README.md']);
    expect(graph.diagnostics.some((x) => x.kind === 'syntax' && x.path === 'src/main.ts')).toBe(true);
    expect(graph.diagnostics.some((x) => x.kind === 'unresolved-import' && x.message.includes('./missing'))).toBe(true);
    expect(graph.diagnostics.some((x) => x.kind === 'unsupported' && x.path === 'README.md')).toBe(true);
    expect(graph.diagnostics.some((x) => x.message.includes('react'))).toBe(false);
    expect(graph.entities.some((x) => x.name === 'missing')).toBe(false);
  });

  it('handles independent typescript and TSX input without project-specific adapters', () => {
    const code = [
      'interface State { ready: boolean }',
      'export class Controller {',
      '  constructor(private state: State) {}',
      '  toggle(): State { return { ready: !this.state.ready }; }',
      '}',
    ].join('\n');
    const graph = analyzeTypeScript({ files: [
      { path: 'src/control.ts', text: code },
      { path: 'src/widget.tsx', text: 'export function Widget() { return <section>Hello</section>; }' },
    ] });
    expect(graph.diagnostics).toEqual([]);
    expect(find(graph, 'Controller').kind).toBe('class');
    expect(find(graph, 'constructor').kind).toBe('constructor');
    expect(find(graph, 'toggle').kind).toBe('method');
    expect(find(graph, 'Widget').kind).toBe('function');
  });

  it('enforces exact, local-only source paths with bounded input and no external files', () => {
    expect(() => normalizeSnapshot({ files: [{ path: '../secret.ts', text: 'x' }] })).toThrow();
    expect(() => normalizeSnapshot({ files: [{ path: '/etc/passwd', text: 'x' }] })).toThrow();
    expect(() => normalizeSnapshot({ files: [{ path: 'a\\b.ts', text: 'x' }] })).toThrow();
    expect(() => normalizeSnapshot({ files: [
      { path: 'x.ts', text: 'x' }, { path: 'x.ts', text: 'y' },
    ] })).toThrow(/Duplicate/);
    expect(() => normalizeSnapshot({ files: [{ path: 'x.ts', text: 'a'.repeat(1_000_001) }] })).toThrow(/limit/);
  });
});

describe('existing source code through the SAME analyzer', () => {
  const fromRepo = (path: string): string => readFileSync(
    new URL('../../../../' + path, import.meta.url), 'utf8',
  );

  it('analyzes the actual in-repository event queue and todo reducer without specialized mappings', () => {
    const graph = analyzeTypeScript({ files: [
      { path: 'examples/event-queue/src/queue.ts', text: fromRepo('examples/event-queue/src/queue.ts') },
      { path: 'examples/event-queue/src/worker.ts', text: fromRepo('examples/event-queue/src/worker.ts') },
      { path: 'examples/event-queue/src/harness.ts', text: fromRepo('examples/event-queue/src/harness.ts') },
      { path: 'src/lib/engineering/todoModel.ts', text: fromRepo('src/lib/engineering/todoModel.ts') },
    ] });
    expect(find(graph, 'EventQueue').kind).toBe('class');
    expect(find(graph, 'enqueue', 'examples/event-queue/src/queue.ts').parentId).toBe(find(graph, 'EventQueue').id);
    expect(find(graph, 'claim', 'examples/event-queue/src/queue.ts').parentId).toBe(find(graph, 'EventQueue').id);
    expect(find(graph, 'reapExpired', 'examples/event-queue/src/queue.ts').parentId).toBe(find(graph, 'EventQueue').id);
    expect(find(graph, 'workOnce').kind).toBe('function');
    expect(find(graph, 'todoTransition').kind).toBe('function');
    expect(find(graph, 'TodoState').kind).toBe('interface');
    expect(graph.entities.length).toBeGreaterThan(25);
    expect(graph.relations.some((rel) => rel.kind === 'imports')).toBe(true);
    expect(graph.diagnostics.filter((d) => d.kind === 'syntax')).toEqual([]);
  });
});

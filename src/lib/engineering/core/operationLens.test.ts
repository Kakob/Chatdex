import { describe, expect, it } from 'vitest';
import { analyzeTypeScript } from './analyzeTypeScript';
import { humanizeSymbol, inspectOperation, sourceOperations } from './operationLens';
import { analyzeBundledExample } from './fromBundled';

describe('source-derived operation lens', () => {
  it('extracts real Todo List operations, inputs, dispatch cases and direct call relationships', async () => {
    const { graph, sourceFiles } = await analyzeBundledExample('todo-list');
    const ops = sourceOperations(graph);
    expect(ops.length).toBeGreaterThan(4);
    expect(ops.every((op) => !op.entity.path.endsWith('.test.ts'))).toBe(true);
    expect(ops.some((op) => op.entity.name === 'TodoState')).toBe(false);
    expect(ops.some((op) => op.entity.name === 'todoTransition')).toBe(true);
    const transition = ops.find((op) => op.entity.name === 'todoTransition')!.entity;
    const details = inspectOperation(graph, sourceFiles, transition.id)!;
    expect(details.inputs.some((input) => input.includes('TodoState'))).toBe(true);
    expect(details.inputs.some((input) => input.includes('TodoAction'))).toBe(true);
    expect(details.returnType).toContain('TodoState');
    expect(details.decisions.some((d) => d.kind === 'switch' && d.expression.includes('action.type')))
      .toBe(true);
    expect(details.decisions.some((d) => d.kind === 'case' && d.expression.includes('toggle')))
      .toBe(true);
    expect(details.calls.some((e) => e.name === 'addTask')).toBe(true);
    expect(details.calls.some((e) => e.name === 'toggleTask')).toBe(true);
    expect(details.mentionedInTests.some((path) => path.endsWith('todoModel.test.ts'))).toBe(true);
  });

  it('finds real class methods and conditions in the Event Queue without authored domain claims', async () => {
    const { graph, sourceFiles } = await analyzeBundledExample('event-queue');
    const ops = sourceOperations(graph);
    const enqueue = ops.find((op) => op.entity.name === 'enqueue' &&
      op.entity.path.endsWith('queue.ts'));
    expect(enqueue).toBeDefined();
    expect(enqueue?.entity.kind).toBe('method');
    const detail = inspectOperation(graph, sourceFiles, enqueue!.entity.id)!;
    expect(detail.entity.path).toContain('queue.ts');
    expect(detail.inputs.length).toBeGreaterThan(0);
    expect(detail.decisions.every((d) => Number.isInteger(d.line) && d.expression.length > 0)).toBe(true);
    expect(humanizeSymbol('reapExpired')).toBe('reap Expired');
  });

  it('does not invent edges, behavior or tests for isolated operations', () => {
    const files = [{ path: 'src/lone.ts', text: 'export function ping(x: number) { return x + 1; }' }];
    const graph = analyzeTypeScript({ files });
    const ping = sourceOperations(graph).find((op) => op.entity.name === 'ping')!.entity;
    const detail = inspectOperation(graph, files, ping.id)!;
    expect(detail.calls).toEqual([]);
    expect(detail.calledBy).toEqual([]);
    expect(detail.decisions).toEqual([]);
    expect(detail.mentionedInTests).toEqual([]);
    expect(inspectOperation(graph, files, 'made-up')).toBeNull();
  });
});

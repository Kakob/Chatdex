import { describe, expect, it } from 'vitest';
import { bundledEngineeringSources, bundledExampleSourcePaths } from '../bundledSources';
import { analyzeBundledExample } from './fromBundled';

describe('bundled example source analysis', () => {
  it('derives the Todo List structure from shipped source without a GitHub binding', async () => {
    const output = await analyzeBundledExample('todo-list');
    expect(output.graph.revision).toBeUndefined();
    expect(output.bundled.kind).toBe('todo-list');
    expect(output.bundled.label).toContain('bundled with Chatdex');
    expect(output.coverage.partial).toBe(false);
    expect(output.coverage.analyzedCount).toBe(2);
    expect(output.sourceFiles.map((source) => source.path)).toEqual(bundledExampleSourcePaths['todo-list']);
    for (const symbol of ['TodoState', 'TodoItem', 'TodoAction', 'addTask', 'toggleTask', 'todoTransition']) {
      expect(output.graph.entities.some((entity) => entity.name === symbol), symbol).toBe(true);
    }
    expect(output.graph.entities.some((entity) => entity.kind === 'module' && entity.path.endsWith('todoModel.test.ts'))).toBe(true);
    expect(output.graph.diagnostics.filter((d) => d.kind === 'syntax')).toEqual([]);
    expect(output.graph.relations.some((edge) => edge.kind === 'calls')).toBe(true);
  });

  it('derives the Event Queue structure from all bundled source and test files', async () => {
    const output = await analyzeBundledExample('event-queue');
    expect(output.graph.revision).toBeUndefined();
    expect(output.bundled.kind).toBe('event-queue');
    expect(output.coverage.analyzedCount).toBe(5);
    expect(output.coverage.partial).toBe(false);
    expect(output.sourceFiles.map((file) => file.path)).toEqual(bundledExampleSourcePaths['event-queue']);
    for (const symbol of ['EventQueue', 'enqueue', 'claim', 'reapExpired', 'workOnce']) {
      expect(output.graph.entities.some((entity) => entity.name === symbol), symbol).toBe(true);
    }
    expect(output.graph.relations.some((edge) => edge.kind === 'imports')).toBe(true);
    expect(output.graph.diagnostics.filter((d) => d.kind === 'syntax')).toEqual([]);
    expect(output.graph.entities.some((entity) => entity.path.endsWith('harness.ts'))).toBe(true);
    expect(output.graph.entities.some((entity) => entity.path.endsWith('queue.test.ts'))).toBe(true);
  });

  it('never presents these bundled bytes as a pinned repository snapshot', async () => {
    for (const kind of ['event-queue', 'todo-list'] as const) {
      const result = await analyzeBundledExample(kind);
      expect(result).not.toHaveProperty('repository');
      expect(result.graph).not.toHaveProperty('revision');
      expect(result.bundled.kind).toBe(kind);
      for (const file of result.sourceFiles) {
        expect(file.text).toBe(bundledEngineeringSources[file.path]);
        expect(file.text.length).toBeGreaterThan(0);
      }
    }
  });
});

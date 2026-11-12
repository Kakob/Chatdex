import { beforeEach, describe, expect, it } from 'vitest';
import { clearAllData, db } from '../db';
import { createHumanProject } from '../db/understanding';
import { createEngineeringExampleProjects, EVENT_QUEUE_PROJECT_ID, TODO_LIST_PROJECT_ID, exampleConceptId } from './demoProjects';
import { engineeringModelDb, installExampleTransitions, loadEngineeringModel, createModelRelationship, proposeModelEdit } from './modelStore';
import { projectGraph, previewModelImpact, relationshipsOf } from './modelGraph';

beforeEach(async () => {
  await clearAllData();
  await engineeringModelDb.proposals.clear();
  await engineeringModelDb.transitions.clear();
  await engineeringModelDb.sourceBindings.clear();
});

describe('generic model graph', () => {
  it('projects both authored systems and their source-backed change candidates with the SAME functions', async () => {
    await createEngineeringExampleProjects();
    await installExampleTransitions(EVENT_QUEUE_PROJECT_ID);
    await installExampleTransitions(TODO_LIST_PROJECT_ID);
    for (const projectId of [EVENT_QUEUE_PROJECT_ID, TODO_LIST_PROJECT_ID]) {
      const model = await loadEngineeringModel(projectId);
      const graph = projectGraph(model);
      expect(graph.nodes.length).toBeGreaterThan(5);
      expect(graph.edges.length).toBeGreaterThan(4);
      expect(graph.danglingEdgeIds).toEqual([]);
      const root = graph.nodes.find((n) => n.parentId === null);
      expect(root).toBeDefined();
      expect(root?.children.length).toBeGreaterThan(0);
      const nested = graph.nodes.find((n) => n.depth > 1);
      expect(nested).toBeDefined();
    }
    const queue = await loadEngineeringModel(EVENT_QUEUE_PROJECT_ID);
    const leased = exampleConceptId('event-queue', 'leased');
    const impacted = previewModelImpact(queue, leased);
    expect(impacted.candidateNodeIds).toContain(exampleConceptId('event-queue', 'retry'));
    expect(impacted.sourceBindings.some((s) => s.path.endsWith('/queue.ts'))).toBe(true);
    expect(impacted.status).toBe('potential-only');

    const todo = await loadEngineeringModel(TODO_LIST_PROJECT_ID);
    const active = exampleConceptId('todo-list', 'active');
    const impact = previewModelImpact(todo, active);
    expect(impact.candidateNodeIds).toContain(exampleConceptId('todo-list', 'completed'));
    expect(impact.sourceBindings.some((s) => s.path.includes('todoModel.ts'))).toBe(true);
    expect(relationshipsOf(todo, active).some((e) => e.title === 'Complete task')).toBe(true);
  });

  it('supports a third arbitrary project with no app adapter, and preserves model-only proposal boundaries', async () => {
    const project = await createHumanProject({ name: 'Chatdex architecture', description: 'Third test project' });
    const now = new Date();
    const nodes = [
      { id: 'system', title: 'Chatdex', parentRegionId: null },
      { id: 'explorer', title: 'Explorer', parentRegionId: 'system' },
      { id: 'loader', title: 'Model loader', parentRegionId: 'system' },
      { id: 'inspector', title: 'Inspector', parentRegionId: 'explorer' },
    ];
    for (const [order, node] of nodes.entries()) {
      await db.landscapeRegions.add({
        ...node, projectId: project.id, kind: 'component', summary: node.title,
        order, memberObjectIds: [], pinnedObjectIds: [], createdAt: now, updatedAt: now,
      });
    }
    const dep = await createModelRelationship({
      projectId: project.id, fromConceptId: 'explorer', toConceptId: 'loader',
      kind: 'depends_on', title: 'Reads model', description: 'Explorer depends on loader',
    });
    const second = await createModelRelationship({
      projectId: project.id, fromConceptId: 'inspector', toConceptId: 'loader',
      kind: 'depends_on', title: 'Inspector reads model', description: 'UI uses loader',
    });
    expect(dep.origin).toBe('manual');
    const model = await loadEngineeringModel(project.id);
    expect(model.kind).toBeNull();
    expect(model.transitions).toHaveLength(2);
    const graph = projectGraph(model);
    expect(graph.nodes.find((node) => node.id === 'inspector')?.depth).toBe(2);
    expect(graph.edges.map((e) => e.id)).toEqual([dep.id, second.id]);

    const impact = previewModelImpact(model, 'explorer');
    expect(impact.candidateNodeIds).toContain('loader');
    expect(impact.relevantRelationIds).toContain(dep.id);
    expect(impact.status).toBe('potential-only');
    expect(() => previewModelImpact(model, 'absent')).toThrow(/not found/);
    expect(() => previewModelImpact(model, 'explorer', -1)).toThrow(/depth/);

    await proposeModelEdit(project.id, 'explorer', { title: 'Living explorer', description: 'Only a proposal' });
    const next = await loadEngineeringModel(project.id);
    expect(projectGraph(next).nodes.find((node) => node.id === 'explorer')?.title).toBe('Living explorer');
    expect((await db.landscapeRegions.get('explorer'))?.title).toBe('Explorer');
  });

  it('reports dangling relations instead of inventing their missing endpoints', async () => {
    const project = await createHumanProject({ name: 'Inconsistent model' });
    const now = new Date();
    for (const id of ['a', 'b']) {
      await db.landscapeRegions.add({ id, projectId: project.id, parentRegionId: null, title: id,
        order: id === 'a' ? 0 : 1, memberObjectIds: [], pinnedObjectIds: [], createdAt: now, updatedAt: now });
    }
    const edge = await createModelRelationship({
      projectId: project.id, fromConceptId: 'a', toConceptId: 'b', kind: 'flow',
      title: 'Flow', description: 'Example',
    });
    await db.landscapeRegions.delete('b');
    const graph = projectGraph(await loadEngineeringModel(project.id));
    expect(graph.danglingEdgeIds).toEqual([edge.id]);
    expect(graph.edges).toHaveLength(0);
    expect(graph.nodes).toHaveLength(1);
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import { clearAllData, db } from '../db';
import { createEngineeringExampleProjects, EVENT_QUEUE_PROJECT_ID, TODO_LIST_PROJECT_ID, exampleConceptId } from './demoProjects';
import { exampleTransitionId } from './modelCatalog';
import {
  ENGINEERING_MODEL_DB_NAME,
  engineeringModelDb,
  installExampleTransitions,
  loadEngineeringModel,
  proposeModelEdit,
  relationForNode,
  withdrawModelEdit,
} from './modelStore';

beforeEach(async () => {
  await clearAllData();
  await engineeringModelDb.proposals.clear();
  await engineeringModelDb.transitions.clear();
});

describe('shared model and proposal events', () => {
  it('installs typed stable relationships once, scoped to both native projects', async () => {
    expect(engineeringModelDb.name).toBe(ENGINEERING_MODEL_DB_NAME);
    expect(engineeringModelDb.name).not.toBe(db.name);
    await createEngineeringExampleProjects();
    expect(await installExampleTransitions(EVENT_QUEUE_PROJECT_ID)).toBe(9);
    expect(await installExampleTransitions(TODO_LIST_PROJECT_ID)).toBe(6);
    expect(await installExampleTransitions(EVENT_QUEUE_PROJECT_ID)).toBe(0);
    const queue = await loadEngineeringModel(EVENT_QUEUE_PROJECT_ID);
    const todo = await loadEngineeringModel(TODO_LIST_PROJECT_ID);
    expect(queue.concepts).toHaveLength(10);
    expect(queue.transitions).toHaveLength(9);
    expect(todo.concepts).toHaveLength(7);
    expect(todo.transitions).toHaveLength(6);
    expect(relationForNode(queue, 'leased').map((t) => t.title)).toContain('Pending → leased');
    expect(relationForNode(todo, 'completed').map((t) => t.title)).toContain('Reopen task');
    expect(queue.transitions.every((edge) => edge.projectId === EVENT_QUEUE_PROJECT_ID)).toBe(true);
  });

  it('persists proposed concept wording without changing the running or canonical understanding', async () => {
    await createEngineeringExampleProjects();
    await installExampleTransitions(EVENT_QUEUE_PROJECT_ID);
    const id = exampleConceptId('event-queue', 'leased');
    const before = await db.landscapeRegions.get(id);
    const event = await proposeModelEdit(EVENT_QUEUE_PROJECT_ID, id, {
      title: 'Reserved work', description: 'Proposed: the worker temporarily owns the job.',
    });
    expect(event.action).toBe('propose');
    expect(event.sequence).toBe(1);
    const after = await loadEngineeringModel(EVENT_QUEUE_PROJECT_ID);
    expect(after.elements[id]).toMatchObject({
      current: { title: 'Leased' },
      proposed: { title: 'Reserved work' },
      stale: false,
    });
    expect(after.elements[id].revisions).toHaveLength(1);
    expect(await db.landscapeRegions.get(id)).toEqual(before);
    expect(await db.understandingObjects.count()).toBe(0);

    const update = await proposeModelEdit(EVENT_QUEUE_PROJECT_ID, id, {
      title: 'Claimed work', description: 'Reworded model-only proposal',
    });
    expect(update.sequence).toBe(2);
    expect((await loadEngineeringModel(EVENT_QUEUE_PROJECT_ID)).elements[id].revisions).toHaveLength(2);
    const withdrawn = await withdrawModelEdit(EVENT_QUEUE_PROJECT_ID, id);
    expect(withdrawn.sequence).toBe(3);
    const restored = (await loadEngineeringModel(EVENT_QUEUE_PROJECT_ID)).elements[id];
    expect(restored.proposed).toBeUndefined();
    expect(restored.revisions.map((r) => r.action)).toEqual(['propose', 'propose', 'withdraw']);
  });

  it('supports a proposed transition edit, preserving the authored edge and history', async () => {
    await createEngineeringExampleProjects();
    await installExampleTransitions(TODO_LIST_PROJECT_ID);
    const id = exampleTransitionId('todo-list', 'reopen');
    const before = await engineeringModelDb.transitions.get(id);
    expect(before?.title).toBe('Reopen task');
    await proposeModelEdit(TODO_LIST_PROJECT_ID, id, {
      title: 'Reopen after review',
      description: 'Proposed requirement, not yet in the reducer.',
    });
    const view = await loadEngineeringModel(TODO_LIST_PROJECT_ID);
    expect(view.elements[id]).toMatchObject({
      current: { title: 'Reopen task' },
      proposed: { title: 'Reopen after review' },
      stale: false,
    });
    expect(await engineeringModelDb.transitions.get(id)).toEqual(before);
  });

  it('refuses cross-project edits and refuses stale proposals until withdrawn', async () => {
    await createEngineeringExampleProjects();
    await installExampleTransitions(EVENT_QUEUE_PROJECT_ID);
    await installExampleTransitions(TODO_LIST_PROJECT_ID);
    const taskId = exampleConceptId('todo-list', 'active');
    await expect(proposeModelEdit(EVENT_QUEUE_PROJECT_ID, taskId, { title: 'Hacked', description: '' }))
      .rejects.toThrow(/does not exist in this project/);
    await expect(proposeModelEdit(EVENT_QUEUE_PROJECT_ID, exampleTransitionId('todo-list', 'complete'), { title: 'Hacked', description: '' }))
      .rejects.toThrow(/does not exist in this project/);
    await expect(proposeModelEdit(TODO_LIST_PROJECT_ID, taskId, { title: '', description: 'No title' }))
      .rejects.toThrow(/Title is required/);

    await proposeModelEdit(TODO_LIST_PROJECT_ID, taskId, { title: 'My task state', description: 'Draft' });
    await db.landscapeRegions.update(taskId, { title: 'Edited independently' });
    expect((await loadEngineeringModel(TODO_LIST_PROJECT_ID)).elements[taskId].stale).toBe(true);
    await expect(proposeModelEdit(TODO_LIST_PROJECT_ID, taskId, { title: 'Next draft', description: '' }))
      .rejects.toThrow(/project changed/);
    await withdrawModelEdit(TODO_LIST_PROJECT_ID, taskId);
    const newDraft = await proposeModelEdit(TODO_LIST_PROJECT_ID, taskId, { title: 'Fresh draft', description: '' });
    expect(newDraft.baseline.title).toBe('Edited independently');
  });
});

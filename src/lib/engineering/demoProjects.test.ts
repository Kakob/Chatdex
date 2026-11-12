import { beforeEach, describe, expect, it } from 'vitest';
import { clearAllData, db } from '../db';
import { createHumanProject } from '../db/understanding';
import { createEngineeringExampleProjects, engineeringExampleKind, EVENT_QUEUE_PROJECT_ID, TODO_LIST_PROJECT_ID, exampleConceptId } from './demoProjects';

beforeEach(async () => { await clearAllData(); });

describe('engineering example project install', () => {
  it('creates both examples in native Chatdex project + landscape tables only on explicit request', async () => {
    expect(await db.understandingProjects.count()).toBe(0);
    const first = await createEngineeringExampleProjects();
    expect(first).toEqual({ created: 2, queueProjectId: EVENT_QUEUE_PROJECT_ID, todoProjectId: TODO_LIST_PROJECT_ID });
    const projects = await db.understandingProjects.toArray();
    expect(projects).toHaveLength(2);
    expect(projects.every((project) => project.reviewState === 'accepted')).toBe(true);
    expect((await db.landscapeRegions.where('projectId').equals(EVENT_QUEUE_PROJECT_ID).toArray()).length).toBe(10);
    expect((await db.landscapeRegions.where('projectId').equals(TODO_LIST_PROJECT_ID).toArray()).length).toBe(7);
    expect((await db.landscapeRegions.get(exampleConceptId('event-queue', 'leased')))?.parentRegionId)
      .toBe(exampleConceptId('event-queue', 'queue'));
    expect(engineeringExampleKind(EVENT_QUEUE_PROJECT_ID)).toBe('event-queue');
    expect(engineeringExampleKind(TODO_LIST_PROJECT_ID)).toBe('todo-list');
    expect(engineeringExampleKind('ordinary-project')).toBeNull();
    expect(await db.understandingObjects.count()).toBe(0);
    expect(await db.conversations.count()).toBe(0);
  });

  it('is idempotent, preserves edited concepts and does not touch unrelated projects', async () => {
    const personal = await createHumanProject({ name: 'My existing project' });
    await createEngineeringExampleProjects();
    await db.landscapeRegions.update(exampleConceptId('todo-list', 'input'), { title: 'My edited input' });
    const result = await createEngineeringExampleProjects();
    expect(result.created).toBe(0);
    expect((await db.landscapeRegions.get(exampleConceptId('todo-list', 'input')))?.title).toBe('My edited input');
    expect(await db.understandingProjects.get(personal.id)).toMatchObject({ name: 'My existing project' });
    expect(await db.understandingProjects.count()).toBe(3);
    expect(await db.landscapeRegions.count()).toBe(17);
  });
});

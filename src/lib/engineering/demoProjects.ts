/**
 * Explicitly installed engineering examples in the normal project table.
 *
 * These IDs are stable so repeated clicks are idempotent. We NEVER seed
 * them on app startup, touch unrelated projects, or claim these authored
 * demo models came from the user's code or conversation history.
 */
import { db } from '../db/schema';
import type { UnderstandingProject } from '../../types/understanding';

export const EVENT_QUEUE_PROJECT_ID = 'sample-engineering-event-queue-v1';
export const TODO_LIST_PROJECT_ID = 'sample-engineering-todo-list-v1';

export type EngineeringExampleKind = 'event-queue' | 'todo-list';

const examples: Array<{ id: string; kind: EngineeringExampleKind; name: string; description: string }> = [
  {
    id: EVENT_QUEUE_PROJECT_ID,
    kind: 'event-queue',
    name: 'Event Queue · engineering example',
    description: 'Authored example model of the actual in-memory TypeScript event queue. Experiment with real jobs and controlled failure/recovery.',
  },
  {
    id: TODO_LIST_PROJECT_ID,
    kind: 'todo-list',
    name: 'Todo List · engineering example',
    description: 'Authored example model of a small todo application. Change real task state through a pure reducer and inspect its implementation.',
  },
];

export function engineeringExampleKind(projectId: string | undefined): EngineeringExampleKind | null {
  return examples.find((example) => example.id === projectId)?.kind ?? null;
}

export async function createEngineeringExampleProjects(): Promise<{ created: number; queueProjectId: string; todoProjectId: string }> {
  let created = 0;
  await db.transaction('rw', db.understandingProjects, async () => {
    for (const example of examples) {
      const existing = await db.understandingProjects.get(example.id);
      // Do not overwrite an existing (possibly edited) demo project, even on
      // a new version of the example. Only missing projects are inserted.
      if (existing) continue;
      const now = new Date();
      const project: UnderstandingProject = {
        id: example.id,
        name: example.name,
        description: example.description,
        origin: 'user', // user explicitly invoked the demo installation
        reviewState: 'accepted',
        createdAt: now,
        updatedAt: now,
      };
      await db.understandingProjects.add(project);
      created += 1;
    }
  });
  return { created, queueProjectId: EVENT_QUEUE_PROJECT_ID, todoProjectId: TODO_LIST_PROJECT_ID };
}

/**
 * Explicitly installed engineering examples in the normal project table.
 *
 * These IDs are stable so repeated clicks are idempotent. We NEVER seed
 * them on app startup, touch unrelated projects, or claim these authored
 * demo models came from the user's code or conversation history.
 */
import { db } from '../db/schema';
import type { UnderstandingProject } from '../../types/understanding';
import type { LandscapeRegion } from '../../types/landscape';

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

interface ExampleNode { id: string; title: string; summary: string; kind: string; parent?: string }

const MODELS: Record<EngineeringExampleKind, ExampleNode[]> = {
  'event-queue': [
    { id: 'root', title: 'Event Queue', kind: 'system', summary: 'In-memory queue with leased delivery, retries and fault tests' },
    { id: 'producer', title: 'Producer', kind: 'component', summary: 'Enqueues jobs', parent: 'root' },
    { id: 'queue', title: 'Queue', kind: 'component', summary: 'Keeps jobs in memory', parent: 'root' },
    { id: 'worker', title: 'Worker', kind: 'component', summary: 'Claims and acknowledges work', parent: 'root' },
    { id: 'pending', title: 'Pending', kind: 'state', summary: 'Waiting to be claimed', parent: 'queue' },
    { id: 'leased', title: 'Leased', kind: 'state', summary: 'Temporarily owned by a worker', parent: 'queue' },
    { id: 'acked', title: 'Completed', kind: 'outcome', summary: 'Acknowledged and removed, not a stored state', parent: 'queue' },
    { id: 'retry', title: 'Retry', kind: 'mechanism', summary: 'Reclaims expired leases', parent: 'queue' },
    { id: 'dead-letter', title: 'Dead letter', kind: 'state', summary: 'Keeps exhausted jobs inspectable', parent: 'queue' },
    { id: 'tests', title: 'Tests', kind: 'verification', summary: 'Real queue behavior criteria', parent: 'root' },
  ],
  'todo-list': [
    { id: 'root', title: 'Todo List', kind: 'system', summary: 'Small reducer-driven task workflow' },
    { id: 'input', title: 'Task input', kind: 'component', summary: 'Create named tasks', parent: 'root' },
    { id: 'list', title: 'Task list', kind: 'component', summary: 'Renders tasks', parent: 'root' },
    { id: 'active', title: 'Active tasks', kind: 'state', summary: 'Work that remains', parent: 'list' },
    { id: 'completed', title: 'Completed tasks', kind: 'state', summary: 'Tasks marked done', parent: 'list' },
    { id: 'archive', title: 'Remove', kind: 'operation', summary: 'Removes or clears completed tasks', parent: 'list' },
    { id: 'tests', title: 'Tests', kind: 'verification', summary: 'Pure todo model test cases', parent: 'root' },
  ],
};

export function exampleConceptId(kind: EngineeringExampleKind, nodeId: string): string {
  return 'sample-engineering-' + kind + '-concept-' + nodeId;
}

export function engineeringExampleKind(projectId: string | undefined): EngineeringExampleKind | null {
  return examples.find((example) => example.id === projectId)?.kind ?? null;
}

export async function createEngineeringExampleProjects(): Promise<{ created: number; queueProjectId: string; todoProjectId: string }> {
  let created = 0;
  await db.transaction('rw', db.understandingProjects, db.landscapeRegions, async () => {
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
    for (const example of examples) {
      const now = new Date();
      for (const [index, node] of MODELS[example.kind].entries()) {
        const id = exampleConceptId(example.kind, node.id);
        if (await db.landscapeRegions.get(id)) continue;
        const region: LandscapeRegion = {
          id,
          projectId: example.id,
          parentRegionId: node.parent ? exampleConceptId(example.kind, node.parent) : null,
          title: node.title,
          summary: node.summary,
          kind: node.kind,
          order: index,
          memberObjectIds: [],
          pinnedObjectIds: [],
          revisions: [{ at: now, field: 'created' }],
          createdAt: now,
          updatedAt: now,
        };
        await db.landscapeRegions.add(region);
      }
    }
  });
  return { created, queueProjectId: EVENT_QUEUE_PROJECT_ID, todoProjectId: TODO_LIST_PROJECT_ID };
}

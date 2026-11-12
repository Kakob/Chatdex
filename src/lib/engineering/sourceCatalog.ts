/**
 * Revision-aware source locations for the reusable engineering model.
 *
 * A binding is an authored pointer to code; it is NOT proof that a behavior
 * claim is true. 'bundled' means this app was built with the example source,
 * and cannot pretend to be a pinned repository snapshot.
 *
 * No duplicate repository reader: cached revisions are resolved through
 * src/lib/db/repoFiles.ts, written by the existing RepoSource indexer.
 */
import { getRepoFile } from '../db/repoFiles';
import { isFetchAllowed } from '../understanding/trace/fetchPolicy';
import { exampleConceptId, type EngineeringExampleKind } from './demoProjects';
import { exampleTransitionId } from './modelCatalog';

export type SourceBindingRole = 'implementation' | 'test' | 'documentation';
export type SourceBindingOrigin = 'authored-fixture' | 'manual';

export interface EngineeringSourceBinding {
  id: string;
  projectId: string;
  targetId: string;
  role: SourceBindingRole;
  repoKey: string;
  path: string;
  /** Non-empty only for a real indexed snapshot, never a fake built-in SHA. */
  sha?: string;
  /** 'bundled' is displayed with an explicit unpinned warning. */
  sourceKind: 'bundled' | 'indexed';
  /** Authored symbol/line anchor; may be missing from the actual file. */
  needle: string;
  label: string;
  origin: SourceBindingOrigin;
}

export type SourceResolution =
  | { status: 'bundled-unpinned' | 'indexed-revision'; binding: EngineeringSourceBinding; text: string; matchedLine: number | null }
  | { status: 'not-indexed' | 'unavailable' | 'anchor-missing'; binding: EngineeringSourceBinding; text?: string };

export type BundledSources = Readonly<Record<string, string>>;

/** Resolve only from the current compiled app or the existing local repo cache. */
export async function resolveSourceBinding(binding: EngineeringSourceBinding, bundled: BundledSources = {}): Promise<SourceResolution> {
  let text: string | undefined;
  if (binding.sourceKind === 'bundled') {
    text = bundled[binding.path];
    if (text === undefined) return { status: 'unavailable', binding };
  } else {
    if (!binding.sha) return { status: 'not-indexed', binding };
    const row = await getRepoFile(binding.repoKey, binding.sha, binding.path);
    if (!row) return { status: 'not-indexed', binding };
    text = row.content;
  }
  const matched = binding.needle ? text.split('\n').findIndex((line) => line.includes(binding.needle)) : -1;
  if (binding.needle && matched < 0) return { status: 'anchor-missing', binding, text };
  return { status: binding.sourceKind === 'bundled' ? 'bundled-unpinned' : 'indexed-revision', binding, text, matchedLine: matched < 0 ? null : matched + 1 };
}

export function bindingGitHubUrl(binding: EngineeringSourceBinding): string | null {
  if (!binding.repoKey.startsWith('gh:')) return null;
  const parts = binding.repoKey.slice(3).split('/');
  if (parts.length !== 2 || parts.some((part) => !/^[A-Za-z0-9_.-]+$/.test(part))) return null;
  // Only emit immutable-commit links for genuinely pinned revisions.
  // Unpinned example source has no reliable SHA, so it receives no link here.
  if (!binding.sha || !/^[0-9a-f]{40}$/i.test(binding.sha)) return null;
  return 'https://github.com/' + parts.join('/') + '/blob/' + binding.sha + '/' +
    binding.path.split('/').map(encodeURIComponent).join('/');
}

export function validateSourceBinding(binding: EngineeringSourceBinding): void {
  if (!binding.projectId || !binding.targetId || !binding.repoKey) throw new Error('Source binding must identify project, target and source');
  if (!binding.path || binding.path.startsWith('/') || binding.path.includes('\\') || binding.path.includes('..')) {
    throw new Error('Invalid repository-relative source path');
  }
  if (!isFetchAllowed(binding.path).allowed) throw new Error('Source path is excluded or sensitive');
  if (binding.sourceKind === 'indexed' && !binding.sha) throw new Error('An indexed binding needs an actual snapshot revision');
  if (binding.sourceKind === 'bundled' && binding.sha) throw new Error('A bundled source cannot claim a pinned revision');
}

interface AuthoredLocation {
  node: string;
  role: SourceBindingRole;
  path: string;
  needle: string;
  label: string;
}

/** One fixture catalog feeds both existing Explorers; no binding definitions in React components. */
const QUEUE: AuthoredLocation[] = [
  ['producer', 'implementation', 'src/queue.ts', 'async enqueue(payload', 'Enqueue'],
  ['queue', 'implementation', 'src/queue.ts', 'export class EventQueue', 'Queue'],
  ['worker', 'implementation', 'src/worker.ts', 'export async function workOnce', 'Worker'],
  ['pending', 'implementation', 'src/queue.ts', 'export type JobState', 'Job state'],
  ['leased', 'implementation', 'src/queue.ts', 'async claim(workerId', 'Claim'],
  ['acked', 'implementation', 'src/queue.ts', 'async ack(jobId', 'Acknowledge'],
  ['retry', 'implementation', 'src/queue.ts', 'async reapExpired', 'Lease recovery'],
  ['dead-letter', 'implementation', 'src/queue.ts', 'deadLetters():', 'Dead letters'],
  ['tests', 'implementation', 'test/delivery.test.ts', "it('[EQ-C5]", 'Verification definition'],
  ['producer', 'test', 'test/delivery.test.ts', "it('[EQ-C0]", 'Enqueue-order test'],
  ['queue', 'test', 'test/delivery.test.ts', "it('[EQ-C5]", 'Worker failure test'],
  ['worker', 'test', 'test/delivery.test.ts', "it('[EQ-C5]", 'Worker failure test'],
  ['pending', 'test', 'test/delivery.test.ts', "it('[EQ-C2]", 'Lease recovery test'],
  ['leased', 'test', 'test/delivery.test.ts', "it('[EQ-C3]", 'Stale token test'],
  ['acked', 'test', 'test/delivery.test.ts', "it('[EQ-C1]", 'Ack test'],
  ['retry', 'test', 'test/delivery.test.ts', "it('[EQ-C2]", 'Lease recovery test'],
  ['dead-letter', 'test', 'test/delivery.test.ts', "it('[EQ-C7]", 'Bounded retry test'],
  ['tests', 'test', 'test/delivery.test.ts', "it('[EQ-C5]", 'Worker failure test'],
].map(([node, role, path, needle, label]) => ({ node, role: role as SourceBindingRole, path, needle, label }));

const TODO: AuthoredLocation[] = [
  ['input', 'implementation', 'src/lib/engineering/todoModel.ts', 'export function addTask', 'Add task'],
  ['list', 'implementation', 'src/lib/engineering/todoModel.ts', 'export interface TodoState', 'Task state'],
  ['active', 'implementation', 'src/lib/engineering/todoModel.ts', 'export function toggleTask', 'Toggle task'],
  ['completed', 'implementation', 'src/lib/engineering/todoModel.ts', 'export function toggleTask', 'Toggle task'],
  ['archive', 'implementation', 'src/lib/engineering/todoModel.ts', 'export function clearCompleted', 'Remove completed'],
  ['tests', 'implementation', 'src/lib/engineering/todoModel.ts', 'export function todoTransition', 'Task reducer'],
  ['root', 'implementation', 'src/lib/engineering/todoModel.ts', 'export interface TodoState', 'Todo model'],
  ...['input', 'list', 'active', 'completed', 'archive', 'tests', 'root'].map((node) =>
    [node, 'test', 'src/lib/engineering/todoModel.test.ts', "describe('Todo engineering example'", 'Reducer tests']),
].map(([node, role, path, needle, label]) => ({ node, role: role as SourceBindingRole, path, needle, label }));

// Add source pointers to relationships so model edits can preview code/test
// obligations without assuming an edit to either endpoint is sufficient.
const QUEUE_RELATIONS: Record<string, { path: string; needle: string }> = {
  enqueue: { path: 'src/queue.ts', needle: 'async enqueue(payload' },
  dispatch: { path: 'src/worker.ts', needle: 'export async function workOnce' },
  store: { path: 'src/queue.ts', needle: 'export type JobState' },
  claim: { path: 'src/queue.ts', needle: 'async claim(workerId' },
  'to-lease': { path: 'src/queue.ts', needle: 'async claim(workerId' },
  ack: { path: 'src/queue.ts', needle: 'async ack(jobId' },
  expire: { path: 'src/queue.ts', needle: 'async reapExpired' },
  requeue: { path: 'src/queue.ts', needle: 'async reapExpired' },
  'dead-letter': { path: 'src/queue.ts', needle: 'deadLetters():' },
};
const TODO_RELATIONS: Record<string, { path: string; needle: string }> = {
  create: { path: 'src/lib/engineering/todoModel.ts', needle: 'export function addTask' },
  activate: { path: 'src/lib/engineering/todoModel.ts', needle: 'export function addTask' },
  complete: { path: 'src/lib/engineering/todoModel.ts', needle: 'export function toggleTask' },
  reopen: { path: 'src/lib/engineering/todoModel.ts', needle: 'export function toggleTask' },
  remove: { path: 'src/lib/engineering/todoModel.ts', needle: 'export function clearCompleted' },
  verify: { path: 'src/lib/engineering/todoModel.test.ts', needle: "describe('Todo engineering example'" },
};

export function fixtureSourceBindings(kind: EngineeringExampleKind, projectId: string): EngineeringSourceBinding[] {
  const root = kind === 'event-queue' ? 'examples/event-queue/' : '';
  const locations = kind === 'event-queue' ? QUEUE : TODO;
  const records = locations.map((location) => {
    const targetId = exampleConceptId(kind, location.node);
    return {
      id: targetId + ':' + location.role,
      projectId, targetId, role: location.role,
      repoKey: 'gh:Kakob/Chatdex',
      path: root + location.path,
      sourceKind: 'bundled' as const,
      needle: location.needle,
      label: location.label,
      origin: 'authored-fixture' as const,
    };
  });
  const relations = kind === 'event-queue' ? QUEUE_RELATIONS : TODO_RELATIONS;
  for (const [key, location] of Object.entries(relations)) {
    const targetId = exampleTransitionId(kind, key);
    records.push({
      id: targetId + ':implementation',
      projectId, targetId, role: 'implementation',
      repoKey: 'gh:Kakob/Chatdex', path: root + location.path,
      sourceKind: 'bundled', needle: location.needle,
      label: 'Transition ' + key, origin: 'authored-fixture',
    });
  }
  return records;
}

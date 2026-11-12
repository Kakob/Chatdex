import { beforeEach, describe, expect, it } from 'vitest';
import { clearAllData, db } from '../db';
import { putRepoFiles } from '../db/repoFiles';
import { createHumanProject } from '../db/understanding';
import { createEngineeringExampleProjects, EVENT_QUEUE_PROJECT_ID } from './demoProjects';
import { installExampleTransitions, loadEngineeringModel, engineeringModelDb, createModelSourceBinding } from './modelStore';
import {
  bindingGitHubUrl,
  fixtureSourceBindings,
  resolveSourceBinding,
  validateSourceBinding,
} from './sourceCatalog';
import { bundledEngineeringSources } from './bundledSources';

beforeEach(async () => {
  await clearAllData();
  await engineeringModelDb.proposals.clear();
  await engineeringModelDb.transitions.clear();
  await engineeringModelDb.sourceBindings.clear();
});

describe('source bindings over existing repository reader', () => {
  it('centralizes queue code and test mappings and labels bundled bytes as unpinned', async () => {
    await createEngineeringExampleProjects();
    await installExampleTransitions(EVENT_QUEUE_PROJECT_ID);
    const model = await loadEngineeringModel(EVENT_QUEUE_PROJECT_ID);
    expect(model.sourceBindings.length).toBeGreaterThan(18);
    expect(fixtureSourceBindings('event-queue', EVENT_QUEUE_PROJECT_ID)).toHaveLength(model.sourceBindings.length);
    const binding = model.sourceBindings.find((x) => x.label === 'Worker' && x.role === 'implementation');
    expect(binding).toBeDefined();
    const resolved = await resolveSourceBinding(binding!, bundledEngineeringSources);
    expect(resolved.status).toBe('bundled-unpinned');
    if ('text' in resolved) expect(resolved.text).toContain('export async function workOnce');
    expect(bindingGitHubUrl(binding!)).toBeNull();
    expect(await db.repoFiles.count()).toBe(0); // no secret new repo reader/indexer
  });

  it('resolves a third project at an exact SHA from the existing repoFiles cache without a special adapter', async () => {
    const project = await createHumanProject({ name: 'Chatdex model engine' });
    const id = 'chatdex-model-module';
    await db.landscapeRegions.add({
      id, projectId: project.id, parentRegionId: null, title: 'Model engine',
      summary: 'The user-authored model module', kind: 'component', order: 0,
      memberObjectIds: [], pinnedObjectIds: [], createdAt: new Date(), updatedAt: new Date(),
    });
    const sha = 'a'.repeat(40);
    const binding = await createModelSourceBinding({
      projectId: project.id, targetId: id, role: 'implementation',
      repoKey: 'gh:Kakob/Chatdex', sha, path: 'src/lib/engineering/modelStore.ts',
      sourceKind: 'indexed', needle: 'export async function loadEngineeringModel',
      label: 'Shared loader', origin: 'manual',
    });
    const missing = await resolveSourceBinding(binding);
    expect(missing.status).toBe('not-indexed');
    await putRepoFiles([{
      repoKey: 'gh:Kakob/Chatdex', sha, path: binding.path,
      content: "export async function loadEngineeringModel() { return 'ok' }",
      size: 68, fetchedAt: new Date(),
    }]);
    const model = await loadEngineeringModel(project.id);
    expect(model.kind).toBeNull();
    expect(model.sourceBindings).toHaveLength(1);
    const found = await resolveSourceBinding(model.sourceBindings[0]);
    expect(found.status).toBe('indexed-revision');
    if (found.status === 'indexed-revision') expect(found.matchedLine).toBe(1);
    expect(bindingGitHubUrl(binding)).toBe('https://github.com/Kakob/Chatdex/blob/' + sha + '/src/lib/engineering/modelStore.ts');

    await db.repoFiles.update(['gh:Kakob/Chatdex', sha, binding.path], { content: 'export const unrelated = true' });
    expect((await resolveSourceBinding(binding)).status).toBe('anchor-missing');
  });

  it('refuses dangerous, unpinned, cross-project or missing source claims', async () => {
    const project = await createHumanProject({ name: 'One' });
    const other = await createHumanProject({ name: 'Two' });
    await db.landscapeRegions.add({
      id: 'one-node', projectId: project.id, parentRegionId: null, title: 'First',
      kind: 'component', order: 0, memberObjectIds: [], pinnedObjectIds: [],
      createdAt: new Date(), updatedAt: new Date(),
    });
    const base = {
      projectId: project.id, targetId: 'one-node', role: 'implementation' as const,
      repoKey: 'gh:Kakob/Chatdex', sourceKind: 'indexed' as const,
      origin: 'manual' as const, needle: 'export', label: 'source',
    };
    expect(() => validateSourceBinding({ ...base, id: 'x', path: '.env', sha: 'a'.repeat(40) })).toThrow();
    expect(() => validateSourceBinding({ ...base, id: 'x', path: 'src/../secret.ts', sha: 'a'.repeat(40) })).toThrow();
    expect(() => validateSourceBinding({ ...base, id: 'x', path: 'src/file.ts' })).toThrow(/revision/);
    await expect(createModelSourceBinding({ ...base, projectId: other.id, path: 'src/file.ts', sha: 'a'.repeat(40) })).rejects.toThrow(/not exist/);
  });
});

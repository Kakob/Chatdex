import { beforeEach, describe, expect, it } from 'vitest';
import { clearAllData, db } from '../../db';
import { createEngineeringExampleProjects, TODO_LIST_PROJECT_ID, EVENT_QUEUE_PROJECT_ID } from '../demoProjects';
import { engineeringModelDb } from '../modelStore';
import { analyzeBundledExample } from './fromBundled';
import {
  saveSourceAnalysis, restoreSourceAnalysis, saveSourceSelection, forgetSourceAnalysis,
} from './sourceAnalysisCache';

beforeEach(async () => {
  await clearAllData();
  await engineeringModelDb.sourceAnalyses.clear();
});

async function recordFor(projectId: string) {
  const kind = projectId === TODO_LIST_PROJECT_ID ? 'todo-list' : 'event-queue';
  const data = await analyzeBundledExample(kind);
  return {
    projectId, scope: '', data,
    selectedId: null,
    savedAt: 1794500000000,
  };
}

describe('local-only persisted source-derived model', () => {
  it.each([TODO_LIST_PROJECT_ID, EVENT_QUEUE_PROJECT_ID])(
    'restores the latest bundled analysis for %s without re-running source analysis',
    async (projectId) => {
      await createEngineeringExampleProjects();
      const project = (await db.understandingProjects.get(projectId))!;
      const record = await recordFor(projectId);
      await saveSourceAnalysis(record);
      const restored = await restoreSourceAnalysis(project);
      expect(restored).toEqual(record);
      expect(restored?.data.graph.entities.length).toBeGreaterThan(15);
      const id = record.data.graph.entities.find((entity) => entity.kind === 'function')!.id;
      await saveSourceSelection(projectId, id);
      expect((await restoreSourceAnalysis(project))?.selectedId).toBe(id);
      await forgetSourceAnalysis(projectId);
      expect(await restoreSourceAnalysis(project)).toBeNull();
    },
  );

  it('invalidates a bundled analysis when its source snapshot fingerprint no longer matches', async () => {
    await createEngineeringExampleProjects();
    const project = (await db.understandingProjects.get(TODO_LIST_PROJECT_ID))!;
    const record = await recordFor(TODO_LIST_PROJECT_ID);
    await saveSourceAnalysis({
      ...record,
      data: { ...record.data, graph: { ...record.data.graph, snapshotFingerprint: 'older-build' } },
    });
    expect(await restoreSourceAnalysis(project)).toBeNull();
  });

  it('keeps a GitHub model tied to its original repository/ref and recorded SHA', async () => {
    await createEngineeringExampleProjects();
    const project = (await db.understandingProjects.get(TODO_LIST_PROJECT_ID))!;
    const record = await recordFor(TODO_LIST_PROJECT_ID);
    const githubData = {
      graph: { ...record.data.graph, revision: 'a'.repeat(40) },
      sourceFiles: record.data.sourceFiles,
      coverage: record.data.coverage,
      repository: { owner: 'Example', repo: 'App', ref: 'main', sha: 'a'.repeat(40) },
    };
    await saveSourceAnalysis({ ...record, data: githubData, scope: 'src' });
    expect(await restoreSourceAnalysis(project)).toBeNull(); // unbound example can't reuse GitHub model
    const bound = {
      ...project,
      repository: { owner: 'Example', repo: 'App', defaultBranch: 'main', pinnedRef: 'main' },
    };
    const found = await restoreSourceAnalysis(bound);
    expect(found?.data).toEqual(githubData);
    expect(found?.data.graph.revision).toBe('a'.repeat(40));
    expect(await restoreSourceAnalysis({ ...bound, repository: { ...bound.repository, pinnedRef: 'next' } }))
      .toBeNull();
    expect(await restoreSourceAnalysis({ ...bound, repository: { ...bound.repository, repo: 'Different' } }))
      .toBeNull();
  });

  it('keeps one latest model per project and ignores unknown selections', async () => {
    await createEngineeringExampleProjects();
    const record = await recordFor(TODO_LIST_PROJECT_ID);
    await saveSourceAnalysis(record);
    await saveSourceSelection(TODO_LIST_PROJECT_ID, 'not-a-source-entity');
    expect((await engineeringModelDb.sourceAnalyses.get(TODO_LIST_PROJECT_ID))?.selectedId).toBeNull();
    await saveSourceAnalysis({ ...record, savedAt: record.savedAt + 1 });
    expect(await engineeringModelDb.sourceAnalyses.count()).toBe(1);
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../lib/db/schema';
import { clearAllData } from '../../lib/db';
import { seedPapers, seedProjects, seedResearchers } from './seed';
import { ATLAS_PROJECT_NAME, moveAtlasIntoProject } from './toProject';

beforeEach(async () => { await clearAllData(); });

const snapshot = {
  researchers: seedResearchers,
  projects: seedProjects,
  papers: seedPapers,
  investigations: [{ id: 'p-isat', projectId: 'p-isat', status: 'reproducing' as const, note: 'Started metric', updatedAt: '2026-10-30T00:00:00Z' }],
};

describe('moveAtlasIntoProject', () => {
  it('registers every atlas record as a reference-only source in one accepted project', async () => {
    const { project, added, total } = await moveAtlasIntoProject(snapshot);
    const expected = seedResearchers.length + seedProjects.length + seedPapers.length;
    expect(project.name).toBe(ATLAS_PROJECT_NAME);
    expect(project.reviewState).toBe('accepted');
    expect(added).toBe(expected);
    expect(total).toBe(expected);
    const sources = await db.researchSources.where('projectId').equals(project.id).toArray();
    expect(sources.every(s => s.access === 'reference-only' && s.registryId?.startsWith('atlas:'))).toBe(true);
    const isat = sources.find(s => s.registryId === 'atlas:p-isat');
    expect(isat?.notes).toContain('Investigation (reproducing');
    expect(isat?.notes).toContain("Sidney D'Mello");
    expect(sources.find(s => s.kind === 'paper')?.authored.precision).toBe('year');
  });

  it('is idempotent and reuses the existing project', async () => {
    const first = await moveAtlasIntoProject(snapshot);
    const second = await moveAtlasIntoProject(snapshot);
    expect(second.project.id).toBe(first.project.id);
    expect(second.added).toBe(0);
    expect(await db.understandingProjects.where('name').equals(ATLAS_PROJECT_NAME).count()).toBe(1);
  });
});

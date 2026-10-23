import Dexie, { type Table } from 'dexie';
import type { AtlasImport } from './openalex';
import { seedPapers, seedProjects, seedResearchers } from './seed';
import type {
  AtlasMetadata, Investigation, InvestigationStatus,
  Researcher, ResearchPaper, ResearchProject,
} from './types';

class ResearchAtlasDB extends Dexie {
  researchers!: Table<Researcher, string>;
  projects!: Table<ResearchProject, string>;
  papers!: Table<ResearchPaper, string>;
  investigations!: Table<Investigation, string>;
  metadata!: Table<AtlasMetadata, string>;

  constructor() {
    super('chatdex-research-atlas');
    this.version(1).stores({
      researchers: '&id, name, institution, origin, *projectIds',
      projects: '&id, title, institution, kind, origin, *researcherIds',
      papers: '&id, title, year, origin, *projectIds',
      investigations: '&id, projectId, status, updatedAt',
      metadata: '&key',
    });
  }
}

export const researchAtlasDb = new ResearchAtlasDB();

export interface AtlasSnapshot {
  researchers: Researcher[];
  projects: ResearchProject[];
  papers: ResearchPaper[];
  investigations: Investigation[];
}

export async function initializeAtlas(): Promise<void> {
  const db = researchAtlasDb;
  await db.transaction('rw', db.researchers, db.projects, db.papers, db.metadata, async () => {
    if (await db.metadata.get('curated-seed-v1')) return;
    // Only insert unseen seed IDs: never overwrite the user's imported records.
    const [existingResearchers, existingProjects, existingPapers] = await Promise.all([
      db.researchers.bulkGet(seedResearchers.map((item) => item.id)),
      db.projects.bulkGet(seedProjects.map((item) => item.id)),
      db.papers.bulkGet(seedPapers.map((item) => item.id)),
    ]);
    await db.researchers.bulkPut(seedResearchers.filter((_, i) => !existingResearchers[i]));
    await db.projects.bulkPut(seedProjects.filter((_, i) => !existingProjects[i]));
    await db.papers.bulkPut(seedPapers.filter((_, i) => !existingPapers[i]));
    await db.metadata.put({ key: 'curated-seed-v1', value: new Date().toISOString() });
  });
}

export async function loadAtlas(): Promise<AtlasSnapshot> {
  const db = researchAtlasDb;
  const [researchers, projects, papers, investigations] = await Promise.all([
    db.researchers.toArray(), db.projects.toArray(), db.papers.toArray(), db.investigations.toArray(),
  ]);
  return { researchers, projects, papers, investigations };
}

const unique = (a: string[], b: string[]): string[] => [...new Set([...a, ...b])];

export async function saveImport(imported: AtlasImport): Promise<void> {
  const db = researchAtlasDb;
  await db.transaction('rw', db.researchers, db.projects, db.papers, async () => {
    for (const item of imported.researchers) {
      const existing = await db.researchers.get(item.id);
      await db.researchers.put({
        ...existing, ...item,
        projectIds: unique(existing?.projectIds ?? [], item.projectIds),
      });
    }
    for (const item of imported.projects) {
      const existing = await db.projects.get(item.id);
      await db.projects.put({
        ...existing, ...item,
        researcherIds: unique(existing?.researcherIds ?? [], item.researcherIds),
        paperIds: unique(existing?.paperIds ?? [], item.paperIds),
      });
    }
    for (const item of imported.papers) {
      const existing = await db.papers.get(item.id);
      await db.papers.put({
        ...existing, ...item,
        projectIds: unique(existing?.projectIds ?? [], item.projectIds),
        researcherIds: unique(existing?.researcherIds ?? [], item.researcherIds),
      });
      for (const projectId of item.projectIds) {
        const project = await db.projects.get(projectId);
        if (project) {
          await db.projects.put({ ...project, paperIds: unique(project.paperIds, [item.id]) });
        }
      }
    }
  });
}

export async function saveInvestigation(
  projectId: string, status: InvestigationStatus, note: string,
): Promise<void> {
  const timestamp = new Date().toISOString();
  await researchAtlasDb.investigations.put({
    id: projectId, projectId, status, note: note.slice(0, 20000), updatedAt: timestamp,
  });
}

export async function exportAtlas(): Promise<void> {
  const snapshot = await loadAtlas();
  const body = new Blob(
    [JSON.stringify({ schemaVersion: 1, exportedAt: new Date().toISOString(), ...snapshot }, null, 2)],
    { type: 'application/json' },
  );
  const url = URL.createObjectURL(body);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = 'chatdex-research-atlas.json';
    link.click();
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

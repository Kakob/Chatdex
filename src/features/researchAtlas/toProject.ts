import { db } from '../../lib/db/schema';
import { createHumanProject } from '../../lib/db/understanding';
import { registerSource, unknownTime } from '../../lib/research/service';
import type { ResearchTime } from '../../types/research';
import { loadAtlas, type AtlasSnapshot } from './storage';

export const ATLAS_PROJECT_NAME = 'Research Atlas';

const year = (value?: string | number): ResearchTime =>
  value ? { value: String(value).slice(0, 10), precision: String(value).length > 4 ? 'day' : 'year' } : unknownTime();

const lines = (...parts: Array<string | false | undefined>) => parts.filter(Boolean).join('\n');

/**
 * Copies the standalone Research Atlas catalog into an ordinary accepted project as
 * reference-only research sources. Idempotent: each record keeps a stable registryId,
 * so re-running adds only records not already registered. The atlas database is left
 * untouched.
 */
export async function moveAtlasIntoProject(snapshot?: AtlasSnapshot) {
  const atlas = snapshot ?? await loadAtlas();
  const project = await db.understandingProjects.where('name').equals(ATLAS_PROJECT_NAME).first()
    ?? await createHumanProject({
      name: ATLAS_PROJECT_NAME,
      description: 'Researchers, research projects and publications moved from the Research Atlas directory.',
    });

  const researcherName = new Map(atlas.researchers.map(r => [r.id, r.name]));
  const projectTitle = new Map(atlas.projects.map(p => [p.id, p.title]));
  const names = (ids: string[], from: Map<string, string>) => ids.map(id => from.get(id) ?? id).join('; ');
  const investigation = new Map(atlas.investigations.map(i => [i.projectId, i]));
  const before = await db.researchSources.where('projectId').equals(project.id).count();

  for (const p of atlas.projects) {
    const inv = investigation.get(p.id);
    await registerSource({
      projectId: project.id,
      registryId: `atlas:${p.id}`,
      title: p.title,
      kind: p.kind === 'grant' ? 'research grant' : 'research strand',
      attribution: p.institution,
      uri: p.sourceUrl,
      authored: unknownTime(),
      eventTime: year(p.startDate),
      locator: p.awardNumber ? `${p.funder ?? 'Award'} ${p.awardNumber}` : '',
      notes: lines(
        p.description,
        p.topics.length > 0 && `Topics: ${p.topics.join(', ')}`,
        p.researcherIds.length > 0 && `Researchers: ${names(p.researcherIds, researcherName)}`,
        p.suggestedContribution && `Suggested contribution: ${p.suggestedContribution}`,
        p.endDate && `Ends: ${p.endDate}`,
        inv && `Investigation (${inv.status}, ${inv.updatedAt}): ${inv.note}`,
        `Atlas origin: ${p.origin}${p.verifiedAt ? `, checked ${p.verifiedAt}` : ''}`,
      ),
    });
  }
  for (const r of atlas.researchers) {
    await registerSource({
      projectId: project.id,
      registryId: `atlas:${r.id}`,
      title: r.name,
      kind: 'researcher',
      attribution: r.institution,
      uri: r.sourceUrl,
      authored: unknownTime(),
      eventTime: unknownTime(),
      locator: r.orcid ? `ORCID ${r.orcid}` : '',
      notes: lines(
        r.role,
        r.topics.length > 0 && `Topics: ${r.topics.join(', ')}`,
        r.projectIds.length > 0 && `Projects: ${names(r.projectIds, projectTitle)}`,
        `Atlas origin: ${r.origin}${r.verifiedAt ? `, checked ${r.verifiedAt}` : ''}`,
      ),
    });
  }
  for (const w of atlas.papers) {
    await registerSource({
      projectId: project.id,
      registryId: `atlas:${w.id}`,
      title: w.title,
      kind: 'paper',
      attribution: w.authors.join(', '),
      uri: w.sourceUrl,
      authored: year(w.year),
      eventTime: unknownTime(),
      locator: w.doi ? `DOI ${w.doi}` : '',
      notes: lines(
        w.projectIds.length > 0 && `Projects: ${names(w.projectIds, projectTitle)}`,
        w.openAccess !== undefined && `Open access: ${w.openAccess ? 'yes' : 'no'}`,
        `Atlas origin: ${w.origin}`,
      ),
    });
  }
  const after = await db.researchSources.where('projectId').equals(project.id).count();
  return { project, added: after - before, total: after };
}

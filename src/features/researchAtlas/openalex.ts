import type { ResearchPaper, ResearchProject, Researcher, AtlasTab } from './types';

interface Institution { id?: string; display_name?: string; country_code?: string }
interface Topic { display_name?: string }
interface PersonInAward {
  given_name?: string; family_name?: string; orcid?: string;
  affiliation?: { name?: string; country?: string };
}
interface OpenAlexAward {
  id: string; display_name?: string | null; description?: string | null;
  institution_awarded?: Institution[]; lead_investigator?: PersonInAward | null;
  funder?: { display_name?: string }; funder_award_id?: string | null;
  start_date?: string | null; end_date?: string | null;
  primary_topic?: Topic | null; topics?: Topic[];
  landing_page_url?: string | null;
}
interface OpenAlexAuthor {
  id: string; display_name?: string; orcid?: string | null;
  last_known_institutions?: Institution[];
  topics?: Topic[];
}
interface OpenAlexWork {
  id: string; title?: string | null; display_name?: string | null;
  publication_year?: number; doi?: string | null;
  open_access?: { is_oa?: boolean };
  best_oa_location?: { landing_page_url?: string | null } | null;
  authorships?: {
    author?: { id?: string; display_name?: string; orcid?: string | null };
    institutions?: Institution[];
  }[];
  awards?: { id?: string; funder_award_id?: string }[];
}
export interface AtlasImport {
  researchers: Researcher[];
  projects: ResearchProject[];
  papers: ResearchPaper[];
  matched: number;
}

const api = 'https://api.openalex.org/';
const searchFilters: Record<Exclude<AtlasTab, 'investigations'>, string> = {
  projects: 'institution_awarded.country_code:US',
  researchers: 'last_known_institutions.country_code:US',
  papers: 'institutions.country_code:US,from_publication_date:2024-01-01,open_access.is_oa:true',
};
const endpoints: Record<Exclude<AtlasTab, 'investigations'>, string> = {
  projects: 'awards', researchers: 'authors', papers: 'works',
};

const goodUrl = (url?: string | null): string | undefined =>
  url && /^https:\/\/[a-z0-9.-]+\//i.test(url) ? url : undefined;
const shortId = (id: string): string => id.split('/').pop() ?? id;
const topicNames = (topics?: Topic[]): string[] =>
  [...new Set((topics ?? []).map((topic) => topic.display_name).filter((t): t is string => !!t))].slice(0, 4);

async function request<T>(endpoint: string, params: URLSearchParams): Promise<T[]> {
  const url = api + endpoint + '?' + params.toString();
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    if (response.status === 429) throw new Error('OpenAlex rate limit reached. Try again later or configure an OpenAlex API key for larger queries.');
    if (response.status === 403) throw new Error('OpenAlex rejected the query or API key (403).');
    throw new Error('OpenAlex returned HTTP ' + response.status + '.');
  }
  const body: unknown = await response.json();
  if (!body || typeof body !== 'object' || !('results' in body)) {
    throw new Error('Unexpected OpenAlex response.');
  }
  const results = (body as { results: unknown }).results;
  if (!Array.isArray(results)) throw new Error('Unexpected OpenAlex result list.');
  return results as T[];
}

function awardsToImport(awards: OpenAlexAward[]): AtlasImport {
  const projects: ResearchProject[] = [];
  const researchers: Researcher[] = [];
  for (const award of awards) {
    if (!award.id || !award.display_name) continue;
    const us = award.institution_awarded?.find((i) => i.country_code === 'US');
    if (!us) continue;
    const grantId = shortId(award.id);
    const person = award.lead_investigator;
    const name = [person?.given_name, person?.family_name].filter(Boolean).join(' ').trim();
    const personId = name ? award.id + '/investigator' : '';
    const topics = topicNames(award.topics);
    if (topics.length === 0 && award.primary_topic?.display_name) {
      topics.push(award.primary_topic.display_name);
    }
    const sourceUrl = goodUrl(award.landing_page_url) ?? award.id;
    projects.push({
      id: award.id, title: award.display_name, institution: us.display_name ?? 'U.S. institution',
      description: award.description?.trim() || 'No abstract available in the OpenAlex record.',
      topics, researcherIds: personId ? [personId] : [], paperIds: [],
      sourceUrl, kind: 'grant', origin: 'openalex',
      funder: award.funder?.display_name, awardNumber: award.funder_award_id ?? grantId,
      startDate: award.start_date ?? undefined, endDate: award.end_date ?? undefined,
      suggestedContribution: 'Read the project description and public outputs; check data/code availability before proposing a reproducible experiment.',
    });
    if (personId) researchers.push({
      id: personId, name, institution: us.display_name ?? person?.affiliation?.name ?? 'U.S. institution',
      role: 'Grant lead investigator (faculty appointment not verified)',
      topics, projectIds: [award.id], sourceUrl,
      origin: 'openalex', orcid: person?.orcid,
    });
  }
  return { projects, researchers, papers: [], matched: projects.length };
}

function authorsToImport(authors: OpenAlexAuthor[]): AtlasImport {
  const researchers: Researcher[] = authors
    .filter((author) => author.id && author.display_name)
    .map((author) => {
      const us = author.last_known_institutions?.find((i) => i.country_code === 'US');
      if (!us) return null;
      return {
        id: author.id, name: author.display_name ?? 'Unknown author',
        institution: us.display_name ?? 'U.S. institution',
        role: 'Publication author (faculty appointment not verified)',
        topics: topicNames(author.topics), projectIds: [], sourceUrl: author.id,
        origin: 'openalex' as const, orcid: author.orcid ?? undefined,
      };
    })
    .filter((person): person is Researcher => person !== null);
  return { researchers, projects: [], papers: [], matched: researchers.length };
}

function worksToImport(works: OpenAlexWork[], projectId?: string): AtlasImport {
  const papers: ResearchPaper[] = [];
  const byId = new Map<string, Researcher>();
  for (const work of works) {
    if (!work.id || !(work.title || work.display_name)) continue;
    const authorships = work.authorships ?? [];
    const researcherIds: string[] = [];
    for (const entry of authorships) {
      const person = entry.author;
      const us = entry.institutions?.find((institution) => institution.country_code === 'US');
      if (!person?.id || !person.display_name || !us) continue;
      researcherIds.push(person.id);
      if (!byId.has(person.id)) byId.set(person.id, {
        id: person.id, name: person.display_name,
        institution: us.display_name ?? 'U.S. institution',
        role: 'Publication author (faculty appointment not verified)',
        topics: [], projectIds: [], sourceUrl: person.id,
        origin: 'openalex', orcid: person.orcid ?? undefined,
      });
    }
    papers.push({
      id: work.id, title: work.title || work.display_name || 'Untitled work',
      year: work.publication_year ?? 0,
      authors: authorships.map((entry) => entry.author?.display_name).filter((name): name is string => !!name),
      researcherIds: [...new Set(researcherIds)],
      projectIds: projectId ? [projectId] : [],
      sourceUrl: goodUrl(work.best_oa_location?.landing_page_url) ?? goodUrl(work.doi) ?? work.id,
      doi: work.doi ?? undefined,
      openAccess: !!work.open_access?.is_oa, origin: 'openalex',
    });
  }
  return { researchers: [...byId.values()], projects: [], papers, matched: papers.length };
}

/**
 * Query up to 25 records in one narrow first-page search. Keyless API requests
 * are documented by OpenAlex for casual usage; this is not a bulk US harvest.
 */
export async function searchOpenAlex(tab: Exclude<AtlasTab, 'investigations'>, phrase: string): Promise<AtlasImport> {
  const q = phrase.trim().slice(0, 120);
  if (q.length < 3) throw new Error('Enter at least three characters to search OpenAlex.');
  const params = new URLSearchParams({
    search: q, filter: searchFilters[tab], 'per-page': '25',
  });
  if (tab === 'projects') return awardsToImport(await request<OpenAlexAward>(endpoints[tab], params));
  if (tab === 'researchers') return authorsToImport(await request<OpenAlexAuthor>(endpoints[tab], params));
  return worksToImport(await request<OpenAlexWork>(endpoints[tab], params));
}

/**
 * Only assign grant → paper relations when OpenAlex's exact award ID / award
 * number filter matches. An empty result does not imply no papers exist.
 */
export async function fetchAwardOutputs(project: ResearchProject): Promise<AtlasImport> {
  if (!project.awardNumber && !project.id.startsWith('https://openalex.org/G')) {
    throw new Error('This project has no searchable grant identifier.');
  }
  const awardFilter = project.id.startsWith('https://openalex.org/G')
    ? 'awards.id:' + shortId(project.id)
    : 'awards.funder_award_id:' + project.awardNumber;
  const params = new URLSearchParams({ filter: awardFilter, 'per-page': '25', sort: '-publication_date' });
  return worksToImport(await request<OpenAlexWork>('works', params), project.id);
}

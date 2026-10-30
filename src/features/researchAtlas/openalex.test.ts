import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchAwardOutputs, searchOpenAlex } from './openalex';
import type { ResearchProject } from './types';

afterEach(() => vi.unstubAllGlobals());

function mockResponse(results: unknown[]) {
  const mock = vi.fn(async (_request: RequestInfo | URL) => ({
    ok: true,
    status: 200,
    json: async () => ({ results }),
  }));
  vi.stubGlobal('fetch', mock);
  return mock;
}

describe('Research Atlas OpenAlex ingestion', () => {
  it('imports a US grant and lead investigator without claiming faculty status', async () => {
    const fetcher = mockResponse([
      {
        id: 'https://openalex.org/G1234', display_name: 'AI for Student Learning',
        description: 'Testing student AI teams',
        institution_awarded: [
          { display_name: 'US University', country_code: 'US' },
        ],
        lead_investigator: { given_name: 'Ada', family_name: 'Example' },
        funder_award_id: 'ABC-123', funder: { display_name: 'NSF' },
        topics: [{ display_name: 'AI in education' }],
      },
      {
        id: 'https://openalex.org/G5678', display_name: 'Non-US grant',
        institution_awarded: [{ display_name: 'International Institute', country_code: 'GB' }],
      },
    ]);
    const result = await searchOpenAlex('projects', 'education');
    expect(result.projects).toHaveLength(1);
    expect(result.projects[0].awardNumber).toBe('ABC-123');
    expect(result.researchers[0].name).toBe('Ada Example');
    expect(result.researchers[0].role).toContain('not verified');
    expect(result.projects[0].suggestedContribution).toContain('check data/code');
    expect(String(fetcher.mock.calls[0][0])).toContain('/awards?');
    expect(String(fetcher.mock.calls[0][0])).toContain('institution_awarded.country_code');
  });

  it('distinguishes publication authors from verified professors and ignores non-US authors', async () => {
    mockResponse([
      {
        id: 'https://openalex.org/A100', display_name: 'Researcher One',
        last_known_institutions: [{ display_name: 'US University', country_code: 'US' }],
      },
      {
        id: 'https://openalex.org/A200', display_name: 'Researcher Two',
        last_known_institutions: [{ display_name: 'Overseas University', country_code: 'GB' }],
      },
    ]);
    const result = await searchOpenAlex('researchers', 'learning');
    expect(result.researchers).toHaveLength(1);
    expect(result.researchers[0].role).toBe('Publication author (faculty appointment not verified)');
  });

  it('maps OpenAlex works with open-access links and US author associations', async () => {
    mockResponse([{
      id: 'https://openalex.org/W42', title: 'Reproducible Educational AI',
      publication_year: 2025, doi: 'https://doi.org/10.1234/example',
      open_access: { is_oa: true },
      authorships: [
        {
          author: { id: 'https://openalex.org/A1', display_name: 'US Author' },
          institutions: [{ display_name: 'US University', country_code: 'US' }],
        },
        {
          author: { id: 'https://openalex.org/A2', display_name: 'UK Author' },
          institutions: [{ display_name: 'UK University', country_code: 'GB' }],
        },
      ],
    }]);
    const result = await searchOpenAlex('papers', 'tutor');
    expect(result.papers[0]).toMatchObject({
      year: 2025, openAccess: true, sourceUrl: 'https://doi.org/10.1234/example',
      researcherIds: ['https://openalex.org/A1'],
    });
    expect(result.papers[0].authors).toHaveLength(2);
    expect(result.researchers).toHaveLength(1);
  });

  it('connects grant outputs only to the explicitly queried award identifier', async () => {
    const fetcher = mockResponse([{
      id: 'https://openalex.org/W123', title: 'Study from grant', publication_year: 2026,
    }]);
    const project = {
      id: 'https://openalex.org/G100', title: 'Grant', institution: 'US University',
      description: '', topics: [], researcherIds: [], paperIds: [], sourceUrl: 'https://openalex.org/G100',
      kind: 'grant', origin: 'openalex',
    } satisfies ResearchProject;
    const result = await fetchAwardOutputs(project);
    expect(result.papers[0].projectIds).toEqual([project.id]);
    expect(String(fetcher.mock.calls[0][0])).toContain('awards.id');
  });

  it('rejects an unqualified search before making a request', async () => {
    const fetcher = mockResponse([]);
    await expect(searchOpenAlex('projects', 'ab')).rejects.toThrow('three characters');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('reports upstream rate limits rather than fabricating empty results', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 429 })));
    await expect(searchOpenAlex('papers', 'education')).rejects.toThrow('rate limit');
  });
});

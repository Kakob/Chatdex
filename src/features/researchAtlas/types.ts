export type AtlasOrigin = 'curated' | 'openalex';
export type InvestigationStatus = 'saved' | 'reproducing' | 'contacted' | 'completed';

export interface Researcher {
  id: string;
  name: string;
  institution: string;
  role: string;
  topics: string[];
  projectIds: string[];
  sourceUrl: string;
  origin: AtlasOrigin;
  verifiedAt?: string;
  orcid?: string;
}

export interface ResearchProject {
  id: string;
  title: string;
  institution: string;
  description: string;
  topics: string[];
  researcherIds: string[];
  paperIds: string[];
  sourceUrl: string;
  origin: AtlasOrigin;
  verifiedAt?: string;
  awardNumber?: string;
  funder?: string;
  startDate?: string;
  endDate?: string;
  kind: 'grant' | 'research-strand';
  suggestedContribution?: string;
}

export interface ResearchPaper {
  id: string;
  title: string;
  year: number;
  authors: string[];
  researcherIds: string[];
  projectIds: string[];
  sourceUrl: string;
  origin: AtlasOrigin;
  openAccess?: boolean;
  doi?: string;
}

export interface Investigation {
  id: string;
  projectId: string;
  status: InvestigationStatus;
  note: string;
  updatedAt: string;
}

export interface AtlasMetadata {
  key: string;
  value: string;
}

export type AtlasTab = 'projects' | 'researchers' | 'papers' | 'investigations';

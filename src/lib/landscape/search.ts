// Landscape search and filters (docs/changes/understanding-landscape).
// Complete by construction: every eligible finding that matches is returned,
// with the project/region path it is revealed in. Callers page the list; they
// never truncate it.

import {
  homeRegionId,
  regionNode,
  regionPath,
  type Landscape,
  type LandscapeFinding,
} from './projection';

export type LandscapeFilter = 'all' | 'pending' | 'open' | 'historical';

export const LANDSCAPE_FILTERS: { id: LandscapeFilter; label: string }[] = [
  { id: 'all', label: 'Everything' },
  { id: 'pending', label: 'Pending review' },
  { id: 'open', label: 'Open questions' },
  { id: 'historical', label: 'Superseded & resolved' },
];

export function parseFilter(value: string | null): LandscapeFilter {
  return LANDSCAPE_FILTERS.some((f) => f.id === value) ? (value as LandscapeFilter) : 'all';
}

export function passesFilter(finding: LandscapeFinding, filter: LandscapeFilter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'pending':
      return finding.object.reviewState === 'pending';
    case 'open':
      return finding.object.type === 'question' && finding.object.status === 'current';
    case 'historical':
      return finding.object.status !== 'current';
  }
}

export interface LandscapeSearchResult {
  finding: LandscapeFinding;
  projectName: string;
  /** Region titles from root to the region the finding is revealed in. */
  regionPath: { id: string; title: string }[];
  /** Number of other regions also holding the finding. */
  alsoInCount: number;
}

/** Build a matcher for one query + filter; reused to dim the map. */
export function makeMatcher(
  landscape: Landscape,
  query: string,
  filter: LandscapeFilter
): (finding: LandscapeFinding) => boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const projectNames = new Map(landscape.projects.map((p) => [p.key, p.name]));
  return (finding) => {
    if (!passesFilter(finding, filter)) return false;
    if (!terms.length) return true;
    const haystack = [
      finding.object.title,
      finding.object.body ?? '',
      finding.object.type,
      projectNames.get(finding.projectKey) ?? '',
      ...finding.regionIds.map((id) => landscape.regions.get(id)?.title ?? ''),
      ...finding.evidence.map((e) => e.conversationName ?? ''),
    ]
      .join(' ')
      .toLowerCase();
    return terms.every((t) => haystack.includes(t));
  };
}

export function isFiltering(query: string, filter: LandscapeFilter): boolean {
  return query.trim().length > 0 || filter !== 'all';
}

/** Every match, in landscape order (project order, then stable finding order). */
export function searchLandscape(
  landscape: Landscape,
  query: string,
  filter: LandscapeFilter
): LandscapeSearchResult[] {
  const matches = makeMatcher(landscape, query, filter);
  const out: LandscapeSearchResult[] = [];
  for (const project of landscape.projects) {
    for (const id of project.findingIds) {
      const finding = landscape.findings.get(id)!;
      if (!matches(finding)) continue;
      const home = regionNode(landscape, project.key, homeRegionId(finding));
      out.push({
        finding,
        projectName: project.name,
        regionPath: home ? regionPath(landscape, home).map((n) => ({ id: n.id, title: n.title })) : [],
        alsoInCount: Math.max(0, finding.regionIds.length - 1),
      });
    }
  }
  return out;
}

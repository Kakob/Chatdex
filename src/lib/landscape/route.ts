// URL-backed landscape navigation state (docs/changes/understanding-landscape).
//
// Every navigational choice lives in the query string of /landscape so Back,
// Forward, reload, and deep links reproduce the same scene. resolveView()
// validates ids against the current landscape: unknown, deleted, or
// foreign-project ids are dropped (never followed into another project), and
// a finding opened without its region is revealed in its home region.

import {
  homeRegionId,
  regionNode,
  regionPath,
  type Landscape,
  type LandscapeConnection,
  type LandscapeEvidence,
  type LandscapeFinding,
  type LandscapeProjectNode,
  type LandscapeRegionNode,
} from './projection';
import { parseFilter, type LandscapeFilter } from './search';

export type LandscapeLens = 'whole' | 'recent';
export type LandscapePanel = 'list' | 'organize';

export interface LandscapeParams {
  project?: string;
  region?: string;
  finding?: string;
  source?: string;
  edge?: string;
  /** Recent lens: project whose resume detail is open over the overview. */
  resume?: string;
  panel?: LandscapePanel;
  lens: LandscapeLens;
  q: string;
  filter: LandscapeFilter;
}

export const LANDSCAPE_PATH = '/landscape';

export function parseParams(search: URLSearchParams): LandscapeParams {
  const get = (key: string) => search.get(key) || undefined;
  const panel = search.get('panel');
  return {
    project: get('project'),
    region: get('region'),
    finding: get('finding'),
    source: get('source'),
    edge: get('edge'),
    resume: get('resume'),
    panel: panel === 'list' || panel === 'organize' ? panel : undefined,
    lens: search.get('lens') === 'recent' ? 'recent' : 'whole',
    q: search.get('q') ?? '',
    filter: parseFilter(search.get('filter')),
  };
}

/**
 * In-page link for these params, relative to the current route so the same
 * page works at /landscape and at the dev-only lab route. Use landscapeHref()
 * from other pages.
 */
export function toHref(params: LandscapeParams): string {
  const qs = toSearch(params);
  return qs ? `?${qs}` : '.';
}

/** Absolute link into the landscape, for entry points on other pages. */
export function landscapeHref(location: Partial<LandscapeParams> = {}): string {
  const qs = toSearch({ lens: 'whole', q: '', filter: 'all', ...location });
  return qs ? `${LANDSCAPE_PATH}?${qs}` : LANDSCAPE_PATH;
}

function toSearch(params: LandscapeParams): string {
  const search = new URLSearchParams();
  const order: (keyof LandscapeParams)[] = ['project', 'region', 'finding', 'source', 'edge', 'resume', 'panel'];
  for (const key of order) {
    const value = params[key];
    if (typeof value === 'string' && value) search.set(key, value);
  }
  if (params.lens === 'recent') search.set('lens', 'recent');
  if (params.q.trim()) search.set('q', params.q.trim());
  if (params.filter !== 'all') search.set('filter', params.filter);
  return search.toString();
}

/** Keep lens/query/filter; replace the location part. */
export function withLocation(
  params: LandscapeParams,
  location: Partial<Omit<LandscapeParams, 'lens' | 'q' | 'filter'>>
): LandscapeParams {
  return { lens: params.lens, q: params.q, filter: params.filter, ...location };
}

export interface ResolvedView {
  project?: LandscapeProjectNode;
  region?: LandscapeRegionNode;
  /** Region ancestors, root first, ending with `region`. */
  regionTrail: LandscapeRegionNode[];
  finding?: LandscapeFinding;
  source?: LandscapeEvidence;
  edge?: LandscapeConnection;
  resume?: LandscapeProjectNode;
  panel?: LandscapePanel;
  /** The canonical params for this view (differs from input when ids were corrected). */
  params: LandscapeParams;
  corrected: boolean;
}

export function resolveView(landscape: Landscape, input: LandscapeParams): ResolvedView {
  const params: LandscapeParams = { lens: input.lens, q: input.q, filter: input.filter };
  const view: ResolvedView = { regionTrail: [], params, corrected: false };

  const project = input.project ? landscape.projects.find((p) => p.key === input.project) : undefined;
  if (project) {
    view.project = project;
    params.project = project.key;

    const finding = input.finding ? landscape.findings.get(input.finding) : undefined;
    const ownFinding = finding && finding.projectKey === project.key ? finding : undefined;

    let region = input.region ? regionNode(landscape, project.key, input.region) : undefined;
    // A finding is shown as a marker only in a region that holds it directly;
    // prefer one inside the requested region, else its home region.
    if (ownFinding && (!region || !region.directIds.includes(ownFinding.object.id))) {
      const requested = region;
      const within = requested
        ? ownFinding.regionIds
            .map((id) => landscape.regions.get(id)!)
            .find((n) => regionPath(landscape, n).some((a) => a.id === requested.id))
        : undefined;
      region = within ?? regionNode(landscape, project.key, homeRegionId(ownFinding));
    }
    if (region) {
      view.region = region;
      view.regionTrail = regionPath(landscape, region);
      params.region = region.id;
    }
    if (ownFinding && region) {
      view.finding = ownFinding;
      params.finding = ownFinding.object.id;
      const source = input.source
        ? ownFinding.evidence.find((e) => e.conversationId === input.source)
        : undefined;
      if (source) {
        view.source = source;
        params.source = source.conversationId;
      }
    }
    if (input.panel === 'list' || (input.panel === 'organize' && project.project)) {
      if (!view.finding) {
        view.panel = input.panel;
        params.panel = input.panel;
      }
    }
  } else if (input.edge) {
    const edge = landscape.connections.find((c) => c.id === input.edge);
    if (edge) {
      view.edge = edge;
      params.edge = edge.id;
    }
  } else if (input.resume && input.lens === 'recent') {
    const target = landscape.projects.find((p) => p.key === input.resume && p.project);
    if (target) {
      view.resume = target;
      params.resume = target.key;
    }
  } else if (input.panel === 'list') {
    view.panel = 'list';
    params.panel = 'list';
  }

  view.corrected = toHref(params) !== toHref(input);
  return view;
}

/** One level up: source → finding → region → parent region → project → all projects. */
export function parentParams(view: ResolvedView): LandscapeParams {
  const p = view.params;
  if (view.source) return { ...p, source: undefined };
  if (view.finding) return { ...p, finding: undefined };
  if (view.panel) return { ...p, panel: undefined };
  if (view.edge || view.resume) return withLocation(p, {});
  if (view.region) {
    const parent = view.regionTrail.length > 1 ? view.regionTrail[view.regionTrail.length - 2] : undefined;
    return withLocation(p, { project: p.project, region: parent?.id });
  }
  return withLocation(p, {});
}

export function depthOf(view: ResolvedView): number {
  if (view.source) return 4;
  if (view.finding) return 3;
  if (view.region) return 2;
  if (view.project) return 1;
  return 0;
}

// Lenses decorate the one landscape; they never move places. Positions come
// from geometry.ts keyed on stable ids, so switching lens keeps the same
// mental map. Two lenses for the MVP — deliberately not a plugin framework.

import type { LandscapeFinding, LandscapeProjectNode, LandscapeRegionNode } from './projection';
import type { LandscapeVisit, ProjectResume } from './resume';
import type { LandscapeLens } from './route';

export interface LensMark {
  /** Whether this place is highlighted by the lens (dimmed when false and the lens is selective). */
  emphasis: boolean;
  /** Short line shown above the place title (e.g. activity date). */
  kicker?: string;
  /** Replaces the default caption line, with the activity basis. */
  caption?: string;
}

export interface LensView {
  id: LandscapeLens;
  /** True when non-emphasized places should be dimmed. */
  selective: boolean;
  project(p: LandscapeProjectNode): LensMark;
  region(r: LandscapeRegionNode): LensMark;
  finding(f: LandscapeFinding): LensMark;
}

const NEUTRAL: LensMark = { emphasis: true };

export const wholeLens: LensView = {
  id: 'whole',
  selective: false,
  project: () => NEUTRAL,
  region: () => NEUTRAL,
  finding: () => NEUTRAL,
};

export function formatDay(date: Date): string {
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function formatMoment(date: Date): string {
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function visitVerb(visit: LandscapeVisit): string {
  return visit.kind === 'source' ? 'Read a source' : visit.kind === 'finding' ? 'Opened a finding' : 'Visited a region';
}

export function recentLens(resume: Map<string, ProjectResume>): LensView {
  const visitsFor = (projectKey: string) => resume.get(projectKey)?.recent ?? [];
  return {
    id: 'recent',
    selective: true,
    project(p) {
      const entry = resume.get(p.key);
      if (!entry) return { emphasis: false, caption: 'No visits recorded here' };
      const ws = entry.workspaces.length;
      const wsText = ws ? ` · ${ws} active change workspace${ws === 1 ? '' : 's'}` : '';
      if (entry.last) {
        return {
          emphasis: true,
          kicker: `You were here ${formatDay(entry.last.at)}`,
          caption: `${visitVerb(entry.last)} in Chatdex${wsText}`,
        };
      }
      if (ws) {
        return {
          emphasis: true,
          kicker: `Workspace edited ${formatDay(entry.workspaces[0].updatedAt)}`,
          caption: `${ws} active change workspace${ws === 1 ? '' : 's'} · no landscape visits yet`,
        };
      }
      return {
        emphasis: false,
        kicker: p.latestSourceAt ? `Latest source activity ${formatDay(p.latestSourceAt)}` : undefined,
        caption: 'No visits on this device',
      };
    },
    region(r) {
      const visits = visitsFor(r.projectKey).filter(
        (v) => v.regionId === r.id || (v.objectId && r.allIds.includes(v.objectId))
      );
      if (!visits.length) return { emphasis: false };
      return { emphasis: true, kicker: `You were here ${formatDay(visits[0].at)}` };
    },
    finding(f) {
      const visit = visitsFor(f.projectKey).find((v) => v.objectId === f.object.id);
      if (!visit) return { emphasis: false };
      return { emphasis: true, kicker: `${visit.kind === 'source' ? 'Source read' : 'Opened'} ${formatDay(visit.at)}` };
    },
  };
}

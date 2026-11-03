// Non-component helpers shared by the landscape scenes and inspector.

import { layoutPlaces, type Place } from '../../lib/landscape/geometry';
import type { LandscapeConnection, LandscapeFinding, LandscapeProjectNode, MarkerTone } from '../../lib/landscape/projection';

/** Scene budgets: a bounded scene shows a subset; the list panel shows everything. */
export const MAX_PROJECT_REGIONS = 8;
export const MAX_REGION_PLACES = 9;
export const MAX_EDGES = 8;

export const TONE_COLOR: Record<MarkerTone, string> = {
  pending: '#bf984b',
  open: '#8976aa',
  reviewed: '#60917c',
  historical: '#9aa596',
};

export function reviewLabel(f: LandscapeFinding): string {
  const review = f.object.reviewState === 'edited' ? 'accepted (edited)' : f.object.reviewState;
  return f.object.status === 'current' ? review : `${review} · ${f.object.status}`;
}

export function projectPlaces(projects: LandscapeProjectNode[], width: number, height: number): Place[] {
  return layoutPlaces(
    projects.map((p) => p.key),
    { x: 24, y: 46, width: width - 48, height: height - 92 },
    { maxRx: 150, maxRy: 118 }
  );
}

export function edgeLabel(edge: LandscapeConnection): string {
  const n = edge.conversationIds.length;
  const base = n === 1 ? 'Shared source' : `${n} shared sources`;
  return edge.weak ? `${base} · pending association` : base;
}


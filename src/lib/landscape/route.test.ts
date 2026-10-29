import { describe, it, expect } from 'vitest';
import { assembleLandscape, UNCATEGORIZED_ID } from './projection';
import { landscapeHref, parentParams, parseParams, resolveView, toHref, type LandscapeParams } from './route';
import type { UnderstandingObject, UnderstandingProject } from '../../types/understanding';
import type { LandscapeRegion } from '../../types/landscape';

const T0 = new Date('2026-09-01T00:00:00Z');
const project = (id: string): UnderstandingProject => ({ id, name: id, origin: 'user', reviewState: 'accepted', createdAt: T0, updatedAt: T0 });
const object = (id: string, projectId: string): UnderstandingObject => ({ id, projectId, type: 'decision', title: id, status: 'current', origin: 'ai', reviewState: 'accepted', createdAt: T0, updatedAt: T0 });
const region = (id: string, projectId: string, members: string[], parentRegionId: string | null = null): LandscapeRegion => ({ id, projectId, parentRegionId, title: id, order: 0, memberObjectIds: members, pinnedObjectIds: [], createdAt: T0, updatedAt: T0 });

const landscape = assembleLandscape({
  projects: [project('p1'), project('p2')],
  objects: [object('a', 'p1'), object('b', 'p1'), object('loose', 'p1'), object('z', 'p2')],
  events: [
    { id: 'e', objectId: 'a', op: 'introduced', evidence: [{ conversationId: 'c1' }], origin: 'ai', reviewState: 'accepted', occurredAt: T0, createdAt: T0 },
  ],
  associations: [],
  conversationNames: new Map([['c1', 'One']]),
  regions: [region('r1', 'p1', ['a']), region('sub', 'p1', ['b'], 'r1'), region('rz', 'p2', ['z'])],
});

const base: LandscapeParams = { lens: 'whole', q: '', filter: 'all' };
const resolve = (p: Partial<LandscapeParams>) => resolveView(landscape, { ...base, ...p });

describe('resolveView', () => {
  it('round-trips params through the query string', () => {
    const p: LandscapeParams = { ...base, project: 'p1', region: 'r1', finding: 'a', source: 'c1', lens: 'recent', q: 'sync', filter: 'pending' };
    expect(parseParams(new URLSearchParams(toHref(p).slice(1)))).toEqual(p);
    expect(toHref(base)).toBe('.');
    expect(landscapeHref({ project: 'p1' })).toBe('/landscape?project=p1');
  });

  it('keeps a valid deep link unchanged', () => {
    const v = resolve({ project: 'p1', region: 'r1', finding: 'a', source: 'c1' });
    expect(v.corrected).toBe(false);
    expect(v.source?.conversationId).toBe('c1');
    expect(v.regionTrail.map((r) => r.id)).toEqual(['r1']);
  });

  it('drops unknown projects, regions, findings, and sources', () => {
    expect(resolve({ project: 'nope', region: 'r1' }).params).toEqual(base);
    const v = resolve({ project: 'p1', region: 'deleted', finding: 'missing', source: 'c9' });
    expect(v.params).toEqual({ ...base, project: 'p1' });
    expect(v.corrected).toBe(true);
    expect(resolve({ project: 'p1', region: 'r1', finding: 'a', source: 'c9' }).params.source).toBeUndefined();
  });

  it('never follows a foreign-project region or finding into another project', () => {
    const v = resolve({ project: 'p1', region: 'rz', finding: 'z' });
    expect(v.region).toBeUndefined();
    expect(v.finding).toBeUndefined();
  });

  it('reveals a finding in a region that holds it directly, preferring one under the requested region', () => {
    expect(resolve({ project: 'p1', finding: 'b' }).params.region).toBe('sub');
    expect(resolve({ project: 'p1', region: 'r1', finding: 'b' }).params.region).toBe('sub');
    expect(resolve({ project: 'p1', finding: 'loose' }).params.region).toBe(UNCATEGORIZED_ID);
  });

  it('steps out one level at a time, through parent regions', () => {
    const chain: Partial<LandscapeParams>[] = [];
    let v = resolve({ project: 'p1', region: 'sub', finding: 'b', q: 'keep' });
    for (let i = 0; i < 6 && (v.project || v.edge); i++) {
      const up = parentParams(v);
      chain.push({ region: up.region, finding: up.finding });
      expect(up.q).toBe('keep');
      v = resolveView(landscape, up);
    }
    expect(chain).toEqual([
      { region: 'sub', finding: undefined },
      { region: 'r1', finding: undefined },
      { region: undefined, finding: undefined },
      { region: undefined, finding: undefined },
    ]);
  });
});

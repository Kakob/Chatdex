import { describe, it, expect } from 'vitest';
import { reorderedSiblings, withMembership, withPin, wouldCreateCycle, MAX_PINNED_STATEMENTS } from './organize';
import type { LandscapeRegion } from '../../types/landscape';

const T0 = new Date('2026-09-01T00:00:00Z');
const r = (id: string, overrides: Partial<LandscapeRegion> = {}): LandscapeRegion => ({
  id, projectId: 'p1', parentRegionId: null, title: id, order: 0, memberObjectIds: [], pinnedObjectIds: [], createdAt: T0, updatedAt: T0, ...overrides,
});

describe('wouldCreateCycle', () => {
  const regions = [r('a'), r('b', { parentRegionId: 'a' }), r('c', { parentRegionId: 'b' }), r('x', { projectId: 'p2' })];
  it('rejects self, descendant, and cross-project parents', () => {
    expect(wouldCreateCycle(regions, 'a', 'a')).toBe(true);
    expect(wouldCreateCycle(regions, 'a', 'c')).toBe(true);
    expect(wouldCreateCycle(regions, 'a', 'x')).toBe(true);
    expect(wouldCreateCycle(regions, 'a', 'missing')).toBe(true);
  });
  it('allows top level and unrelated parents', () => {
    expect(wouldCreateCycle(regions, 'c', null)).toBe(false);
    expect(wouldCreateCycle(regions, 'c', 'a')).toBe(false);
  });
});

describe('reorderedSiblings', () => {
  it('swaps with a neighbour among siblings only and renumbers densely', () => {
    const regions = [r('a', { order: 0 }), r('b', { order: 5 }), r('c', { order: 9 }), r('kid', { parentRegionId: 'a', order: 1 })];
    expect(reorderedSiblings(regions, 'c', -1).map((x) => [x.id, x.order])).toEqual([
      ['c', 1],
      ['b', 2],
    ]);
    expect(reorderedSiblings(regions, 'a', -1)).toEqual([]);
    expect(reorderedSiblings(regions, 'kid', 1)).toEqual([]);
  });
});

describe('membership and pins', () => {
  it('adds without duplicating, and unpins on removal', () => {
    const base = r('a', { memberObjectIds: ['o1'], pinnedObjectIds: ['o1'] });
    expect(withMembership(base, 'o1', true)).toBe(base);
    expect(withMembership(base, 'o1', false)).toMatchObject({ memberObjectIds: [], pinnedObjectIds: [] });
  });
  it('pinning adds membership and keeps at most MAX_PINNED_STATEMENTS, newest first', () => {
    let region = r('a');
    for (const id of ['o1', 'o2', 'o3']) region = withPin(region, id, true);
    expect(region.pinnedObjectIds).toEqual(['o3', 'o2']);
    expect(region.pinnedObjectIds).toHaveLength(MAX_PINNED_STATEMENTS);
    expect(region.memberObjectIds).toEqual(['o1', 'o2', 'o3']);
    expect(withPin(region, 'o3', false).pinnedObjectIds).toEqual(['o2']);
  });
});

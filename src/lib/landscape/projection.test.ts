import { describe, it, expect } from 'vitest';
import { assembleLandscape, regionNode, UNASSIGNED_KEY, UNCATEGORIZED_ID, type LandscapeInput } from './projection';
import type {
  ProjectAssociation,
  UnderstandingEvent,
  UnderstandingObject,
  UnderstandingProject,
} from '../../types/understanding';
import type { LandscapeRegion } from '../../types/landscape';

const T0 = new Date('2026-09-01T00:00:00Z');
const day = (n: number) => new Date(T0.getTime() + n * 86_400_000);

function project(id: string, overrides: Partial<UnderstandingProject> = {}): UnderstandingProject {
  return { id, name: `Project ${id}`, origin: 'user', reviewState: 'accepted', createdAt: T0, updatedAt: T0, ...overrides };
}
function object(id: string, overrides: Partial<UnderstandingObject> = {}): UnderstandingObject {
  return { id, projectId: 'p1', type: 'decision', title: `Title ${id}`, status: 'current', origin: 'ai', reviewState: 'accepted', createdAt: T0, updatedAt: T0, ...overrides };
}
function event(id: string, objectId: string, overrides: Partial<UnderstandingEvent> = {}): UnderstandingEvent {
  return { id, objectId, op: 'introduced', evidence: [], origin: 'ai', reviewState: 'accepted', occurredAt: T0, createdAt: T0, ...overrides };
}
function region(id: string, overrides: Partial<LandscapeRegion> = {}): LandscapeRegion {
  return { id, projectId: 'p1', parentRegionId: null, title: `Region ${id}`, order: 0, memberObjectIds: [], pinnedObjectIds: [], createdAt: T0, updatedAt: T0, ...overrides };
}
function association(projectId: string, conversationId: string, overrides: Partial<ProjectAssociation> = {}): ProjectAssociation {
  return { id: `${projectId}-${conversationId}`, projectId, conversationId, confidence: 1, origin: 'user', reviewState: 'accepted', createdAt: T0, updatedAt: T0, ...overrides };
}
function input(overrides: Partial<LandscapeInput> = {}): LandscapeInput {
  return { projects: [project('p1')], objects: [], events: [], associations: [], conversationNames: new Map(), regions: [], ...overrides };
}

describe('assembleLandscape eligibility', () => {
  it('excludes rejected objects, intents, and objects under rejected projects; keeps every lifecycle status', () => {
    const l = assembleLandscape(
      input({
        projects: [project('p1'), project('p2', { reviewState: 'rejected' })],
        objects: [
          object('keep'),
          object('pending', { reviewState: 'pending' }),
          object('old', { status: 'superseded' }),
          object('rejected', { reviewState: 'rejected' }),
          object('intent', { type: 'intent' }),
          object('orphan', { projectId: 'p2' }),
          object('loose', { projectId: null }),
        ],
      })
    );
    expect([...l.findings.keys()].sort()).toEqual(['keep', 'loose', 'old', 'pending']);
    expect(l.projects.map((p) => p.key)).toEqual(['p1', UNASSIGNED_KEY]);
  });

  it('keeps review state and lifecycle separate: a current proposal is still pending', () => {
    const l = assembleLandscape(
      input({
        objects: [
          object('a', { reviewState: 'pending' }),
          object('b', { reviewState: 'accepted', status: 'superseded' }),
          object('q', { type: 'question', reviewState: 'pending' }),
          object('r', { type: 'question', status: 'resolved' }),
        ],
      })
    );
    expect(l.findings.get('a')!.tone).toBe('pending');
    expect(l.findings.get('b')!.tone).toBe('historical');
    expect(l.findings.get('q')!.tone).toBe('open');
    expect(l.findings.get('q')!.object.reviewState).toBe('pending');
    const p1 = l.projects[0].counts;
    expect(p1).toEqual({ total: 4, pending: 2, open: 1, historical: 2 });
  });
});

describe('evidence support', () => {
  it('marks reviewed vs proposed support, ignores rejected events, and flags unavailable sources', () => {
    const l = assembleLandscape(
      input({
        objects: [object('a')],
        events: [
          event('e1', 'a', { evidence: [{ conversationId: 'c1', messageIds: ['m1'] }] }),
          event('e2', 'a', { reviewState: 'pending', evidence: [{ conversationId: 'c2' }, { conversationId: 'c1', messageIds: ['m2'] }] }),
          event('e3', 'a', { reviewState: 'rejected', evidence: [{ conversationId: 'c3' }] }),
          event('e4', 'a', { op: 'contradicted', reviewState: 'pending', occurredAt: day(3), evidence: [{ conversationId: 'gone' }] }),
        ],
        conversationNames: new Map([
          ['c1', 'One'],
          ['c2', 'Two'],
          ['c3', 'Three'],
        ]),
      })
    );
    const f = l.findings.get('a')!;
    const byId = new Map(f.evidence.map((e) => [e.conversationId, e]));
    expect(byId.get('c1')).toMatchObject({ support: 'reviewed', messageIds: ['m1', 'm2'] });
    expect(byId.get('c2')!.support).toBe('proposed');
    expect(byId.has('c3')).toBe(false);
    expect(byId.get('gone')!.conversationName).toBeNull();
    expect(f.contradictionCount).toBe(1);
    expect(f.pendingEventCount).toBe(2);
    expect(f.events.map((e) => e.id)).not.toContain('e3');
  });

  it('never reports a pending object\'s auto-applied introduced evidence as reviewed', () => {
    const l = assembleLandscape(
      input({
        objects: [object('p', { reviewState: 'pending' })],
        events: [event('e', 'p', { reviewState: 'accepted', evidence: [{ conversationId: 'c1' }] })],
        conversationNames: new Map([['c1', 'One']]),
      })
    );
    expect(l.findings.get('p')!.evidence[0].support).toBe('proposed');
  });

  it('keeps source, recorded, and (absent) user clocks separate', () => {
    const l = assembleLandscape(
      input({
        objects: [object('a', { createdAt: day(30) }), object('b', { createdAt: day(31) })],
        events: [event('e1', 'a', { occurredAt: day(-200), createdAt: day(30) })],
      })
    );
    // Old history imported today: source clock stays old; recorded is today.
    expect(l.findings.get('a')!.sourceAt).toEqual(day(-200));
    expect(l.findings.get('a')!.recordedAt).toEqual(day(30));
    expect(l.findings.get('b')!.sourceAt).toBeNull();
    expect(l.projects[0].latestSourceAt).toEqual(day(-200));
  });
});

describe('regions', () => {
  it('counts a finding in two regions once and leaves unplaced findings in Uncategorized', () => {
    const l = assembleLandscape(
      input({
        objects: [object('a'), object('b'), object('c')],
        regions: [region('r1', { memberObjectIds: ['a', 'b'] }), region('r2', { order: 1, memberObjectIds: ['a'] })],
      })
    );
    const p = l.projects[0];
    expect(p.counts.total).toBe(3);
    expect(p.regions.map((r) => r.id)).toEqual(['r1', 'r2', UNCATEGORIZED_ID]);
    expect(regionNode(l, 'p1', UNCATEGORIZED_ID)!.directIds).toEqual(['c']);
    expect(l.findings.get('a')!.regionIds).toEqual(['r1', 'r2']);
  });

  it('ignores foreign-project, rejected, and duplicate member ids without dropping them from the record', () => {
    const r1 = region('r1', { memberObjectIds: ['a', 'a', 'x', 'gone', 'rej'] });
    const l = assembleLandscape(
      input({
        projects: [project('p1'), project('p2', { createdAt: day(1) })],
        objects: [object('a'), object('x', { projectId: 'p2' }), object('rej', { reviewState: 'rejected' })],
        regions: [r1],
      })
    );
    expect(regionNode(l, 'p1', 'r1')!.directIds).toEqual(['a']);
    expect(regionNode(l, 'p2', 'r1')).toBeUndefined();
    expect(r1.memberObjectIds).toHaveLength(5);
    expect(l.projects[1].regions.map((r) => r.id)).toEqual([UNCATEGORIZED_ID]);
  });

  it('nests subregions, rolls up distinct counts, and lifts cyclic or orphaned regions to the top', () => {
    const l = assembleLandscape(
      input({
        objects: [object('a'), object('b')],
        regions: [
          region('parent', { memberObjectIds: ['a'] }),
          region('child', { parentRegionId: 'parent', memberObjectIds: ['a', 'b'] }),
          region('c1', { parentRegionId: 'c2', order: 2 }),
          region('c2', { parentRegionId: 'c1', order: 3 }),
          region('orphan', { parentRegionId: 'deleted', order: 4 }),
        ],
      })
    );
    const parent = regionNode(l, 'p1', 'parent')!;
    expect(parent.children.map((c) => c.id)).toEqual(['child']);
    expect(parent.counts.total).toBe(2);
    expect(regionNode(l, 'p1', 'child')!.depth).toBe(1);
    expect(l.projects[0].regions.map((r) => r.id)).toEqual(['parent', 'c1', 'c2', 'orphan']);
  });

  it('shows pinned statements first, else a deterministic factual fallback preferring accepted findings', () => {
    const objects = [object('p', { reviewState: 'pending' }), object('a1', { createdAt: day(1) }), object('a2', { createdAt: day(2) }), object('h', { status: 'superseded' })];
    const pinned = assembleLandscape(input({ objects, regions: [region('r', { memberObjectIds: ['p', 'a1', 'a2', 'h'], pinnedObjectIds: ['p'] })] }));
    expect(regionNode(pinned, 'p1', 'r')!.previews).toEqual([
      { objectId: 'p', title: 'Title p', pinned: true },
      { objectId: 'a1', title: 'Title a1', pinned: false },
    ]);
    const fallback = assembleLandscape(input({ objects, regions: [region('r', { memberObjectIds: ['p', 'a1', 'a2', 'h'] })] }));
    expect(regionNode(fallback, 'p1', 'r')!.previews.map((p) => p.objectId)).toEqual(['a1', 'a2']);
    // Same input → same output.
    expect(assembleLandscape(input({ objects, regions: [region('r', { memberObjectIds: ['h', 'a2', 'a1', 'p'] })] })).projects[0].previews.map((p) => p.objectId)).toEqual(['a1', 'a2']);
  });

  it('handles an empty project honestly', () => {
    const l = assembleLandscape(input({ associations: [association('p1', 'c1')] }));
    expect(l.projects[0]).toMatchObject({ regions: [], sourceCount: 1, previews: [], counts: { total: 0, pending: 0, open: 0, historical: 0 } });
  });
});

describe('connections', () => {
  it('links projects that share a conversation, marking pending associations weak, ignoring rejected ones', () => {
    const l = assembleLandscape(
      input({
        projects: [project('p1'), project('p2'), project('p3')],
        associations: [
          association('p1', 'c1'),
          association('p2', 'c1'),
          association('p2', 'c2', { reviewState: 'pending' }),
          association('p3', 'c2'),
          association('p1', 'c3', { reviewState: 'rejected' }),
          association('p3', 'c3'),
        ],
        conversationNames: new Map([['c1', 'Shared']]),
      })
    );
    expect(l.connections.map((c) => [c.id, c.weak, c.conversationNames])).toEqual([
      ['p1~p2', false, ['Shared']],
      ['p2~p3', true, [null]],
    ]);
  });
});

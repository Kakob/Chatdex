import { describe, it, expect } from 'vitest';
import { assembleLandscape, UNCATEGORIZED_ID } from './projection';
import { assembleResume, parseVisit, visitTargetKey } from './resume';
import type { InspectionRow } from '../../types/repo';
import type { PreparedChange } from '../../types/preparedChange';
import type { UnderstandingObject, UnderstandingProject } from '../../types/understanding';

const T0 = new Date('2026-09-01T00:00:00Z');
const at = (h: number) => new Date(T0.getTime() + h * 3_600_000);
const project = (id: string): UnderstandingProject => ({ id, name: id, origin: 'user', reviewState: 'accepted', createdAt: T0, updatedAt: T0 });
// Objects "imported today" (createdAt late) must not read as recent user work.
const object = (id: string): UnderstandingObject => ({ id, projectId: 'p1', type: 'decision', title: id, status: 'current', origin: 'ai', reviewState: 'accepted', createdAt: at(500), updatedAt: at(500) });

const landscape = assembleLandscape({
  projects: [project('p1'), project('p2')],
  objects: [object('a'), object('b')],
  events: [{ id: 'e', objectId: 'a', op: 'introduced', evidence: [{ conversationId: 'c1' }], origin: 'ai', reviewState: 'accepted', occurredAt: T0, createdAt: at(500) }],
  associations: [],
  conversationNames: new Map(),
  regions: [],
});

const row = (targetKey: string, hour: number, projectId = 'p1'): InspectionRow => ({ id: `${targetKey}-${hour}`, projectId, kind: 'node', targetKey, at: at(hour) });

describe('visit keys', () => {
  it('round-trips each visit kind', () => {
    for (const visit of [
      { kind: 'region' as const, regionId: 'r1' },
      { kind: 'finding' as const, regionId: 'r1', objectId: 'a' },
      { kind: 'source' as const, regionId: UNCATEGORIZED_ID, objectId: 'a', conversationId: 'c1' },
    ]) {
      expect(parseVisit(row(visitTargetKey(visit), 1))).toMatchObject(visit);
    }
    expect(parseVisit(row('src/lib/file.ts', 1))).toBeNull();
  });
});

describe('assembleResume', () => {
  it('uses only recorded visits, newest first, dropping stale targets and dedupes', () => {
    const rows = [
      row(visitTargetKey({ kind: 'finding', regionId: UNCATEGORIZED_ID, objectId: 'a' }), 1),
      row(visitTargetKey({ kind: 'finding', regionId: UNCATEGORIZED_ID, objectId: 'b' }), 3),
      row(visitTargetKey({ kind: 'finding', regionId: UNCATEGORIZED_ID, objectId: 'a' }), 2),
      row(visitTargetKey({ kind: 'finding', regionId: UNCATEGORIZED_ID, objectId: 'deleted' }), 9),
      row(visitTargetKey({ kind: 'source', regionId: UNCATEGORIZED_ID, objectId: 'a', conversationId: 'gone' }), 8),
      row(visitTargetKey({ kind: 'region', regionId: 'deleted-region' }), 7),
      row(visitTargetKey({ kind: 'finding', regionId: UNCATEGORIZED_ID, objectId: 'a' }), 10, 'p2'),
    ];
    const resume = assembleResume(landscape, rows, []);
    const p1 = resume.get('p1')!;
    expect(p1.last).toMatchObject({ objectId: 'b', at: at(3) });
    expect(p1.recent.map((v) => v.objectId)).toEqual(['b', 'a']);
    expect(p1.visitCount).toBe(3);
    expect(resume.get('p2')!.last).toBeNull();
  });

  it('has no activity without visits, even for records imported just now', () => {
    expect(assembleResume(landscape, [], []).get('p1')).toMatchObject({ last: null, recent: [], visitCount: 0 });
  });

  it('lists active workspaces only, newest edit first', () => {
    const change = (id: string, state: PreparedChange['state'], hour: number) =>
      ({ id, projectId: 'p1', title: id, state, updatedAt: at(hour), understandingPointIds: ['a'] }) as unknown as PreparedChange;
    const resume = assembleResume(landscape, [], [change('old', 'draft', 1), change('done', 'closed', 9), change('new', 'implementing', 4)]);
    expect(resume.get('p1')!.workspaces.map((w) => w.id)).toEqual(['new', 'old']);
  });
});

import { describe, it, expect } from 'vitest';
import { assembleProjectMap } from './map';
import type {
  UnderstandingObject,
  UnderstandingEvent,
  UnderstandingOp,
  ReviewState,
} from '../../types/understanding';

let seq = 0;

function obj(overrides: Partial<UnderstandingObject> = {}): UnderstandingObject {
  const now = new Date('2026-08-01T00:00:00Z');
  return {
    id: `obj-${++seq}`,
    projectId: 'p1',
    type: 'direction',
    title: `Object ${seq}`,
    status: 'current',
    origin: 'ai',
    reviewState: 'accepted' as ReviewState,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function evt(
  objectId: string,
  overrides: Partial<UnderstandingEvent> & { op?: UnderstandingOp } = {}
): UnderstandingEvent {
  return {
    id: `evt-${++seq}`,
    objectId,
    op: 'introduced',
    evidence: [{ conversationId: 'c1' }],
    origin: 'ai',
    reviewState: 'accepted',
    occurredAt: new Date('2026-08-01T00:00:00Z'),
    createdAt: new Date('2026-08-02T00:00:00Z'),
    ...overrides,
  };
}

const at = (day: number) => new Date(`2026-08-${String(day).padStart(2, '0')}T00:00:00Z`);

describe('assembleProjectMap', () => {
  it('puts a supersession chain on one row in topological order', () => {
    const a = obj({ id: 'a', status: 'superseded' });
    const b = obj({ id: 'b', status: 'superseded' });
    const c = obj({ id: 'c' });
    const events = [
      evt('a', { occurredAt: at(1) }),
      evt('b', { occurredAt: at(3) }),
      evt('c', { occurredAt: at(5) }),
      evt('a', { op: 'superseded', supersededByObjectId: 'b', occurredAt: at(3) }),
      evt('b', { op: 'superseded', supersededByObjectId: 'c', occurredAt: at(5) }),
    ];
    const map = assembleProjectMap([a, b, c], events);
    const byId = new Map(map.nodes.map((n) => [n.objectId, n]));
    expect(byId.get('a')!.row).toBe(0);
    expect(byId.get('b')!.row).toBe(0);
    expect(byId.get('c')!.row).toBe(0);
    expect([byId.get('a')!.col, byId.get('b')!.col, byId.get('c')!.col]).toEqual([0, 1, 2]);
    expect(map.rowCount).toBe(1);
    expect(map.colCount).toBe(3);
  });

  it('gives unchained objects their own single-node rows', () => {
    const a = obj({ id: 'a' });
    const b = obj({ id: 'b' });
    const map = assembleProjectMap([a, b], [evt('a'), evt('b')]);
    expect(map.rowCount).toBe(2);
    expect(map.nodes.every((n) => n.col === 0)).toBe(true);
    expect(new Set(map.nodes.map((n) => n.row)).size).toBe(2);
  });

  it('orders rows most-recently-started chain first', () => {
    const oldOne = obj({ id: 'old', createdAt: at(1) });
    const newOne = obj({ id: 'new', createdAt: at(7) });
    const events = [
      evt('old', { occurredAt: at(1) }),
      evt('new', { occurredAt: at(7) }),
    ];
    const map = assembleProjectMap([oldOne, newOne], events);
    const byId = new Map(map.nodes.map((n) => [n.objectId, n]));
    expect(byId.get('new')!.row).toBe(0);
    expect(byId.get('old')!.row).toBe(1);
  });

  it('marks pending supersessions as unapplied edges that still group the chain', () => {
    const a = obj({ id: 'a' });
    const b = obj({ id: 'b' });
    const events = [
      evt('a'),
      evt('b'),
      evt('a', { op: 'superseded', supersededByObjectId: 'b', reviewState: 'pending' }),
    ];
    const map = assembleProjectMap([a, b], events);
    expect(map.edges).toEqual([{ fromId: 'a', toId: 'b', applied: false }]);
    expect(map.rowCount).toBe(1);
  });

  it('excludes rejected objects and rejected supersessions', () => {
    const a = obj({ id: 'a' });
    const b = obj({ id: 'b', reviewState: 'rejected' });
    const c = obj({ id: 'c' });
    const events = [
      evt('a'),
      evt('c'),
      evt('a', { op: 'superseded', supersededByObjectId: 'b' }),
      evt('a', { op: 'superseded', supersededByObjectId: 'c', reviewState: 'rejected' }),
    ];
    const map = assembleProjectMap([a, b, c], events);
    expect(map.nodes.map((n) => n.objectId).sort()).toEqual(['a', 'c']);
    expect(map.edges).toEqual([]);
    expect(map.rowCount).toBe(2);
  });

  it('collapses duplicate edges, applied winning over pending', () => {
    const a = obj({ id: 'a' });
    const b = obj({ id: 'b' });
    const events = [
      evt('a', { op: 'superseded', supersededByObjectId: 'b', reviewState: 'pending' }),
      evt('a', { op: 'superseded', supersededByObjectId: 'b', occurredAt: at(4) }),
    ];
    const map = assembleProjectMap([a, b], events);
    expect(map.edges).toEqual([{ fromId: 'a', toId: 'b', applied: true }]);
  });

  it('lays out a merge (two objects superseded by one) with the successor last', () => {
    const a = obj({ id: 'a', status: 'superseded' });
    const b = obj({ id: 'b', status: 'superseded' });
    const c = obj({ id: 'c' });
    const events = [
      evt('a', { occurredAt: at(1) }),
      evt('b', { occurredAt: at(2) }),
      evt('c', { occurredAt: at(3) }),
      evt('a', { op: 'superseded', supersededByObjectId: 'c' }),
      evt('b', { op: 'superseded', supersededByObjectId: 'c' }),
    ];
    const map = assembleProjectMap([a, b, c], events);
    const byId = new Map(map.nodes.map((n) => [n.objectId, n]));
    expect(map.rowCount).toBe(1);
    expect(byId.get('c')!.col).toBe(2);
    expect(byId.get('a')!.col).toBe(0);
    expect(byId.get('b')!.col).toBe(1);
  });

  it('terminates on a supersession cycle and keeps every node', () => {
    const a = obj({ id: 'a', createdAt: at(1) });
    const b = obj({ id: 'b', createdAt: at(2) });
    const events = [
      evt('a', { op: 'superseded', supersededByObjectId: 'b' }),
      evt('b', { op: 'superseded', supersededByObjectId: 'a' }),
    ];
    const map = assembleProjectMap([a, b], events);
    expect(map.nodes).toHaveLength(2);
    expect(map.rowCount).toBe(1);
    expect(new Set(map.nodes.map((n) => n.col))).toEqual(new Set([0, 1]));
  });

  it('uses the earliest non-rejected event as firstSeenAt, createdAt as fallback', () => {
    const a = obj({ id: 'a', createdAt: at(9) });
    const b = obj({ id: 'b', createdAt: at(9) });
    const events = [
      evt('a', { occurredAt: at(2) }),
      evt('a', { op: 'supported', occurredAt: at(6) }),
      evt('b', { op: 'refined', occurredAt: at(1), reviewState: 'rejected' }),
    ];
    const map = assembleProjectMap([a, b], events);
    const byId = new Map(map.nodes.map((n) => [n.objectId, n]));
    expect(byId.get('a')!.firstSeenAt).toEqual(at(2));
    expect(byId.get('b')!.firstSeenAt).toEqual(at(9));
  });

  it('returns an empty map for no objects', () => {
    const map = assembleProjectMap([], []);
    expect(map).toEqual({ nodes: [], edges: [], rowCount: 0, colCount: 0 });
  });
});

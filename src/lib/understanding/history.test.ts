import { describe, it, expect } from 'vitest';
import { assembleObjectHistory } from './history';
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

const names = new Map([['c1', 'Conversation one']]);

describe('assembleObjectHistory', () => {
  it('returns null for an unknown object id', () => {
    expect(assembleObjectHistory('nope', [obj()], [], names)).toBeNull();
  });

  it('orders the stream oldest-first by occurredAt, createdAt as tiebreak', () => {
    const a = obj({ id: 'a' });
    const events = [
      evt('a', {
        id: 'late',
        op: 'refined',
        occurredAt: new Date('2026-08-05T00:00:00Z'),
      }),
      evt('a', {
        id: 'tie-2nd',
        op: 'supported',
        occurredAt: new Date('2026-08-03T00:00:00Z'),
        createdAt: new Date('2026-08-04T00:00:00Z'),
      }),
      evt('a', {
        id: 'tie-1st',
        op: 'refined',
        occurredAt: new Date('2026-08-03T00:00:00Z'),
        createdAt: new Date('2026-08-03T12:00:00Z'),
      }),
      evt('a', { id: 'first', occurredAt: new Date('2026-08-01T00:00:00Z') }),
    ];
    const history = assembleObjectHistory('a', [a], events, names)!;
    expect(history.events.map((r) => r.event.id)).toEqual(['first', 'tie-1st', 'tie-2nd', 'late']);
  });

  it('includes rejected events in the stream (audit trail)', () => {
    const a = obj({ id: 'a' });
    const events = [
      evt('a'),
      evt('a', {
        id: 'rej',
        op: 'contradicted',
        reviewState: 'rejected',
        occurredAt: new Date('2026-08-03T00:00:00Z'),
      }),
    ];
    const history = assembleObjectHistory('a', [a], events, names)!;
    expect(history.events).toHaveLength(2);
    expect(history.events[1].event.reviewState).toBe('rejected');
  });

  it('replays status: applied status ops carry statusAfter, pending/rejected/neutral do not', () => {
    const a = obj({ id: 'a', status: 'superseded' });
    const events = [
      evt('a', { id: 'intro' }),
      evt('a', {
        id: 'support',
        op: 'supported',
        occurredAt: new Date('2026-08-02T00:00:00Z'),
      }),
      evt('a', {
        id: 'super',
        op: 'superseded',
        occurredAt: new Date('2026-08-03T00:00:00Z'),
      }),
      evt('a', {
        id: 'pend-reopen',
        op: 'reopened',
        reviewState: 'pending',
        occurredAt: new Date('2026-08-04T00:00:00Z'),
      }),
      evt('a', {
        id: 'rej-resolve',
        op: 'resolved',
        reviewState: 'rejected',
        occurredAt: new Date('2026-08-05T00:00:00Z'),
      }),
    ];
    const history = assembleObjectHistory('a', [a], events, names)!;
    const byId = new Map(history.events.map((r) => [r.event.id, r]));
    expect(byId.get('intro')!.statusAfter).toBe('current');
    expect(byId.get('support')!.statusAfter).toBeUndefined();
    expect(byId.get('super')!.statusAfter).toBe('superseded');
    expect(byId.get('pend-reopen')!.statusAfter).toBeUndefined();
    expect(byId.get('rej-resolve')!.statusAfter).toBeUndefined();
  });

  it('resolves supersededByTitle on event rows', () => {
    const a = obj({ id: 'a', status: 'superseded' });
    const b = obj({ id: 'b', title: 'The new direction' });
    const events = [
      evt('a'),
      evt('a', {
        op: 'superseded',
        supersededByObjectId: 'b',
        occurredAt: new Date('2026-08-03T00:00:00Z'),
      }),
    ];
    const history = assembleObjectHistory('a', [a, b], events, names)!;
    expect(history.events[1].supersededByTitle).toBe('The new direction');
  });

  it('walks the forward supersession chain across hops and lists direct predecessors', () => {
    const a = obj({ id: 'a', status: 'superseded' });
    const b = obj({ id: 'b', status: 'superseded' });
    const c = obj({ id: 'c' });
    const events = [
      evt('a'),
      evt('b'),
      evt('c'),
      evt('a', { op: 'superseded', supersededByObjectId: 'b' }),
      evt('b', { op: 'superseded', supersededByObjectId: 'c' }),
    ];
    const fromA = assembleObjectHistory('a', [a, b, c], events, names)!;
    expect(fromA.replacedBy.map((e) => e.objectId)).toEqual(['b', 'c']);
    expect(fromA.replaces).toEqual([]);

    const fromB = assembleObjectHistory('b', [a, b, c], events, names)!;
    expect(fromB.replacedBy.map((e) => e.objectId)).toEqual(['c']);
    expect(fromB.replaces.map((e) => e.objectId)).toEqual(['a']);
  });

  it('ignores pending and rejected supersessions for chain navigation', () => {
    const a = obj({ id: 'a' });
    const b = obj({ id: 'b' });
    const c = obj({ id: 'c' });
    const events = [
      evt('a'),
      evt('a', { op: 'superseded', supersededByObjectId: 'b', reviewState: 'pending' }),
      evt('a', { op: 'superseded', supersededByObjectId: 'c', reviewState: 'rejected' }),
    ];
    const history = assembleObjectHistory('a', [a, b, c], events, names)!;
    expect(history.replacedBy).toEqual([]);
    expect(assembleObjectHistory('b', [a, b, c], events, names)!.replaces).toEqual([]);
  });

  it('terminates on a supersession cycle', () => {
    const a = obj({ id: 'a' });
    const b = obj({ id: 'b' });
    const events = [
      evt('a', { op: 'superseded', supersededByObjectId: 'b' }),
      evt('b', { op: 'superseded', supersededByObjectId: 'a' }),
    ];
    const history = assembleObjectHistory('a', [a, b], events, names)!;
    expect(history.replacedBy.map((e) => e.objectId)).toEqual(['b']);
  });

  it('follows the latest applied supersession when an object has several', () => {
    const a = obj({ id: 'a', status: 'superseded' });
    const b = obj({ id: 'b' });
    const c = obj({ id: 'c' });
    const events = [
      evt('a', {
        op: 'superseded',
        supersededByObjectId: 'b',
        occurredAt: new Date('2026-08-03T00:00:00Z'),
      }),
      evt('a', {
        op: 'superseded',
        supersededByObjectId: 'c',
        occurredAt: new Date('2026-08-05T00:00:00Z'),
      }),
    ];
    const history = assembleObjectHistory('a', [a, b, c], events, names)!;
    expect(history.replacedBy.map((e) => e.objectId)).toEqual(['c']);
  });

  it('resolves evidence names, null for deleted conversations', () => {
    const a = obj({ id: 'a' });
    const events = [
      evt('a', { evidence: [{ conversationId: 'c1' }, { conversationId: 'gone' }] }),
    ];
    const history = assembleObjectHistory('a', [a], events, names)!;
    const links = history.events[0].evidence;
    expect(links.find((l) => l.conversationId === 'c1')?.conversationName).toBe(
      'Conversation one'
    );
    expect(links.find((l) => l.conversationId === 'gone')?.conversationName).toBeNull();
  });
});

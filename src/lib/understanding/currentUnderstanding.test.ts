import { describe, it, expect } from 'vitest';
import { assembleCurrentUnderstanding, mergeEvidence } from './currentUnderstanding';
import type {
  UnderstandingObject,
  UnderstandingEvent,
  UnderstandingOp,
  ReviewState,
  EvidenceRef,
} from '../../types/understanding';

let seq = 0;

function obj(overrides: Partial<UnderstandingObject> = {}): UnderstandingObject {
  const now = new Date('2026-08-01T00:00:00Z');
  return {
    id: `obj-${++seq}`,
    projectId: 'p1',
    type: 'idea',
    title: `Object ${seq}`,
    status: 'current',
    origin: 'ai',
    reviewState: 'pending' as ReviewState,
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
    occurredAt: new Date('2026-08-01T00:00:00Z'),
    createdAt: new Date('2026-08-02T00:00:00Z'),
    ...overrides,
  };
}

const names = new Map([
  ['c1', 'First conversation'],
  ['c2', 'Second conversation'],
]);

describe('mergeEvidence', () => {
  it('dedupes by conversation, merging messageIds and keeping the first note', () => {
    const events = [
      evt('o', {
        evidence: [
          { conversationId: 'c1', messageIds: ['m1'], note: 'first note' },
          { conversationId: 'c2' },
        ],
      }),
      evt('o', {
        evidence: [{ conversationId: 'c1', messageIds: ['m1', 'm2'], note: 'later note' }],
      }),
    ];
    const merged = mergeEvidence(events, names);
    expect(merged).toHaveLength(2);
    const c1 = merged.find((e) => e.conversationId === 'c1')!;
    expect(c1.messageIds).toEqual(['m1', 'm2']);
    expect(c1.note).toBe('first note');
    expect(c1.conversationName).toBe('First conversation');
  });

  it('marks deleted conversations with a null name', () => {
    const merged = mergeEvidence([evt('o', { evidence: [{ conversationId: 'gone' }] })], names);
    expect(merged[0].conversationName).toBeNull();
  });
});

describe('assembleCurrentUnderstanding', () => {
  it('routes types to sections: direction, question, everything else together', () => {
    const objects = [
      obj({ id: 'd', type: 'direction' }),
      obj({ id: 'q', type: 'question' }),
      obj({ id: 'dec', type: 'decision' }),
      obj({ id: 'goal', type: 'goal' }),
    ];
    const events = objects.map((o) => evt(o.id));
    const u = assembleCurrentUnderstanding(objects, events, names);
    expect(u.direction.map((i) => i.object.id)).toEqual(['d']);
    expect(u.openQuestions.map((i) => i.object.id)).toEqual(['q']);
    expect(u.ideasAndDecisions.map((i) => i.object.id).sort()).toEqual(['dec', 'goal']);
  });

  it('excludes rejected objects everywhere, including recent changes', () => {
    const objects = [obj({ id: 'ok' }), obj({ id: 'bad', reviewState: 'rejected' })];
    const events = [evt('ok'), evt('bad')];
    const u = assembleCurrentUnderstanding(objects, events, names);
    expect(u.ideasAndDecisions).toHaveLength(1);
    expect(u.recentChanges.map((c) => c.event.objectId)).toEqual(['ok']);
  });

  it('keeps superseded/resolved objects out of sections but their events in recent changes', () => {
    const objects = [obj({ id: 'old', type: 'direction', status: 'superseded' })];
    const events = [
      evt('old', { occurredAt: new Date('2026-07-01T00:00:00Z') }),
      evt('old', { op: 'superseded', occurredAt: new Date('2026-08-05T00:00:00Z') }),
    ];
    const u = assembleCurrentUnderstanding(objects, events, names);
    expect(u.direction).toHaveLength(0);
    expect(u.recentChanges).toHaveLength(2);
    expect(u.recentChanges[0].event.op).toBe('superseded');
  });

  it('orders sections and recent changes by source-timeline recency', () => {
    const objects = [obj({ id: 'a' }), obj({ id: 'b' })];
    const events = [
      evt('a', { occurredAt: new Date('2026-08-01T00:00:00Z') }),
      evt('b', { occurredAt: new Date('2026-08-06T00:00:00Z') }),
      evt('a', { op: 'refined', occurredAt: new Date('2026-08-08T00:00:00Z') }),
    ];
    const u = assembleCurrentUnderstanding(objects, events, names);
    expect(u.ideasAndDecisions.map((i) => i.object.id)).toEqual(['a', 'b']);
    expect(u.ideasAndDecisions[0].lastActivityAt).toEqual(new Date('2026-08-08T00:00:00Z'));
    expect(u.recentChanges.map((c) => c.event.op)).toEqual([
      'refined',
      'introduced',
      'introduced',
    ]);
  });

  it('caps recent changes at recentLimit', () => {
    const o = obj({ id: 'a' });
    const events = Array.from({ length: 5 }, (_, i) =>
      evt('a', { occurredAt: new Date(2026, 0, i + 1) })
    );
    const u = assembleCurrentUnderstanding([o], events, names, { recentLimit: 3 });
    expect(u.recentChanges).toHaveLength(3);
  });

  it('unions evidence across an object\'s events', () => {
    const o = obj({ id: 'a' });
    const events = [
      evt('a', { evidence: [{ conversationId: 'c1' }] as EvidenceRef[] }),
      evt('a', {
        op: 'supported',
        evidence: [{ conversationId: 'c2' }] as EvidenceRef[],
        occurredAt: new Date('2026-08-03T00:00:00Z'),
      }),
    ];
    const u = assembleCurrentUnderstanding([o], events, names);
    expect(u.ideasAndDecisions[0].evidence.map((e) => e.conversationId).sort()).toEqual([
      'c1',
      'c2',
    ]);
  });
});

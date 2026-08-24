import { describe, it, expect } from 'vitest';
import {
  envelopeUnderstandingProject,
  rehydrateUnderstandingProject,
  envelopeProjectAssociation,
  rehydrateProjectAssociation,
  envelopeUnderstandingObject,
  rehydrateUnderstandingObject,
  envelopeUnderstandingEvent,
  rehydrateUnderstandingEvent,
  envelopePreparedChange,
  rehydratePreparedChange,
  envelopeInvestigationFinding,
  rehydrateInvestigationFinding,
} from './serializer';
import type { PreparedChange } from '../../types/preparedChange';
import type { InvestigationFinding } from '../../types/investigation';
import type {
  UnderstandingProject,
  ProjectAssociation,
  UnderstandingObject,
  UnderstandingEvent,
} from '../../types/understanding';

// Round-trip invariant: envelope payloads are JSON-safe (Dates → ISO strings)
// and rehydration restores the original row exactly. JSON.parse(JSON.stringify)
// simulates the encrypt → wire → decrypt path.

function throughWire<T>(payload: unknown, rehydrate: (p: unknown) => T): T {
  return rehydrate(JSON.parse(JSON.stringify(payload)));
}

const createdAt = new Date('2026-08-01T10:00:00Z');
const updatedAt = new Date('2026-08-02T10:00:00Z');

describe('understanding sync serializers', () => {
  it('round-trips understanding projects; parentId is null', () => {
    const p: UnderstandingProject = {
      id: 'up-1',
      name: 'Chatdex',
      description: 'Shared understanding workspace',
      origin: 'ai',
      reviewState: 'pending',
      createdAt,
      updatedAt,
    };
    const env = envelopeUnderstandingProject(p);
    expect(env.kind).toBe('understanding_project');
    expect(env.parentId).toBeNull();
    expect(env.updatedAt).toEqual(updatedAt);
    expect(throughWire(env.payload, rehydrateUnderstandingProject)).toEqual(p);
  });

  it('round-trips associations; parentId is the conversation', () => {
    const a: ProjectAssociation = {
      id: 'pa-1',
      projectId: 'up-1',
      conversationId: 'conv-819',
      confidence: 0.94,
      reason: 'Primarily discusses living documents',
      origin: 'ai',
      reviewState: 'pending',
      createdAt,
      updatedAt,
    };
    const env = envelopeProjectAssociation(a);
    expect(env.kind).toBe('project_association');
    expect(env.parentId).toBe('conv-819');
    expect(throughWire(env.payload, rehydrateProjectAssociation)).toEqual(a);
  });

  it('round-trips objects; parentId is the project (null allowed)', () => {
    const o: UnderstandingObject = {
      id: 'uo-1',
      projectId: 'up-1',
      type: 'decision',
      title: 'Use Dexie for local storage',
      body: 'IndexedDB via Dexie 4.',
      status: 'current',
      origin: 'ai',
      reviewState: 'accepted',
      createdAt,
      updatedAt,
    };
    const env = envelopeUnderstandingObject(o);
    expect(env.kind).toBe('understanding_object');
    expect(env.parentId).toBe('up-1');
    expect(throughWire(env.payload, rehydrateUnderstandingObject)).toEqual(o);

    const orphan = envelopeUnderstandingObject({ ...o, projectId: null });
    expect(orphan.parentId).toBeNull();
  });

  it('round-trips events with evidence intact; parentId is the object', () => {
    const e: UnderstandingEvent = {
      id: 'ue-1',
      objectId: 'uo-1',
      op: 'superseded',
      detail: 'Direction changed to agent observability',
      supersededByObjectId: 'uo-2',
      evidence: [
        { conversationId: 'conv-1', messageIds: ['m1', 'm2'], note: 'pivot discussion' },
        { conversationId: 'conv-2' },
      ],
      origin: 'ai',
      reviewState: 'pending',
      occurredAt: createdAt,
      createdAt: updatedAt,
    };
    const env = envelopeUnderstandingEvent(e);
    expect(env.kind).toBe('understanding_event');
    expect(env.parentId).toBe('uo-1');
    expect(env.updatedAt).toEqual(e.createdAt);
    expect(throughWire(env.payload, rehydrateUnderstandingEvent)).toEqual(e);
  });

  it('LWW keys reviewed events on their review moment', () => {
    const e: UnderstandingEvent = {
      id: 'ue-2',
      objectId: 'uo-1',
      op: 'supported',
      evidence: [{ conversationId: 'conv-1' }],
      origin: 'ai',
      reviewState: 'accepted',
      occurredAt: createdAt,
      createdAt,
      updatedAt,
    };
    const env = envelopeUnderstandingEvent(e);
    expect(env.updatedAt).toEqual(updatedAt);
    expect(throughWire(env.payload, rehydrateUnderstandingEvent)).toEqual(e);
  });

  it('rehydrates pre-U3.1 event payloads as accepted AI events', () => {
    const legacy = {
      id: 'ue-old',
      objectId: 'uo-1',
      op: 'introduced',
      evidence: [{ conversationId: 'conv-1' }],
      occurredAt: createdAt.toISOString(),
      createdAt: createdAt.toISOString(),
    };
    const rehydrated = rehydrateUnderstandingEvent(JSON.parse(JSON.stringify(legacy)));
    expect(rehydrated.origin).toBe('ai');
    expect(rehydrated.reviewState).toBe('accepted');
    expect(rehydrated.updatedAt).toBeUndefined();
  });
});

describe('prepared change sync serializer', () => {
  it('round-trips human-authored handoffs with readiness timestamps', () => {
    const change: PreparedChange = {
      id: 'pc-1',
      projectId: 'up-1',
      title: 'Contestant judging',
      state: 'ready',
      desiredOutcome: 'Use contestant ballots.',
      rationale: 'Taste should remain plural.',
      nonGoals: ['Matchmaking'],
      constraints: ['Keep identities hidden'],
      acceptanceCriteria: ['Reveal after all ballots'],
      openImplementationChoices: ['Tie aggregation'],
      understandingPointIds: ['uo-1'],
      investigationFindingIds: [],
      evidenceRefs: [
        {
          understandingPointId: 'uo-1',
          conversationId: 'conv-1',
          messageIds: ['m-1'],
        },
      ],
      createdAt,
      updatedAt,
      readyAt: updatedAt,
    };
    const env = envelopePreparedChange(change);
    expect(env.kind).toBe('prepared_change');
    expect(env.parentId).toBe('up-1');
    expect(throughWire(env.payload, rehydratePreparedChange)).toEqual(change);
  });
});

describe('investigation finding sync serializer', () => {
  it('round-trips finalized human findings and their evidence links', () => {
    const finding: InvestigationFinding = {
      id: 'if-1',
      caseId: 'case-1',
      projectId: 'up-1',
      type: 'constraint',
      title: 'Keep ballots hidden until everyone votes',
      body: 'Early reveals would bias later contestants.',
      confidence: 'high',
      exhibitIds: ['exhibit-1'],
      reviewScopeIds: ['scope-1'],
      state: 'finalized',
      promotedUnderstandingObjectId: 'uo-1',
      createdAt,
      updatedAt,
      finalizedAt: updatedAt,
    };
    const env = envelopeInvestigationFinding(finding);
    expect(env.kind).toBe('investigation_finding');
    expect(env.parentId).toBe('case-1');
    expect(throughWire(env.payload, rehydrateInvestigationFinding)).toEqual(finding);
  });
});

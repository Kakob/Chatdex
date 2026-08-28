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
  envelopeIntentTrace,
  rehydrateIntentTrace,
} from './serializer';
import type { IntentTrace } from '../../types/intentTrace';
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

  it('round-trips a project with a repository binding and both cursors', () => {
    const p: UnderstandingProject = {
      id: 'up-2',
      name: 'Chatdex',
      origin: 'user',
      reviewState: 'accepted',
      repository: { owner: 'Kakob', repo: 'Chatdex', defaultBranch: 'main', pinnedRef: 'v1' },
      lastReconciledAt: createdAt,
      lastIntentExtractedAt: updatedAt,
      createdAt,
      updatedAt,
    };
    const env = envelopeUnderstandingProject(p);
    const back = throughWire(env.payload, rehydrateUnderstandingProject);
    expect(back).toEqual(p);
    expect(back.lastIntentExtractedAt).toBeInstanceOf(Date);
  });

  it('round-trips objects carrying intent meta', () => {
    const o: UnderstandingObject = {
      id: 'uo-intent',
      projectId: 'up-1',
      type: 'intent',
      title: 'Badge on the sidebar',
      body: 'I want the badge on the sidebar',
      status: 'current',
      origin: 'ai',
      reviewState: 'pending',
      meta: { polarity: 'want', origin: 'unprompted', promptedByQuestion: false, confidence: 0.8 },
      createdAt,
      updatedAt,
    };
    expect(throughWire(envelopeUnderstandingObject(o).payload, rehydrateUnderstandingObject)).toEqual(o);
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

  it('round-trips a fully populated Change Workspace and keeps sections out of the cleartext envelope (S9)', () => {
    const iso = '2026-08-28T10:00:00.000Z';
    const change: PreparedChange = {
      id: 'pc-2',
      projectId: 'up-1',
      title: 'Search result scrolls to the match',
      state: 'closed',
      desiredOutcome: 'Opens and scrolls.',
      rationale: 'Search is navigation.',
      nonGoals: [],
      constraints: [],
      acceptanceCriteria: ['The match enters the viewport.'],
      openImplementationChoices: [],
      understandingPointIds: [],
      investigationFindingIds: [],
      evidenceRefs: [],
      intent: { currentBehavior: 'Opens only.', desiredBehavior: 'Opens and scrolls.', whyItMatters: 'Search is navigation.' },
      criteria: [{ id: 'c1', text: 'The match enters the viewport.', createdAt: iso }],
      evidence: [
        {
          id: 'e1', kind: 'code', createdAt: iso, origin: 'user', addedVia: 'search',
          repoKey: 'gh:Kakob/Chatdex', sha: 'a'.repeat(40), path: 'src/pages/SearchPage.tsx',
          startLine: 10, endLine: 12, quote: 'navigate(...)', quoteHash: 'deadbeef',
        },
        {
          id: 'e2', kind: 'ai_inference', createdAt: iso, origin: 'ai', addedVia: 'assisted',
          runId: 'run-1', provider: 'anthropic', promptDigest: 'abc', text: 'Maybe here.', checkedAgainst: ['e1'],
        },
      ],
      trace: {
        nodes: [
          { id: 'n1', label: 'SearchPage', kind: 'component', evidenceIds: ['e1'], order: 0 },
          { id: 'n2', label: '???', kind: 'unknown', evidenceIds: [], order: 1 },
        ],
        edges: [{ id: 'x1', from: 'n1', to: 'n2', claim: 'navigates', evidenceIds: [], origin: 'user' }],
      },
      hypotheses: [{ id: 'h1', text: 'Only the conversation id survives.', createdAt: iso, frozenAt: iso, origin: 'user' }],
      implementation: {
        source: 'claude_code_session', provenance: 'ai', conversationId: 'conv-1',
        files: [{ path: 'src/pages/ConversationsPage.tsx', additions: 12, deletions: 3 }], attachedAt: iso,
      },
      implementationHistory: [],
      verification: [{ criterionId: 'c1', evidenceIds: ['e1'], status: 'supported', updatedAt: iso }],
      learned: { text: 'Scrolling belongs to ConversationsPage.', createdAt: iso, updatedAt: iso, aiSuggested: 'draft' },
      promotions: [{ evidenceIds: ['e1'], understandingObjectId: 'uo-9', promotedAt: iso }],
      questionIds: ['uo-q1'],
      mode: 'guided',
      modeHistory: [{ mode: 'guided', at: iso }],
      originRef: { kind: 'manual' },
      createdAt,
      updatedAt,
      readyAt: updatedAt,
      implementingAt: updatedAt,
      verifiedAt: updatedAt,
      closedAt: updatedAt,
    };
    const env = envelopePreparedChange(change);
    expect(Object.keys(env).sort()).toEqual(['kind', 'parentId', 'payload', 'updatedAt']);
    const revived = throughWire(env.payload, rehydratePreparedChange);
    expect(revived).toEqual(change);
    for (const key of ['implementingAt', 'verifiedAt', 'closedAt'] as const) {
      expect(revived[key]).toBeInstanceOf(Date);
    }
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

describe('intent trace sync serializer', () => {
  const trace: IntentTrace = {
    id: 'it-1',
    projectId: 'up-1',
    intentObjectId: 'uo-intent',
    repoRef: { owner: 'Kakob', repo: 'Chatdex', commitSha: 'c'.repeat(40), ref: 'main' },
    specStatus: 'specified',
    specEvidence: [{ path: 'docs/SPEC-x.md', startLine: 10, endLine: 12, quote: 'The badge lives in the sidebar.' }],
    specRationale: 'Spec names the sidebar.',
    implStatus: 'implemented',
    implEvidence: [{ path: 'src/Sidebar.tsx', startLine: 40, endLine: 44, quote: '<Badge count={pending} />' }],
    implRationale: 'Badge rendered from pending count.',
    suggestedPaths: ['src/pendingReviews.ts'],
    commitEvidence: [
      { sha: 'd'.repeat(40), path: 'src/Sidebar.tsx', message: 'feat: badge', authoredAt: createdAt, url: 'https://github.com/Kakob/Chatdex/commit/' + 'd'.repeat(40) },
    ],
    fetchedPaths: ['src/Sidebar.tsx', 'docs/SPEC-x.md'],
    provider: 'anthropic',
    model: 'claude-opus-5',
    warnings: [],
    createdAt: updatedAt,
  };

  it('round-trips traces incl. nested commit dates; parentId is the intent object', () => {
    const env = envelopeIntentTrace(trace);
    expect(env.kind).toBe('intent_trace');
    expect(env.parentId).toBe('uo-intent');
    expect(env.updatedAt).toEqual(trace.createdAt);
    const back = throughWire(env.payload, rehydrateIntentTrace);
    expect(back).toEqual(trace);
    expect(back.commitEvidence?.[0].authoredAt).toBeInstanceOf(Date);
  });

  it('round-trips traces without optional fields', () => {
    const minimal: IntentTrace = {
      ...trace,
      specStatus: 'no_spec',
      specEvidence: [],
      specRationale: undefined,
      implStatus: 'unknown',
      implEvidence: [],
      implRationale: undefined,
      suggestedPaths: undefined,
      commitEvidence: undefined,
      warnings: ['no candidate files'],
    };
    const back = throughWire(envelopeIntentTrace(minimal).payload, rehydrateIntentTrace);
    expect(back.commitEvidence).toBeUndefined();
    expect(back.warnings).toEqual(['no candidate files']);
  });

  it('keeps repository details out of the cleartext envelope (audit S9)', () => {
    const env = envelopeIntentTrace(trace);
    // Only kind / parentId / updatedAt are visible to the server; everything
    // else — owner, repo, sha, paths, quotes — is inside `payload`, which is
    // what gets encrypted.
    expect(Object.keys(env).sort()).toEqual(['kind', 'parentId', 'payload', 'updatedAt']);
    expect(JSON.stringify({ kind: env.kind, parentId: env.parentId, updatedAt: env.updatedAt })).not.toContain('Kakob');
  });
});

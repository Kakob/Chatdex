import { describe, it, expect } from 'vitest';
import { assembleProjectSummary, type ProjectSummaryInput } from './projectSummary';
import type {
  ProjectAssociation,
  UnderstandingEvent,
  UnderstandingObject,
  UnderstandingProject,
} from '../../types/understanding';
import type { InvestigationCase, InvestigationFinding } from '../../types/investigation';
import type { PreparedChange } from '../../types/preparedChange';

const T0 = new Date('2026-10-01T00:00:00Z');
const day = (n: number) => new Date(T0.getTime() + n * 86_400_000);

const project: UnderstandingProject = { id: 'p1', name: 'P', origin: 'ai', reviewState: 'accepted', createdAt: T0, updatedAt: T0 };

function link(id: string, reviewState: ProjectAssociation['reviewState']): ProjectAssociation {
  return { id, projectId: 'p1', conversationId: `c-${id}`, confidence: 0.9, origin: 'ai', reviewState, createdAt: T0, updatedAt: T0 };
}
function object(id: string, overrides: Partial<UnderstandingObject> = {}): UnderstandingObject {
  return { id, projectId: 'p1', type: 'decision', title: id, status: 'current', origin: 'ai', reviewState: 'accepted', createdAt: T0, updatedAt: T0, ...overrides };
}
function event(id: string, objectId: string, reviewState: UnderstandingEvent['reviewState']): UnderstandingEvent {
  return { id, objectId, op: 'refined', evidence: [], origin: 'ai', reviewState, occurredAt: T0, createdAt: T0 };
}
function investigation(id: string, state: InvestigationCase['state'], updatedAt = T0): InvestigationCase {
  return { id, projectId: 'p1', conversationId: 'c', linkedAnchorStableKeys: [], kind: 'question', title: id, notes: '', state, searchRecords: [], createdAt: T0, updatedAt };
}
function finding(id: string, overrides: Partial<InvestigationFinding> = {}): InvestigationFinding {
  return { id, caseId: 'k1', projectId: 'p1', type: 'belief', title: id, confidence: 'medium', exhibitIds: [], reviewScopeIds: [], state: 'finalized', createdAt: T0, updatedAt: T0, ...overrides };
}
function change(id: string, state: PreparedChange['state'], updatedAt = T0): PreparedChange {
  return {
    id, projectId: 'p1', title: id, state, desiredOutcome: '', rationale: '', nonGoals: [], constraints: [],
    acceptanceCriteria: [], openImplementationChoices: [], understandingPointIds: [], investigationFindingIds: [],
    evidenceRefs: [], createdAt: T0, updatedAt,
  };
}
function input(overrides: Partial<ProjectSummaryInput> = {}): ProjectSummaryInput {
  return { project, associations: [], researchSourceCount: 0, cases: [], findings: [], pinnedEvidence: 0, objects: [], events: [], changes: [], ...overrides };
}

describe('assembleProjectSummary', () => {
  it('reports an empty project as zeros and never-updated', () => {
    const s = assembleProjectSummary(input());
    expect(s.investigate).toMatchObject({ sources: 0, investigations: 0, findings: 0, lastActivityAt: null });
    expect(s.understanding).toMatchObject({ current: 0, awaitingReview: 0, lastUpdatedAt: null });
    expect(s.prepare).toMatchObject({ changes: 0, readyPoints: 0, lastEditedAt: null });
  });

  it('counts only accepted links as Investigate sources and pending ones as suggested', () => {
    const s = assembleProjectSummary(
      input({ associations: [link('a', 'accepted'), link('e', 'edited'), link('p', 'pending'), link('r', 'rejected')], researchSourceCount: 2 })
    );
    expect(s.investigate).toMatchObject({ sources: 2, suggestedSources: 1, researchSources: 2 });
  });

  it('summarizes investigations and their findings', () => {
    const s = assembleProjectSummary(
      input({
        cases: [investigation('k1', 'open', day(2)), investigation('k2', 'completed'), investigation('k3', 'reopened')],
        findings: [finding('f1', { promotedUnderstandingObjectId: 'o1' }), finding('f2', { state: 'draft', updatedAt: day(5) }), finding('f3')],
        pinnedEvidence: 7,
      })
    );
    expect(s.investigate).toMatchObject({ investigations: 3, openInvestigations: 2, findings: 3, draftFindings: 1, promotedFindings: 1, pinnedEvidence: 7, lastActivityAt: day(5) });
  });

  it('matches the Current Understanding page: no rejected items or intents, pending counted as awaiting review', () => {
    const s = assembleProjectSummary(
      input({
        project: { ...project, lastReconciledAt: day(3) },
        objects: [
          object('dir', { type: 'direction' }),
          object('q', { type: 'question', reviewState: 'pending' }),
          object('mine', { origin: 'user' }),
          object('old', { status: 'superseded' }),
          object('rej', { reviewState: 'rejected' }),
          object('intent', { type: 'intent' }),
        ],
        events: [event('e1', 'dir', 'pending'), event('e2', 'rej', 'pending')],
      })
    );
    expect(s.understanding).toEqual({
      current: 3,
      direction: 1,
      ideasAndDecisions: 1,
      openQuestions: 1,
      awaitingReview: 1,
      proposedChanges: 1,
      byYou: 1,
      byAi: 2,
      earlier: 1,
      lastUpdatedAt: day(3),
    });
    // Prepare Change can only use the accepted current ones.
    expect(s.prepare.readyPoints).toBe(2);
  });

  it('groups prepared changes by progress', () => {
    const s = assembleProjectSummary(
      input({ changes: [change('a', 'draft'), change('b', 'implementing', day(4)), change('c', 'verified'), change('d', 'closed'), change('e', 'superseded')] })
    );
    expect(s.prepare).toMatchObject({ changes: 5, inProgress: 2, finished: 2, lastEditedAt: day(4) });
  });
});

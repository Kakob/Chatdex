// Project overview summary: what has been built so far in each workflow step
// (Investigate History, Current Understanding, Prepare Change) for one project.
//
// Pure assembly over rows the store already holds, using the same inclusion
// rules as the pages it summarizes so the numbers agree with what opening the
// step shows:
//   - Investigate reads only accepted/edited conversation links (InvestigatePage);
//     pending links are counted separately as suggested sources.
//   - Current Understanding uses assembleCurrentUnderstanding (rejected objects
//     and intents excluded; pending objects included and counted as awaiting review).
//   - Prepare Change offers only current accepted/edited points (PrepareChangePage).
// Read-only; no provider calls.

import { db } from '../db/schema';
import { getAssociationsForProject, getObjectsForProject, getUnderstandingProject } from '../db/understanding';
import { listInvestigationCases } from '../db/investigationCases';
import { assembleCurrentUnderstanding } from './currentUnderstanding';
import type {
  ProjectAssociation,
  UnderstandingEvent,
  UnderstandingObject,
  UnderstandingProject,
} from '../../types/understanding';
import type { InvestigationCase, InvestigationFinding } from '../../types/investigation';
import type { PreparedChange } from '../../types/preparedChange';

export interface InvestigateSummary {
  /** Accepted conversation links — the sources Investigate History reads. */
  sources: number;
  /** Pending conversation links awaiting review on the Projects page. */
  suggestedSources: number;
  /** Research-shelf sources registered for this project. */
  researchSources: number;
  investigations: number;
  /** Investigations not yet completed or adjudicated. */
  openInvestigations: number;
  findings: number;
  draftFindings: number;
  /** Findings promoted into Current Understanding. */
  promotedFindings: number;
  /** Exhibits pinned in this project's investigations (conversation + research). */
  pinnedEvidence: number;
  lastActivityAt: Date | null;
}

export interface UnderstandingSummary {
  /** Current items on the Current Understanding page, pending included. */
  current: number;
  direction: number;
  ideasAndDecisions: number;
  openQuestions: number;
  /** Current items still awaiting review. */
  awaitingReview: number;
  /** Pending proposed changes to existing items. */
  proposedChanges: number;
  /** Current items added by the user (manually or promoted from an investigation). */
  byYou: number;
  /** Current items proposed by AI discovery or Update understanding. */
  byAi: number;
  /** Superseded or resolved items, kept as history. */
  earlier: number;
  /** When Update understanding last ran; null when never. */
  lastUpdatedAt: Date | null;
}

export interface PrepareSummary {
  changes: number;
  /** Draft, ready, or implementing. */
  inProgress: number;
  /** Verified or closed. */
  finished: number;
  /** Accepted current understanding points Prepare Change can use. */
  readyPoints: number;
  lastEditedAt: Date | null;
}

export interface ProjectSummary {
  investigate: InvestigateSummary;
  understanding: UnderstandingSummary;
  prepare: PrepareSummary;
}

export interface ProjectSummaryInput {
  project: UnderstandingProject;
  associations: ProjectAssociation[];
  researchSourceCount: number;
  cases: InvestigationCase[];
  findings: InvestigationFinding[];
  pinnedEvidence: number;
  objects: UnderstandingObject[];
  events: UnderstandingEvent[];
  changes: PreparedChange[];
}

const OPEN_CASE_STATES = new Set<InvestigationCase['state']>(['draft', 'open', 'reopened']);
const IN_PROGRESS_STATES = new Set<PreparedChange['state']>(['draft', 'ready', 'implementing']);
const FINISHED_STATES = new Set<PreparedChange['state']>(['verified', 'closed']);

function latest(dates: Date[]): Date | null {
  return dates.reduce<Date | null>((max, d) => (!max || d > max ? d : max), null);
}

export function assembleProjectSummary(input: ProjectSummaryInput): ProjectSummary {
  const { project, associations, cases, findings, objects, events, changes } = input;

  const reviewed = (state: string) => state === 'accepted' || state === 'edited';
  const understanding = assembleCurrentUnderstanding(objects, events, new Map());
  const current = [
    ...understanding.direction,
    ...understanding.ideasAndDecisions,
    ...understanding.openQuestions,
  ].map((item) => item.object);
  const included = objects.filter((o) => o.reviewState !== 'rejected' && o.type !== 'intent');

  return {
    investigate: {
      sources: associations.filter((a) => reviewed(a.reviewState)).length,
      suggestedSources: associations.filter((a) => a.reviewState === 'pending').length,
      researchSources: input.researchSourceCount,
      investigations: cases.length,
      openInvestigations: cases.filter((c) => OPEN_CASE_STATES.has(c.state)).length,
      findings: findings.length,
      draftFindings: findings.filter((f) => f.state === 'draft').length,
      promotedFindings: findings.filter((f) => f.promotedUnderstandingObjectId).length,
      pinnedEvidence: input.pinnedEvidence,
      lastActivityAt: latest([...cases.map((c) => c.updatedAt), ...findings.map((f) => f.updatedAt)]),
    },
    understanding: {
      current: current.length,
      direction: understanding.direction.length,
      ideasAndDecisions: understanding.ideasAndDecisions.length,
      openQuestions: understanding.openQuestions.length,
      awaitingReview: current.filter((o) => o.reviewState === 'pending').length,
      proposedChanges: understanding.pendingChanges.length,
      byYou: current.filter((o) => o.origin === 'user').length,
      byAi: current.filter((o) => o.origin === 'ai').length,
      earlier: included.filter((o) => o.status !== 'current').length,
      lastUpdatedAt: project.lastReconciledAt ?? null,
    },
    prepare: {
      changes: changes.length,
      inProgress: changes.filter((c) => IN_PROGRESS_STATES.has(c.state)).length,
      finished: changes.filter((c) => FINISHED_STATES.has(c.state)).length,
      readyPoints: current.filter((o) => reviewed(o.reviewState)).length,
      lastEditedAt: latest(changes.map((c) => c.updatedAt)),
    },
  };
}

/** Load and assemble the summary for one project; null for an unknown id. */
export async function loadProjectSummary(projectId: string): Promise<ProjectSummary | null> {
  const [project, associations, objects, cases, findings, changes, researchSourceCount] =
    await Promise.all([
      getUnderstandingProject(projectId),
      getAssociationsForProject(projectId),
      getObjectsForProject(projectId),
      listInvestigationCases({ projectId }),
      db.investigationFindings.where('projectId').equals(projectId).toArray(),
      db.preparedChanges.where('projectId').equals(projectId).toArray(),
      db.researchSources.where('projectId').equals(projectId).count(),
    ]);
  if (!project) return null;
  const caseIds = cases.map((c) => c.id);
  const [events, caseExhibits, researchExhibits] = await Promise.all([
    db.understandingEvents.where('objectId').anyOf(objects.map((o) => o.id)).toArray(),
    db.caseExhibits.where('caseId').anyOf(caseIds).count(),
    db.researchExhibits.where('caseId').anyOf(caseIds).count(),
  ]);
  return assembleProjectSummary({
    project,
    associations,
    researchSourceCount,
    cases,
    findings,
    pinnedEvidence: caseExhibits + researchExhibits,
    objects,
    events,
    changes,
  });
}

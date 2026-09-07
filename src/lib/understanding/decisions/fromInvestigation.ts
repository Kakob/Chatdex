// The one-way bridge from Decision Investigation (SPEC-decision-recovery §7.4,
// law 2.5). A human-finalized finding of type 'decision' promotes through the
// EXISTING investigation promotion helper — untouched — and then receives the
// Decision meta shape, with basis / madeBy mapped from the case's latest
// human VerdictOrigin. No DecisionTrace is created: there was no recovery
// run, and the detail view says "adjudicated by you" instead.

import { db } from '../../db/schema';
import { getInvestigationFinding, getRevisionsForCase } from '../../db/investigationCases';
import { promoteFindingToCurrentUnderstanding } from '../../investigation/findings';
import { isUnsupportedAutonomous, toMetaRecord, type DecisionMeta } from './meta';
import type { UnderstandingObject } from '../../../types/understanding';
import type { VerdictOrigin } from '../../../types/investigation';
import type { DecisionBasis, DecisionMadeBy } from '../../../types/decision';

export interface VerdictOriginMapping {
  basis: DecisionBasis;
  madeBy: DecisionMadeBy;
  conflictsWithUserDirection: boolean;
}

/** Spec §7.4 table. */
export const DECISION_META_BY_VERDICT_ORIGIN: Record<VerdictOrigin, VerdictOriginMapping> = {
  user_directed: { basis: 'specified', madeBy: 'user', conflictsWithUserDirection: false },
  agent_proposed_user_adopted: { basis: 'specified', madeBy: 'agent_user_adopted', conflictsWithUserDirection: false },
  agent_implemented_without_recorded_discussion: { basis: 'invented', madeBy: 'agent', conflictsWithUserDirection: false },
  inherited_default: { basis: 'inherited', madeBy: 'agent', conflictsWithUserDirection: false },
  emergent_across_exchanges: { basis: 'inferred', madeBy: 'unknown', conflictsWithUserDirection: false },
  conflicts_with_user_direction: { basis: 'invented', madeBy: 'agent', conflictsWithUserDirection: true },
  indeterminate: { basis: 'unknown', madeBy: 'unknown', conflictsWithUserDirection: false },
};

export function decisionMetaFromVerdictOrigin(origin: VerdictOrigin | undefined): DecisionMeta {
  const mapped = origin ? DECISION_META_BY_VERDICT_ORIGIN[origin] : undefined;
  const basis = mapped?.basis ?? 'unknown';
  const madeBy = mapped?.madeBy ?? 'unknown';
  return {
    madeBy,
    basis,
    unsupportedAutonomous: isUnsupportedAutonomous(madeBy, basis),
    conflictsWithUserDirection: mapped?.conflictsWithUserDirection ?? false,
    primaryPath: '',
    source: 'investigation',
  };
}

/**
 * Promote a finalized finding and stamp Decision meta on the result. Findings
 * of other types promote unchanged (their type is not 'decision').
 */
export async function promoteDecisionFinding(findingId: string): Promise<UnderstandingObject> {
  const finding = await getInvestigationFinding(findingId);
  if (!finding) throw new Error(`Finding not found: ${findingId}`);
  const promoted = await promoteFindingToCurrentUnderstanding(findingId);
  if (finding.type !== 'decision') return promoted;

  const revisions = await getRevisionsForCase(finding.caseId);
  const latest = revisions.sort((a, b) => b.revisionNumber - a.revisionNumber)[0];
  const meta: DecisionMeta = {
    ...decisionMetaFromVerdictOrigin(latest?.origin),
    decidedAt: (finding.finalizedAt ?? promoted.createdAt).toISOString(),
  };
  const updatedAt = new Date();
  await db.understandingObjects.update(promoted.id, {
    meta: { ...(promoted.meta ?? {}), ...toMetaRecord(meta), caseId: finding.caseId },
    updatedAt,
  });
  return { ...promoted, meta: { ...(promoted.meta ?? {}), ...toMetaRecord(meta), caseId: finding.caseId }, updatedAt };
}

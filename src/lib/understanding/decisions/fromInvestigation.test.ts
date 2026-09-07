import { describe, it, expect, beforeEach } from 'vitest';
import { clearAllData } from '../../db';
import { db } from '../../db/schema';
import { putUnderstandingProject, getUnderstandingObject } from '../../db/understanding';
import { addVerdictRevision, putInvestigationCase, putInvestigationFinding } from '../../db/investigationCases';
import { decisionMetaFromVerdictOrigin, promoteDecisionFinding, DECISION_META_BY_VERDICT_ORIGIN } from './fromInvestigation';
import { readDecisionMeta } from './meta';
import type { VerdictOrigin } from '../../../types/investigation';

const now = new Date('2026-09-07T12:00:00Z');

beforeEach(async () => {
  await clearAllData();
  await putUnderstandingProject({ id: 'proj-1', name: 'Chatdex', origin: 'user', reviewState: 'accepted', createdAt: now, updatedAt: now });
  await db.conversations.put({
    id: 'c1', source: 'claude-code', name: 's', summary: null, createdAt: now, updatedAt: now, importedAt: now,
    messageCount: 0, userMessageCount: 0, assistantMessageCount: 0, estimatedTokens: 0, fullText: '',
  });
  await putInvestigationCase({
    id: 'case-1', projectId: 'proj-1', conversationId: 'c1', linkedAnchorStableKeys: [], kind: 'question',
    title: 'Why permanent?', notes: '', state: 'adjudicated', searchRecords: [], createdAt: now, updatedAt: now,
  });
});

describe('decisionMetaFromVerdictOrigin (§7.4 table)', () => {
  it('maps every VerdictOrigin and derives the unsupported flag', () => {
    const origins = Object.keys(DECISION_META_BY_VERDICT_ORIGIN) as VerdictOrigin[];
    expect(origins).toHaveLength(7);
    expect(decisionMetaFromVerdictOrigin('user_directed')).toMatchObject({ basis: 'specified', madeBy: 'user', unsupportedAutonomous: false });
    expect(decisionMetaFromVerdictOrigin('agent_implemented_without_recorded_discussion')).toMatchObject({ basis: 'invented', madeBy: 'agent', unsupportedAutonomous: true });
    expect(decisionMetaFromVerdictOrigin('conflicts_with_user_direction')).toMatchObject({ basis: 'invented', madeBy: 'agent', unsupportedAutonomous: true, conflictsWithUserDirection: true });
    expect(decisionMetaFromVerdictOrigin('inherited_default')).toMatchObject({ basis: 'inherited', madeBy: 'agent', unsupportedAutonomous: false });
    expect(decisionMetaFromVerdictOrigin('emergent_across_exchanges')).toMatchObject({ basis: 'inferred', madeBy: 'unknown' });
    expect(decisionMetaFromVerdictOrigin('indeterminate')).toMatchObject({ basis: 'unknown', madeBy: 'unknown', unsupportedAutonomous: false });
    expect(decisionMetaFromVerdictOrigin(undefined)).toMatchObject({ basis: 'unknown', source: 'investigation' });
  });
});

describe('promoteDecisionFinding (law 2.5 bridge)', () => {
  it('promotes through the existing helper and stamps meta from the latest human verdict', async () => {
    await putInvestigationFinding({
      id: 'f1', caseId: 'case-1', projectId: 'proj-1', type: 'decision', title: 'Deletion is permanent',
      confidence: 'high', exhibitIds: [], reviewScopeIds: [], state: 'finalized', createdAt: now, updatedAt: now, finalizedAt: now,
    });
    await addVerdictRevision({
      id: 'r1', caseId: 'case-1', conversationId: 'c1', revisionNumber: 1, origin: 'inherited_default', status: 'active',
      confidence: 'medium', rationale: 'first', exhibitIds: [], reviewScopeIds: [], searchRecordIds: [], finalizedAt: now,
    });
    await addVerdictRevision({
      id: 'r2', caseId: 'case-1', conversationId: 'c1', revisionNumber: 2, origin: 'agent_implemented_without_recorded_discussion', status: 'active',
      confidence: 'high', rationale: 'revised', exhibitIds: [], reviewScopeIds: [], searchRecordIds: [], finalizedAt: now,
    });

    const object = await promoteDecisionFinding('f1');
    const stored = (await getUnderstandingObject(object.id))!;
    expect(stored.type).toBe('decision');
    expect(stored.origin).toBe('user');
    expect(readDecisionMeta(stored)).toMatchObject({
      basis: 'invented',
      madeBy: 'agent',
      unsupportedAutonomous: true,
      source: 'investigation',
      decidedAt: now.toISOString(),
    });
    expect(stored.meta?.caseId).toBe('case-1');
    // Idempotent: the DI helper returns the already-promoted object.
    expect((await promoteDecisionFinding('f1')).id).toBe(object.id);
  });

  it('leaves non-decision findings untouched', async () => {
    await putInvestigationFinding({
      id: 'f2', caseId: 'case-1', projectId: 'proj-1', type: 'belief', title: 'A belief',
      confidence: 'low', exhibitIds: [], reviewScopeIds: [], state: 'finalized', createdAt: now, updatedAt: now, finalizedAt: now,
    });
    const object = await promoteDecisionFinding('f2');
    expect(object.type).toBe('belief');
    expect(object.meta).toBeUndefined();
  });
});

// Table access for investigation cases, exhibits, and review scopes
// (SPEC-decision-investigation §8.3–§8.7, DI-2c). Thin reads/writes only —
// all trust-boundary validation (offsets, hashes, state transitions) lives
// in src/lib/investigation/cases.ts, per spec §12.

import { db } from './schema';
import type {
  InvestigationCase,
  CaseExhibit,
  ReviewScope,
} from '../../types/investigation';

// --- cases ---

export async function putInvestigationCase(row: InvestigationCase): Promise<void> {
  await db.investigationCases.put(row);
}

export async function getInvestigationCase(
  id: string
): Promise<InvestigationCase | undefined> {
  return db.investigationCases.get(id);
}

export async function getCaseByPrimaryAnchor(
  stableKey: string
): Promise<InvestigationCase | undefined> {
  return db.investigationCases
    .where('primaryAnchorStableKey')
    .equals(stableKey)
    .first();
}

export async function listInvestigationCases(options: {
  conversationId?: string;
} = {}): Promise<InvestigationCase[]> {
  if (options.conversationId) {
    return db.investigationCases
      .where('conversationId')
      .equals(options.conversationId)
      .toArray();
  }
  return db.investigationCases.toArray();
}

// --- exhibits ---

export async function putCaseExhibit(row: CaseExhibit): Promise<void> {
  await db.caseExhibits.put(row);
}

export async function getCaseExhibit(id: string): Promise<CaseExhibit | undefined> {
  return db.caseExhibits.get(id);
}

export async function getExhibitsForCase(caseId: string): Promise<CaseExhibit[]> {
  const rows = await db.caseExhibits.where('caseId').equals(caseId).toArray();
  return rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

export async function deleteCaseExhibit(id: string): Promise<void> {
  await db.caseExhibits.delete(id);
}

// --- review scopes ---

export async function putReviewScope(row: ReviewScope): Promise<void> {
  await db.reviewScopes.put(row);
}

export async function getReviewScope(id: string): Promise<ReviewScope | undefined> {
  return db.reviewScopes.get(id);
}

export async function getScopesForCase(caseId: string): Promise<ReviewScope[]> {
  const rows = await db.reviewScopes.where('caseId').equals(caseId).toArray();
  return rows.sort((a, b) => a.startStepIndex - b.startStepIndex);
}

export async function deleteReviewScope(id: string): Promise<void> {
  await db.reviewScopes.delete(id);
}

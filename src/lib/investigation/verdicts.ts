// Verdict operations (SPEC-decision-investigation §8.8–§8.10, §9, §10; DI-3).
// Trust boundary for adjudication: category evidence rules are enforced here,
// finalized revisions are append-only snapshots, and reopening never touches
// prior revisions. Nothing is preselected or generated — validation reports
// exactly which human input is missing, it never fills anything in.

import {
  getInvestigationCase,
  putInvestigationCase,
  getExhibitsForCase,
  getScopesForCase,
  addVerdictRevision,
  getRevisionsForCase,
  listAllVerdictRevisions,
  listInvestigationCases,
} from '../db/investigationCases';
import { getInvestigationAnchor, listInvestigationAnchors } from '../db/investigationAnchors';
import { anchorCaseState, type AnchorCaseState } from './filter';
import { generateId } from '../utils/ids';
import type {
  CaseState,
  InvestigationAnchor,
  InvestigationCase,
  VerdictDraft,
  VerdictOrigin,
  VerdictRevision,
} from '../../types/investigation';

// Fixed taxonomy labels (spec §8.8) — UI copy comes from here verbatim.
export const ORIGIN_LABELS: Record<VerdictOrigin, string> = {
  user_directed: 'I explicitly directed this',
  agent_proposed_user_adopted: 'The agent proposed it and I explicitly adopted it',
  agent_implemented_without_recorded_discussion:
    'The agent implemented it without recorded discussion',
  inherited_default: 'It was inherited from a framework, library, template, or default',
  emergent_across_exchanges: 'It emerged across multiple exchanges',
  conflicts_with_user_direction: 'The implementation conflicts with my recorded direction',
  indeterminate: 'I cannot determine who chose it',
};

const TRANSCRIPT_EXHIBIT_REQUIRED: ReadonlySet<VerdictOrigin> = new Set([
  'user_directed',
  'agent_proposed_user_adopted',
  'conflicts_with_user_direction',
]);

const REVIEW_SCOPE_REQUIRED: ReadonlySet<VerdictOrigin> = new Set([
  'agent_implemented_without_recorded_discussion',
  'indeterminate',
  'inherited_default',
]);

export async function saveVerdictDraft(
  caseId: string,
  draft: VerdictDraft
): Promise<InvestigationCase> {
  const row = await requireCase(caseId);
  if (row.state === 'adjudicated') {
    throw new Error('Case is adjudicated; reopen it to change the draft verdict');
  }
  const updated: InvestigationCase = {
    ...row,
    verdictDraft: { ...row.verdictDraft, ...draft },
    updatedAt: new Date(),
  };
  await putInvestigationCase(updated);
  return updated;
}

/**
 * §8.8 finalization validation. Returns the exact list of missing
 * requirements, in the spec's own vocabulary — empty means finalizable.
 */
export async function validateVerdict(caseId: string): Promise<string[]> {
  const row = await requireCase(caseId);
  const draft = row.verdictDraft ?? {};
  const exhibits = await getExhibitsForCase(caseId);
  const scopes = await getScopesForCase(caseId);
  const missing: string[] = [];

  if (!draft.origin) missing.push('Select an origin category');
  if (!draft.status) missing.push('Select a current status');
  if (!draft.confidence) missing.push('Select a confidence level');
  if (!draft.rationale?.trim()) missing.push('Write your rationale in your own words');

  if (!exhibits.some((e) => e.kind === 'tool_event' || e.kind === 'code_span')) {
    missing.push('Pin at least one code or tool exhibit');
  }
  if (draft.origin && TRANSCRIPT_EXHIBIT_REQUIRED.has(draft.origin)) {
    if (!exhibits.some((e) => e.kind === 'transcript_span')) {
      missing.push('This origin category requires at least one transcript exhibit');
    }
  }
  if (draft.origin && REVIEW_SCOPE_REQUIRED.has(draft.origin)) {
    if (scopes.length === 0) {
      missing.push('This origin category requires at least one confirmed review scope');
    }
  }
  return missing;
}

/**
 * §8.9 finalize: snapshot the draft + current evidence into an immutable
 * revision, mark the case adjudicated. The draft stays on the case as the
 * working copy for any future reopen.
 */
export async function finalizeVerdict(caseId: string): Promise<VerdictRevision> {
  const row = await requireCase(caseId);
  if (row.state === 'adjudicated') {
    throw new Error('Case is already adjudicated; reopen it before refinalizing');
  }
  const missing = await validateVerdict(caseId);
  if (missing.length > 0) {
    throw new Error(`Verdict is not finalizable: ${missing.join('; ')}`);
  }

  const draft = row.verdictDraft!;
  const exhibits = await getExhibitsForCase(caseId);
  const scopes = await getScopesForCase(caseId);
  const prior = await getRevisionsForCase(caseId);

  const revision: VerdictRevision = {
    id: generateId(),
    caseId,
    conversationId: row.conversationId,
    revisionNumber: (prior[prior.length - 1]?.revisionNumber ?? 0) + 1,
    origin: draft.origin!,
    status: draft.status!,
    confidence: draft.confidence!,
    rationale: draft.rationale!.trim(),
    exhibitIds: exhibits.map((e) => e.id),
    reviewScopeIds: scopes.map((s) => s.id),
    searchRecordIds: row.searchRecords.map((r) => r.id),
    finalizedAt: new Date(),
  };
  await addVerdictRevision(revision);
  await putInvestigationCase({ ...row, state: 'adjudicated', updatedAt: new Date() });
  return revision;
}

/** §8.9 reopen: prior revisions are never edited. */
export async function reopenCase(caseId: string): Promise<InvestigationCase> {
  const row = await requireCase(caseId);
  if (row.state !== 'adjudicated') {
    throw new Error('Only adjudicated cases can be reopened');
  }
  const updated: InvestigationCase = { ...row, state: 'reopened', updatedAt: new Date() };
  await putInvestigationCase(updated);
  return updated;
}

/** Rows referenced by any finalized revision are permanent (spec §8.7/§8.9). */
export async function isReferencedByRevision(
  caseId: string,
  kind: 'exhibit' | 'scope',
  rowId: string
): Promise<boolean> {
  const revisions = await getRevisionsForCase(caseId);
  return revisions.some((rev) =>
    (kind === 'exhibit' ? rev.exhibitIds : rev.reviewScopeIds).includes(rowId)
  );
}

// --- decision ledger (§9) ---

export interface LedgerEntry {
  caseId: string;
  title: string;
  latest: VerdictRevision;
  revisionCount: number;
  caseState: CaseState;
  filePaths: string[];
  primaryAnchorStableKey: string;
  conversationId: string;
  exhibitCount: number;
  reviewScopeCount: number;
}

/** Finalized human verdicts only; draft/open cases never appear. */
export async function listDecisionLedger(): Promise<LedgerEntry[]> {
  const revisions = await listAllVerdictRevisions();
  const byCase = new Map<string, VerdictRevision[]>();
  for (const rev of revisions) {
    const list = byCase.get(rev.caseId) ?? [];
    list.push(rev);
    byCase.set(rev.caseId, list);
  }

  const entries: LedgerEntry[] = [];
  for (const [caseId, revs] of byCase) {
    const caseRow = await getInvestigationCase(caseId);
    if (!caseRow?.primaryAnchorStableKey) continue;
    revs.sort((a, b) => a.revisionNumber - b.revisionNumber);
    const anchor = await getInvestigationAnchor(caseRow.primaryAnchorStableKey);
    entries.push({
      caseId,
      title: caseRow.title,
      latest: revs[revs.length - 1],
      revisionCount: revs.length,
      caseState: caseRow.state,
      filePaths: anchor?.filePaths ?? [],
      primaryAnchorStableKey: caseRow.primaryAnchorStableKey,
      conversationId: caseRow.conversationId,
      exhibitCount: (await getExhibitsForCase(caseId)).length,
      reviewScopeCount: (await getScopesForCase(caseId)).length,
    });
  }
  return entries.sort(
    (a, b) => b.latest.finalizedAt.getTime() - a.latest.finalizedAt.getTime()
  );
}

// --- coverage (§10) — factual counts only, never a comprehension score ---

export interface FileCoverage {
  filePath: string;
  totalAnchors: number;
  uninvestigated: number;
  open: number;
  adjudicated: number;
  lastAdjudicatedAt?: Date;
}

export interface InvestigationCoverage {
  files: FileCoverage[];
  totals: { totalAnchors: number; uninvestigated: number; open: number; adjudicated: number };
}

export async function getInvestigationCoverage(options: {
  conversationIds?: string[];
} = {}): Promise<InvestigationCoverage> {
  const anchors = await listInvestigationAnchors({ conversationIds: options.conversationIds });
  const caseStates = await caseStatesByAnchorKey();
  const lastAdjudicated = await lastAdjudicationByAnchorKey();

  const byFile = new Map<string, FileCoverage>();
  const totals = { totalAnchors: 0, uninvestigated: 0, open: 0, adjudicated: 0 };

  for (const anchor of anchors) {
    const state = anchorCaseState(anchor, caseStates);
    totals.totalAnchors++;
    totals[state]++;
    for (const filePath of anchor.filePaths) {
      const entry = byFile.get(filePath) ?? {
        filePath,
        totalAnchors: 0,
        uninvestigated: 0,
        open: 0,
        adjudicated: 0,
      };
      entry.totalAnchors++;
      entry[state]++;
      const adjudicatedAt = lastAdjudicated.get(anchor.stableKey);
      if (
        adjudicatedAt &&
        (!entry.lastAdjudicatedAt || adjudicatedAt > entry.lastAdjudicatedAt)
      ) {
        entry.lastAdjudicatedAt = adjudicatedAt;
      }
      byFile.set(filePath, entry);
    }
  }

  return {
    files: [...byFile.values()].sort((a, b) => a.filePath.localeCompare(b.filePath)),
    totals,
  };
}

// --- closure / continuation (§8.10) — real neighboring mysteries only ---

export interface ContinuationTargets {
  previousUninvestigated?: InvestigationAnchor;
  nextUninvestigated?: InvestigationAnchor;
  sameFile: InvestigationAnchor[];
}

export async function getContinuationTargets(
  anchor: InvestigationAnchor
): Promise<ContinuationTargets> {
  const anchors = await listInvestigationAnchors();
  const caseStates = await caseStatesByAnchorKey();
  const uninvestigated = anchors.filter(
    (a) => anchorCaseState(a, caseStates) === 'uninvestigated'
  );
  const index = anchors.findIndex((a) => a.id === anchor.id);
  const before = uninvestigated.filter((a) => anchors.indexOf(a) < index);
  const after = uninvestigated.filter((a) => anchors.indexOf(a) > index);
  const filePaths = new Set(anchor.filePaths);
  return {
    previousUninvestigated: before[before.length - 1],
    nextUninvestigated: after[0],
    sameFile: anchors.filter(
      (a) => a.id !== anchor.id && a.filePaths.some((p) => filePaths.has(p))
    ),
  };
}

async function caseStatesByAnchorKey(): Promise<Map<string, CaseState>> {
  const cases = await listInvestigationCases();
  const map = new Map<string, CaseState>();
  for (const c of cases) {
    if (c.primaryAnchorStableKey) map.set(c.primaryAnchorStableKey, c.state);
    for (const linked of c.linkedAnchorStableKeys) {
      if (!map.has(linked)) map.set(linked, c.state);
    }
  }
  return map;
}

async function lastAdjudicationByAnchorKey(): Promise<Map<string, Date>> {
  const cases = await listInvestigationCases();
  const revisions = await listAllVerdictRevisions();
  const latestByCase = new Map<string, Date>();
  for (const rev of revisions) {
    const prev = latestByCase.get(rev.caseId);
    if (!prev || rev.finalizedAt > prev) latestByCase.set(rev.caseId, rev.finalizedAt);
  }
  const map = new Map<string, Date>();
  for (const c of cases) {
    const at = latestByCase.get(c.id);
    if (at && c.primaryAnchorStableKey) map.set(c.primaryAnchorStableKey, at);
  }
  return map;
}

async function requireCase(caseId: string): Promise<InvestigationCase> {
  const row = await getInvestigationCase(caseId);
  if (!row) throw new Error(`Case not found: ${caseId}`);
  return row;
}

export type { AnchorCaseState };

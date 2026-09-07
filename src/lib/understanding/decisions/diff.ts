// Semantic Decision Diff (SPEC-decision-recovery §12, law 2.8). A pure fold
// over the latest trace per decision in two recovery runs: NEW DECISION /
// REVISED / NEW ASSUMPTION / INVALIDATED / UNRESOLVED. No model, no network;
// same input twice ⇒ deep-equal entries. Persisted LOCAL-ONLY under a
// deterministic id. Human reactions are recorded as user-origin understanding
// events (synced), never by mutating the diff.

import { listDecisionTracesForRun } from '../../db/decisionTraces';
import { decisionDiffId, getDecisionDiff, putDecisionDiff } from '../../db/decisionDiffs';
import { recordUnderstandingEvent, getUnderstandingObject } from '../../db/understanding';
import type { DecisionDiff, DecisionDiffEntry, DecisionTrace, DecisionInvalidation } from '../../../types/decision';
import type { UnderstandingEvent } from '../../../types/understanding';

/** Bump when fold rules change (findings-immutability precedent). */
export const DIFFER_VERSION = '1.0.0';

export const DIFF_OP_LABEL: Record<DecisionDiffEntry['op'], string> = {
  new_decision: 'New decision',
  revised: 'Revised',
  new_assumption: 'New assumption',
  invalidated: 'Invalidated',
  unresolved: 'Unresolved',
};

export const DIFF_OP_HELP: Record<DecisionDiffEntry['op'], string> = {
  new_decision: 'Recovered in the newer run, absent from the older one.',
  revised: 'Present in both runs; why, alternatives, assumptions, basis, or implementing paths changed.',
  new_assumption: 'An assumption the newer run states that the older run did not.',
  invalidated: 'The newer run cites evidence that contradicts an older decision or assumption.',
  unresolved: 'Present in the older run, absent from the newer one, and not invalidated — its fate is unknown.',
};

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

/** Latest trace per decision within one run's traces (a run writes one per decision, but be safe). */
export function latestPerDecision(traces: DecisionTrace[]): Map<string, DecisionTrace> {
  const out = new Map<string, DecisionTrace>();
  for (const t of [...traces].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
    out.set(t.decisionObjectId, t);
  }
  return out;
}

function basisOf(t: DecisionTrace): string {
  // Basis lives on the object; the trace carries assumptions' bases. For the
  // diff we compare the assumption basis multiset and the object-level why.
  return t.assumptions.map((a) => `${norm(a.statement)}|${a.basis}`).sort().join('\n');
}

function changedFields(from: DecisionTrace, to: DecisionTrace): string[] {
  const out: string[] = [];
  if (norm(from.why ?? '') !== norm(to.why ?? '')) out.push('why');
  const alts = (t: DecisionTrace) => t.alternatives.map((a) => norm(a.statement)).sort().join('\n');
  if (alts(from) !== alts(to)) out.push('alternatives');
  const assumptionSet = (t: DecisionTrace) => t.assumptions.map((a) => norm(a.statement)).sort().join('\n');
  if (assumptionSet(from) !== assumptionSet(to)) out.push('assumptions');
  else if (basisOf(from) !== basisOf(to)) out.push('assumption bases');
  const paths = (t: DecisionTrace) => [...new Set(t.implEvidence.map((e) => e.path))].sort().join('\n');
  if (paths(from) !== paths(to)) out.push('implementing paths');
  return out;
}

export function foldDecisionDiff(fromTraces: DecisionTrace[], toTraces: DecisionTrace[]): DecisionDiffEntry[] {
  const from = latestPerDecision(fromTraces);
  const to = latestPerDecision(toTraces);
  const entries: DecisionDiffEntry[] = [];

  // Invalidations claimed by the newer run, keyed by target for the unresolved check.
  const invalidated = new Set<string>();
  const seenInvalidation = new Set<string>();
  for (const t of to.values()) {
    for (const inv of t.invalidates) {
      const key = `${inv.decisionObjectId}|${inv.assumptionId ?? ''}`;
      if (seenInvalidation.has(key)) continue;
      seenInvalidation.add(key);
      invalidated.add(inv.decisionObjectId);
      entries.push({
        op: 'invalidated',
        decisionObjectId: inv.decisionObjectId,
        assumptionId: inv.assumptionId,
        fromTraceId: from.get(inv.decisionObjectId)?.id,
        toTraceId: t.id,
        evidence: inv.evidence,
        codeEvidence: inv.codeEvidence,
      });
    }
  }

  for (const [objectId, toTrace] of to) {
    const fromTrace = from.get(objectId);
    if (!fromTrace) {
      entries.push({ op: 'new_decision', decisionObjectId: objectId, toTraceId: toTrace.id });
      continue;
    }
    const changed = changedFields(fromTrace, toTrace);
    if (changed.length > 0) {
      entries.push({ op: 'revised', decisionObjectId: objectId, fromTraceId: fromTrace.id, toTraceId: toTrace.id, changedFields: changed });
    }
    const before = new Set(fromTrace.assumptions.map((a) => norm(a.statement)));
    for (const a of toTrace.assumptions) {
      if (!before.has(norm(a.statement))) {
        entries.push({ op: 'new_assumption', decisionObjectId: objectId, assumptionId: a.id, fromTraceId: fromTrace.id, toTraceId: toTrace.id });
      }
    }
  }

  for (const [objectId, fromTrace] of from) {
    if (to.has(objectId) || invalidated.has(objectId)) continue;
    entries.push({ op: 'unresolved', decisionObjectId: objectId, fromTraceId: fromTrace.id });
  }

  // Deterministic order: by op rank, then object id, then assumption id.
  const rank: Record<DecisionDiffEntry['op'], number> = { new_decision: 0, revised: 1, new_assumption: 2, invalidated: 3, unresolved: 4 };
  return entries.sort(
    (a, b) =>
      rank[a.op] - rank[b.op] ||
      a.decisionObjectId.localeCompare(b.decisionObjectId) ||
      (a.assumptionId ?? '').localeCompare(b.assumptionId ?? '')
  );
}

export function buildDecisionDiff(
  projectId: string,
  from: { runId: string; sha?: string; traces: DecisionTrace[] },
  to: { runId: string; sha?: string; traces: DecisionTrace[] },
  now = new Date()
): DecisionDiff {
  return {
    id: decisionDiffId(from.runId, to.runId),
    projectId,
    fromRunId: from.runId,
    toRunId: to.runId,
    fromSha: from.sha,
    toSha: to.sha,
    entries: foldDecisionDiff(from.traces, to.traces),
    differVersion: DIFFER_VERSION,
    createdAt: now,
  };
}

/** Load the persisted diff for two runs, or compute and persist it (idempotent id). */
export async function computeOrLoadDiff(projectId: string, fromRunId: string, toRunId: string, options: { recompute?: boolean } = {}): Promise<DecisionDiff> {
  if (!options.recompute) {
    const existing = await getDecisionDiff(fromRunId, toRunId);
    if (existing && existing.differVersion === DIFFER_VERSION) return existing;
  }
  const [fromTraces, toTraces] = await Promise.all([
    listDecisionTracesForRun(projectId, fromRunId),
    listDecisionTracesForRun(projectId, toRunId),
  ]);
  const diff = buildDecisionDiff(
    projectId,
    { runId: fromRunId, sha: fromTraces[0]?.sha, traces: fromTraces },
    { runId: toRunId, sha: toTraces[0]?.sha, traces: toTraces }
  );
  await putDecisionDiff(diff);
  return diff;
}

/** Human accepts an `invalidated` entry: a user-origin contradicted event on the decision (applied immediately). */
export async function recordInvalidation(entry: DecisionDiffEntry, note?: string): Promise<UnderstandingEvent> {
  if (entry.op !== 'invalidated') throw new Error('Only invalidated entries can be recorded as contradictions');
  const evidence = groupEvidence(entry.evidence ?? []);
  if (evidence.length === 0) throw new Error('This invalidation carries no transcript evidence to anchor the contradiction');
  return recordUnderstandingEvent({
    objectId: entry.decisionObjectId,
    op: 'contradicted',
    detail: note?.trim() || `Contradicted by a later recovery run${entry.assumptionId ? ' (assumption)' : ''}`,
    evidence,
    origin: 'user',
    occurredAt: new Date(),
  });
}

/** "Same as …": the human merges a duplicate into the decision it restates (user-origin supersession). */
export async function mergeDecisions(duplicateObjectId: string, canonicalObjectId: string, note?: string): Promise<UnderstandingEvent> {
  if (duplicateObjectId === canonicalObjectId) throw new Error('A decision cannot supersede itself');
  const [dup, canon] = await Promise.all([getUnderstandingObject(duplicateObjectId), getUnderstandingObject(canonicalObjectId)]);
  if (!dup || dup.type !== 'decision') throw new Error('Duplicate decision not found');
  if (!canon || canon.type !== 'decision') throw new Error('Canonical decision not found');
  return recordUnderstandingEvent({
    objectId: duplicateObjectId,
    op: 'superseded',
    supersededByObjectId: canonicalObjectId,
    detail: note?.trim() || `Merged into "${canon.title}" by the user`,
    evidence: [],
    origin: 'user',
    occurredAt: new Date(),
  });
}

function groupEvidence(spans: DecisionInvalidation['evidence']) {
  const byConv = new Map<string, Set<string>>();
  for (const s of spans) {
    const set = byConv.get(s.conversationId) ?? new Set<string>();
    set.add(s.messageId);
    byConv.set(s.conversationId, set);
  }
  return [...byConv].map(([conversationId, ids]) => ({ conversationId, messageIds: [...ids] }));
}

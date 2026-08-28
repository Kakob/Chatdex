// Change Workspace lifecycle (SPEC-change-workspace §7.1).
//
//   draft → ready → implementing → verified → closed
//
// `draft → ready` stays in ./changes.ts (markPreparedChangeReady). This module
// adds the post-ready transitions plus the appendable-section writers, and
// enforces the freeze law (§2.4): attaching an implementation freezes the open
// hypothesis, and frozen entries are never rewritten.

import { getPreparedChange, putPreparedChange } from '../db/preparedChanges';
import { generateId } from '../utils/ids';
import { assertEditability, canAppend, editabilityOf } from './editability';
import { markPreparedChangeReady } from './changes';
import {
  MAX_AI_TEXT_CHARS,
  MAX_EVIDENCE_ITEMS,
  MAX_QUOTE_CHARS,
  type EvidenceItem,
} from '../../types/evidence';
import type {
  Hypothesis,
  Implementation,
  PreparedChange,
  VerificationRow,
  WorkspaceLearned,
  WorkspaceMode,
  WorkspaceTrace,
} from '../../types/preparedChange';

/** Trace nodes per workspace (audit S7). */
export const MAX_TRACE_NODES = 100;

async function load(id: string): Promise<PreparedChange> {
  const current = await getPreparedChange(id);
  if (!current) throw new Error(`Change Workspace not found: ${id}`);
  return current;
}

async function save(next: PreparedChange): Promise<PreparedChange> {
  const updated = { ...next, updatedAt: new Date() };
  await putPreparedChange(updated);
  return updated;
}

const iso = (d: Date) => d.toISOString();

// --- mode -----------------------------------------------------------------

export async function setWorkspaceMode(id: string, mode: WorkspaceMode): Promise<PreparedChange> {
  const current = await load(id);
  if (current.mode === mode) return current;
  const at = iso(new Date());
  return save({
    ...current,
    mode,
    modeHistory: [...(current.modeHistory ?? []), { mode, at }],
  });
}

// --- evidence ---------------------------------------------------------------

function validateEvidenceItem(item: EvidenceItem): void {
  if (!item.id) throw new Error('Evidence item needs an id');
  if (item.kind === 'code') {
    if (item.quote.length > MAX_QUOTE_CHARS) {
      throw new Error(`Code evidence quote exceeds ${MAX_QUOTE_CHARS} characters`);
    }
    if (item.startLine < 1 || item.endLine < item.startLine) {
      throw new Error('Code evidence line range is invalid');
    }
  } else if (item.kind === 'ai_inference') {
    if (item.text.length > MAX_AI_TEXT_CHARS) {
      throw new Error(`AI inference text exceeds ${MAX_AI_TEXT_CHARS} characters`);
    }
    if (item.origin !== 'ai') throw new Error('AI inference evidence must have origin "ai"');
  } else if ('quote' in item && item.quote && item.quote.length > MAX_QUOTE_CHARS) {
    throw new Error(`Evidence quote exceeds ${MAX_QUOTE_CHARS} characters`);
  }
}

/** Append evidence items. Existing items are never modified (§2.1). */
export async function addEvidenceItems(
  id: string,
  items: EvidenceItem[]
): Promise<PreparedChange> {
  const current = await load(id);
  assertEditability(current, 'evidence', ['appendable', 'editable']);
  const existing = current.evidence ?? [];
  const seen = new Set(existing.map((e) => e.id));
  const fresh = items.filter((item) => !seen.has(item.id));
  for (const item of fresh) validateEvidenceItem(item);
  if (existing.length + fresh.length > MAX_EVIDENCE_ITEMS) {
    throw new Error(`A workspace holds at most ${MAX_EVIDENCE_ITEMS} evidence items`);
  }
  if (fresh.length === 0) return current;
  return save({ ...current, evidence: [...existing, ...fresh] });
}

// --- hypotheses -------------------------------------------------------------

export async function addHypothesis(
  id: string,
  text: string,
  origin: Hypothesis['origin'] = 'user'
): Promise<PreparedChange> {
  const current = await load(id);
  assertEditability(current, 'hypotheses', ['appendable', 'editable']);
  const trimmed = text.trim();
  if (!trimmed) throw new Error('Hypothesis cannot be empty');
  const hypothesis: Hypothesis = {
    id: generateId(),
    text: trimmed,
    createdAt: iso(new Date()),
    origin,
  };
  return save({ ...current, hypotheses: [...(current.hypotheses ?? []), hypothesis] });
}

/** Edit the text of a hypothesis that has not been frozen yet. */
export async function editOpenHypothesis(
  id: string,
  hypothesisId: string,
  text: string
): Promise<PreparedChange> {
  const current = await load(id);
  assertEditability(current, 'hypotheses', ['appendable', 'editable']);
  const target = (current.hypotheses ?? []).find((h) => h.id === hypothesisId);
  if (!target) throw new Error(`Hypothesis not found: ${hypothesisId}`);
  if (target.frozenAt) throw new Error('A frozen hypothesis cannot be edited (freeze law)');
  const trimmed = text.trim();
  if (!trimmed) throw new Error('Hypothesis cannot be empty');
  return save({
    ...current,
    hypotheses: current.hypotheses!.map((h) => (h.id === hypothesisId ? { ...h, text: trimmed } : h)),
  });
}

function freezeOpenHypotheses(hypotheses: Hypothesis[] | undefined, at: string): Hypothesis[] | undefined {
  if (!hypotheses) return hypotheses;
  return hypotheses.map((h) => (h.frozenAt ? h : { ...h, frozenAt: at }));
}

// --- trace ------------------------------------------------------------------

/** Replace the trace. Node/edge edits are free while the section is appendable/editable. */
export async function updateTrace(id: string, trace: WorkspaceTrace): Promise<PreparedChange> {
  const current = await load(id);
  assertEditability(current, 'trace', ['appendable', 'editable']);
  if (trace.nodes.length > MAX_TRACE_NODES) {
    throw new Error(`A trace holds at most ${MAX_TRACE_NODES} nodes`);
  }
  const nodeIds = new Set(trace.nodes.map((n) => n.id));
  for (const edge of trace.edges) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
      throw new Error(`Trace edge ${edge.id} references a missing node`);
    }
  }
  const evidenceIds = new Set((current.evidence ?? []).map((e) => e.id));
  for (const holder of [...trace.nodes, ...trace.edges]) {
    for (const eid of holder.evidenceIds) {
      if (!evidenceIds.has(eid)) {
        throw new Error(`Trace references unknown evidence ${eid}`);
      }
    }
  }
  return save({ ...current, trace });
}

// --- questions --------------------------------------------------------------

export async function linkQuestion(id: string, questionObjectId: string): Promise<PreparedChange> {
  const current = await load(id);
  assertEditability(current, 'questions', ['appendable', 'editable']);
  const ids = new Set(current.questionIds ?? []);
  if (ids.has(questionObjectId)) return current;
  return save({ ...current, questionIds: [...ids, questionObjectId] });
}

// --- implementation (freeze law) -------------------------------------------

/**
 * Attach an implementation. From `ready` (or `draft`, which is auto-readied
 * for the AI-led path) this moves the workspace to `implementing`; from
 * `implementing` it replaces the attachment, keeping the previous one in
 * history. Every open hypothesis is frozen at this moment (§2.4).
 */
export async function attachImplementation(
  id: string,
  implementation: Omit<Implementation, 'attachedAt'> & { attachedAt?: string }
): Promise<PreparedChange> {
  let current = await load(id);
  if (current.state === 'draft') {
    current = await markPreparedChangeReady(id);
  }
  const editability = editabilityOf(current, 'implementation');
  if (editability !== 'attachable' && editability !== 'replaceable') {
    throw new Error(`Implementation cannot be attached while the workspace is ${current.state}`);
  }
  if (implementation.files.length === 0) {
    throw new Error('An implementation needs at least one file');
  }
  const now = new Date();
  const attached: Implementation = { ...implementation, attachedAt: implementation.attachedAt ?? iso(now) };
  const history =
    editability === 'replaceable' && current.implementation
      ? [...(current.implementationHistory ?? []), current.implementation]
      : current.implementationHistory;
  const next: PreparedChange = {
    ...current,
    state: 'implementing',
    implementation: attached,
    ...(history ? { implementationHistory: history } : {}),
    hypotheses: freezeOpenHypotheses(current.hypotheses, iso(now)),
    implementingAt: current.implementingAt ?? now,
  };
  // Verification rows exist for every criterion from this point on (§12).
  next.verification = ensureVerificationRows(next);
  return save(next);
}

function ensureVerificationRows(change: PreparedChange): VerificationRow[] {
  const existing = new Map((change.verification ?? []).map((row) => [row.criterionId, row]));
  const at = iso(new Date());
  const criteriaIds = (change.criteria ?? []).map((c) => c.id);
  return criteriaIds.map(
    (criterionId) =>
      existing.get(criterionId) ?? { criterionId, evidenceIds: [], status: 'unverified', updatedAt: at }
  );
}

// --- verification -----------------------------------------------------------

export async function updateVerificationRow(
  id: string,
  row: Omit<VerificationRow, 'updatedAt'>
): Promise<PreparedChange> {
  const current = await load(id);
  assertEditability(current, 'verification', ['editable']);
  const criterion = (current.criteria ?? []).find((c) => c.id === row.criterionId);
  if (!criterion) throw new Error(`Criterion not found: ${row.criterionId}`);
  const evidence = current.evidence ?? [];
  const attached = row.evidenceIds.map((eid) => {
    const item = evidence.find((e) => e.id === eid);
    if (!item) throw new Error(`Verification references unknown evidence ${eid}`);
    return item;
  });
  // Law §2.2: a row backed only by AI inference cannot be marked supported.
  if (
    row.status === 'supported' &&
    (attached.length === 0 || attached.every((item) => item.kind === 'ai_inference'))
  ) {
    throw new Error('A criterion cannot be supported without non-AI evidence');
  }
  const rows = ensureVerificationRows(current).map((existing) =>
    existing.criterionId === row.criterionId ? { ...row, updatedAt: iso(new Date()) } : existing
  );
  return save({ ...current, verification: rows });
}

export async function markVerified(id: string): Promise<PreparedChange> {
  const current = await load(id);
  if (current.state !== 'implementing') {
    throw new Error(`Only an implementing workspace can be verified (state: ${current.state})`);
  }
  const rows = ensureVerificationRows(current);
  const blocking = rows.filter((row) => row.status === 'unverified' && !row.note?.trim());
  if (blocking.length > 0) {
    throw new Error(
      `${blocking.length} criterion(s) are unverified without an explicit note accepting that`
    );
  }
  const now = new Date();
  return save({ ...current, state: 'verified', verification: rows, verifiedAt: now });
}

// --- learned ----------------------------------------------------------------

export async function updateLearned(id: string, text: string): Promise<PreparedChange> {
  const current = await load(id);
  assertEditability(current, 'learned', ['editable']);
  const now = iso(new Date());
  const learned: WorkspaceLearned = current.learned
    ? { ...current.learned, text, updatedAt: now }
    : { text, createdAt: now, updatedAt: now };
  return save({ ...current, learned });
}

/** Assisted mode writes here, never into `text` (law §2.3). */
export async function suggestLearned(id: string, aiSuggested: string): Promise<PreparedChange> {
  const current = await load(id);
  assertEditability(current, 'learned', ['editable']);
  const now = iso(new Date());
  const learned: WorkspaceLearned = current.learned
    ? { ...current.learned, aiSuggested, updatedAt: now }
    : { text: '', createdAt: now, updatedAt: now, aiSuggested };
  return save({ ...current, learned });
}

// --- close ------------------------------------------------------------------

export async function closeWorkspace(id: string): Promise<PreparedChange> {
  const current = await load(id);
  if (current.state !== 'verified') {
    throw new Error(`Only a verified workspace can be closed (state: ${current.state})`);
  }
  if (!current.learned?.text.trim()) {
    throw new Error('Write what you learned before closing the workspace');
  }
  return save({ ...current, state: 'closed', closedAt: new Date() });
}

/** Convenience for UI guards. */
export function canAppendTo(change: PreparedChange, section: Parameters<typeof canAppend>[1]): boolean {
  return canAppend(change, section);
}

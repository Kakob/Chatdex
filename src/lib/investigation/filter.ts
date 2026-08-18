// Anchor-browser filtering (SPEC-decision-investigation §8.1).
// Pure and mechanical: literal substring matching, exact enum matching, and
// timestamp range checks only. No relevance, importance, or recommended
// ordering exists anywhere in this module by design.

import type {
  CaseState,
  CodeChangeKind,
  InvestigationAnchor,
} from '../../types/investigation';

// The §8.1 anchor-state vocabulary, derived from linked cases (never stored —
// spec §11 "derive anchor state when practical").
export type AnchorCaseState = 'uninvestigated' | 'open' | 'adjudicated';

export interface AnchorBrowserFilters {
  /** Conversation (session) id. */
  conversationId?: string;
  /** Project path as recorded on the conversation (literal equality). */
  projectPath?: string;
  /** Inclusive day bounds, interpreted in the viewer's local timezone. */
  dateFrom?: Date;
  dateTo?: Date;
  /** Case-insensitive literal substring over the anchor's file paths. */
  filePathSubstring?: string;
  kind?: CodeChangeKind;
  caseState?: AnchorCaseState;
}

export interface AnchorConversationMeta {
  projectPath?: string;
}

export function anchorCaseState(
  anchor: InvestigationAnchor,
  caseStates: Map<string, CaseState>
): AnchorCaseState {
  const state = caseStates.get(anchor.stableKey);
  if (!state) return 'uninvestigated';
  return state === 'adjudicated' ? 'adjudicated' : 'open';
}

export function filterAnchors(
  anchors: InvestigationAnchor[],
  filters: AnchorBrowserFilters,
  conversationMeta: Map<string, AnchorConversationMeta>,
  caseStates: Map<string, CaseState> = new Map()
): InvestigationAnchor[] {
  const needle = filters.filePathSubstring?.trim().toLowerCase();
  return anchors.filter((anchor) => {
    if (filters.conversationId && anchor.conversationId !== filters.conversationId) {
      return false;
    }
    if (filters.projectPath !== undefined) {
      const meta = conversationMeta.get(anchor.conversationId);
      if ((meta?.projectPath ?? '') !== filters.projectPath) return false;
    }
    if (filters.dateFrom && anchor.occurredAt < startOfDay(filters.dateFrom)) return false;
    if (filters.dateTo && anchor.occurredAt > endOfDay(filters.dateTo)) return false;
    if (needle && !anchor.filePaths.some((p) => p.toLowerCase().includes(needle))) {
      return false;
    }
    if (filters.kind && anchor.kind !== filters.kind) return false;
    if (filters.caseState && anchorCaseState(anchor, caseStates) !== filters.caseState) {
      return false;
    }
    return true;
  });
}

function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

function endOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(23, 59, 59, 999);
  return out;
}

/** Literal metadata labels only (spec §7.4) — never semantic descriptions. */
export const KIND_LABELS: Record<CodeChangeKind, string> = {
  edit: 'Edit',
  write: 'Write',
  multi_edit: 'MultiEdit',
  notebook_edit: 'NotebookEdit',
};

/** `src/lib/db.ts` or `3 files` — the literal file part of an anchor row. */
export function anchorFileLabel(anchor: InvestigationAnchor): string {
  if (anchor.filePaths.length === 1) return anchor.filePaths[0];
  return `${anchor.filePaths.length} files`;
}

// Per-section editability (SPEC-change-workspace §7.1). The workspace is one
// record but its sections freeze at different lifecycle points: intent and
// criteria at `ready`, the open hypothesis on attach, everything at `closed`.

import type { PreparedChange, PreparedChangeState } from '../../types/preparedChange';

export type WorkspaceSection =
  | 'intent'
  | 'criteria'
  | 'evidence'
  | 'trace'
  | 'questions'
  | 'hypotheses'
  | 'implementation'
  | 'verification'
  | 'learned'
  | 'promotions';

/**
 * editable   — free edits
 * appendable — add new entries only; existing entries are immutable
 * attachable — implementation may be attached (first time)
 * replaceable — implementation may be replaced; the previous one is kept in history
 * frozen     — read-only
 * unavailable — the section does not apply yet in this state
 */
export type Editability =
  | 'editable'
  | 'appendable'
  | 'attachable'
  | 'replaceable'
  | 'frozen'
  | 'unavailable';

export const WORKSPACE_SECTIONS: readonly WorkspaceSection[] = [
  'intent',
  'criteria',
  'evidence',
  'trace',
  'questions',
  'hypotheses',
  'implementation',
  'verification',
  'learned',
  'promotions',
];

const TABLE: Record<PreparedChangeState, Record<WorkspaceSection, Editability>> = {
  draft: {
    intent: 'editable',
    criteria: 'editable',
    evidence: 'appendable',
    trace: 'appendable',
    questions: 'appendable',
    hypotheses: 'appendable',
    implementation: 'attachable',
    verification: 'unavailable',
    learned: 'unavailable',
    promotions: 'unavailable',
  },
  ready: {
    intent: 'frozen',
    criteria: 'frozen',
    evidence: 'appendable',
    trace: 'appendable',
    questions: 'appendable',
    hypotheses: 'appendable',
    implementation: 'attachable',
    verification: 'unavailable',
    learned: 'unavailable',
    promotions: 'unavailable',
  },
  implementing: {
    intent: 'frozen',
    criteria: 'frozen',
    evidence: 'appendable',
    trace: 'appendable',
    questions: 'appendable',
    hypotheses: 'appendable',
    implementation: 'replaceable',
    verification: 'editable',
    learned: 'editable',
    promotions: 'unavailable',
  },
  verified: {
    intent: 'frozen',
    criteria: 'frozen',
    evidence: 'appendable',
    trace: 'appendable',
    questions: 'appendable',
    hypotheses: 'appendable',
    implementation: 'frozen',
    verification: 'editable',
    learned: 'editable',
    promotions: 'appendable',
  },
  closed: {
    intent: 'frozen',
    criteria: 'frozen',
    evidence: 'frozen',
    trace: 'frozen',
    questions: 'frozen',
    hypotheses: 'frozen',
    implementation: 'frozen',
    verification: 'frozen',
    learned: 'frozen',
    promotions: 'appendable',
  },
  superseded: {
    intent: 'frozen',
    criteria: 'frozen',
    evidence: 'frozen',
    trace: 'frozen',
    questions: 'frozen',
    hypotheses: 'frozen',
    implementation: 'frozen',
    verification: 'frozen',
    learned: 'frozen',
    promotions: 'frozen',
  },
};

export function sectionEditability(
  change: Pick<PreparedChange, 'state'>
): Record<WorkspaceSection, Editability> {
  return { ...TABLE[change.state] };
}

export function editabilityOf(
  change: Pick<PreparedChange, 'state'>,
  section: WorkspaceSection
): Editability {
  return TABLE[change.state][section];
}

/** True when new entries may be added to (or the section freely edited). */
export function canAppend(change: Pick<PreparedChange, 'state'>, section: WorkspaceSection): boolean {
  const e = editabilityOf(change, section);
  return e === 'appendable' || e === 'editable';
}

export function canEdit(change: Pick<PreparedChange, 'state'>, section: WorkspaceSection): boolean {
  return editabilityOf(change, section) === 'editable';
}

export function assertEditability(
  change: Pick<PreparedChange, 'state'>,
  section: WorkspaceSection,
  allowed: readonly Editability[]
): void {
  const actual = editabilityOf(change, section);
  if (!allowed.includes(actual)) {
    throw new Error(
      `Section "${section}" is ${actual} while the workspace is ${change.state}`
    );
  }
}

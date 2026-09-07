// Decision scalar meta (SPEC-decision-recovery §7.1). Decisions are
// UnderstandingObjects of type 'decision'; their per-type scalars live in
// `meta` (like intents). This module is the single reader/writer of that
// shape so pages and pipeline agree on keys and defaults.

import type { UnderstandingObject } from '../../../types/understanding';
import {
  DECISION_BASES,
  type DecisionBasis,
  type DecisionMadeBy,
  type DecisionSource,
} from '../../../types/decision';

export interface DecisionMeta {
  madeBy: DecisionMadeBy;
  basis: DecisionBasis;
  unsupportedAutonomous: boolean;
  conflictsWithUserDirection: boolean;
  /** ISO timestamp of the first citing step's message. */
  decidedAt?: string;
  /** Ordering key within a session (law 2.7). */
  firstStepIndex?: number;
  /** Grouping key: first edited path among cited anchors, else first code path, else ''. */
  primaryPath: string;
  /** Conversation the decision was recovered from (recovery only). */
  conversationId?: string;
  source: DecisionSource;
  latestTraceId?: string;
  /** Model's confidence, 0..1, display only. */
  confidence?: number;
}

export const MADE_BY_VALUES: readonly DecisionMadeBy[] = ['user', 'agent', 'agent_user_adopted', 'unknown'];

export function isDecision(o: UnderstandingObject): boolean {
  return o.type === 'decision';
}

/** Spec §7.3 — the only highlighted rows. */
export function isUnsupportedAutonomous(madeBy: DecisionMadeBy, basis: DecisionBasis): boolean {
  return madeBy === 'agent' && (basis === 'invented' || basis === 'unknown');
}

export function asBasis(value: unknown): DecisionBasis {
  return typeof value === 'string' && (DECISION_BASES as readonly string[]).includes(value)
    ? (value as DecisionBasis)
    : 'unknown';
}

export function asMadeBy(value: unknown): DecisionMadeBy {
  return typeof value === 'string' && (MADE_BY_VALUES as readonly string[]).includes(value)
    ? (value as DecisionMadeBy)
    : 'unknown';
}

/** Read typed meta off an object, defaulting anything missing (older or hand-made rows). */
export function readDecisionMeta(o: Pick<UnderstandingObject, 'meta'>): DecisionMeta {
  const m = o.meta ?? {};
  const basis = asBasis(m.basis);
  const madeBy = asMadeBy(m.madeBy);
  return {
    madeBy,
    basis,
    unsupportedAutonomous:
      typeof m.unsupportedAutonomous === 'boolean'
        ? m.unsupportedAutonomous
        : isUnsupportedAutonomous(madeBy, basis),
    conflictsWithUserDirection: m.conflictsWithUserDirection === true,
    decidedAt: typeof m.decidedAt === 'string' ? m.decidedAt : undefined,
    firstStepIndex: typeof m.firstStepIndex === 'number' ? m.firstStepIndex : undefined,
    primaryPath: typeof m.primaryPath === 'string' ? m.primaryPath : '',
    conversationId: typeof m.conversationId === 'string' ? m.conversationId : undefined,
    source:
      m.source === 'recovery' || m.source === 'investigation' || m.source === 'workspace' || m.source === 'manual'
        ? m.source
        : 'manual',
    latestTraceId: typeof m.latestTraceId === 'string' ? m.latestTraceId : undefined,
    confidence: typeof m.confidence === 'number' ? m.confidence : undefined,
  };
}

/** Flatten to the scalar record UnderstandingObject.meta accepts (drops undefined). */
export function toMetaRecord(meta: DecisionMeta): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (v === undefined) continue;
    out[k] = v as string | number | boolean;
  }
  return out;
}

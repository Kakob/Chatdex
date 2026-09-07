// Decision Recovery entities (docs/specs/SPEC-decision-recovery.md §7).
//
// A Decision is an UnderstandingObject of type 'decision' — its scalar meta
// (madeBy, basis, unsupportedAutonomous, …) lives in UnderstandingObject.meta,
// exactly as intents do. This file holds the structured half: DecisionTrace
// (one recovery run's reconstruction of one decision against one repository
// snapshot; append-only, synced as kind 'decision_trace'), plus the two
// LOCAL-ONLY derived records — AgentInspection (what the agent read) and
// DecisionDiff (the Semantic Decision Diff between two runs).

import type { StepKind } from '../lib/detection/normalize';
import type { CodeEvidence } from './intentTrace';

/** Stage 04 basis vocabulary. 'specified' is the vision's REQUIRED. */
export type DecisionBasis = 'specified' | 'inherited' | 'inferred' | 'invented' | 'unknown';

export const DECISION_BASES: readonly DecisionBasis[] = [
  'specified',
  'inherited',
  'inferred',
  'invented',
  'unknown',
];

/** Derived from the roles of the citing transcript spans (spec §7.3). Never model-asserted. */
export type DecisionMadeBy = 'user' | 'agent' | 'agent_user_adopted' | 'unknown';

/** How a decision object came to exist. */
export type DecisionSource = 'recovery' | 'investigation' | 'workspace' | 'manual';

/**
 * A verified verbatim span of one normalized step. Offsets are recomputed by
 * the firewall from the quote's position in the step text (law 2.4); the
 * model's own numbers are never stored.
 */
export interface TranscriptSpan {
  conversationId: string;
  messageId: string;
  stepIndex: number;
  role: StepKind;
  /** ≤ MAX_QUOTE_CHARS, substring-verified, secret-scrubbed. */
  quote: string;
  /** UTF-16 offsets into the step text. */
  startOffset: number;
  endOffset: number;
}

export interface DecisionAssumption {
  id: string;
  statement: string;
  /** Mechanically constrained after the model answers (law 2.2). */
  basis: DecisionBasis;
  transcriptEvidence: TranscriptSpan[];
  codeEvidence: CodeEvidence[];
  /** For 'inherited': the repo path or dependency it was inherited from. */
  inheritedFrom?: string;
  /** Model text, ≤ MAX_AI_TEXT_CHARS. */
  rationale?: string;
}

export interface DecisionAlternative {
  statement: string;
  /** Present when the transcript shows the alternative being weighed. */
  transcriptEvidence: TranscriptSpan[];
  rejectedBecause?: string;
}

/** A model claim that newer evidence contradicts an existing decision or assumption. Lands on the trace only (law 2.3). */
export interface DecisionInvalidation {
  decisionObjectId: string;
  assumptionId?: string;
  evidence: TranscriptSpan[];
  codeEvidence: CodeEvidence[];
}

/** One recovery run's reconstruction of one decision against one repository snapshot. */
export interface DecisionTrace {
  id: string;
  projectId: string;
  /** The UnderstandingObject (type 'decision') this trace reconstructs. */
  decisionObjectId: string;
  /** Groups every trace from one recovery run; keys the diff. */
  runId: string;
  /** 'gh:owner/repo' or 'fs:<name>' when a snapshot was bound at run time. */
  repoKey?: string;
  /** 40-hex sha, or 'local' for a working tree. */
  sha?: string;
  why?: string;
  alternatives: DecisionAlternative[];
  assumptions: DecisionAssumption[];
  /** Decision-level evidence; ≥ 1 span (law 2.1). */
  transcriptEvidence: TranscriptSpan[];
  /** implementedBy — deterministic half: anchors whose hunks the model cited. */
  anchorStableKeys: string[];
  /** implementedBy — model half, verified against fetched excerpts. */
  implEvidence: CodeEvidence[];
  /** Identifiers declared in the cited hunks (regex; feeds blast radius). */
  symbols: string[];
  /** Test paths matched by basename heuristic at trace time (no LLM). */
  testPaths: string[];
  invalidates: DecisionInvalidation[];
  /** Exactly which repository paths were sent to the provider (audit). */
  fetchedPaths: string[];
  provider: 'anthropic' | 'openai';
  model: string;
  warnings: string[];
  createdAt: Date;
}

/** LOCAL-ONLY. One Read / Grep / Glob / LS tool call — what the agent saw. */
export type AgentInspectionKind = 'read' | 'search' | 'list';

export interface AgentInspection {
  /** `${sourceRef}#s${stepIndex}` — equals the anchor key scheme, so re-derivation is idempotent. */
  id: string;
  conversationId: string;
  messageId: string;
  stepIndex: number;
  toolName: string;
  kind: AgentInspectionKind;
  /** Normalized; repo-relative when the conversation's working directory resolves it. */
  path?: string;
  pattern?: string;
  occurredAt: Date;
  deriverVersion: string;
}

export type DecisionDiffOp =
  | 'new_decision'
  | 'revised'
  | 'new_assumption'
  | 'invalidated'
  | 'unresolved';

export interface DecisionDiffEntry {
  op: DecisionDiffOp;
  decisionObjectId: string;
  assumptionId?: string;
  fromTraceId?: string;
  toTraceId?: string;
  /** For 'revised': which of why / alternatives / assumptions / basis / implPaths changed. */
  changedFields?: string[];
  evidence?: TranscriptSpan[];
  codeEvidence?: CodeEvidence[];
}

/** LOCAL-ONLY, derived: a pure fold over two runs' traces (law 2.8). */
export interface DecisionDiff {
  /** `${fromRunId}..${toRunId}` — deterministic, idempotent. */
  id: string;
  projectId: string;
  fromRunId: string;
  toRunId: string;
  fromSha?: string;
  toSha?: string;
  entries: DecisionDiffEntry[];
  differVersion: string;
  createdAt: Date;
}

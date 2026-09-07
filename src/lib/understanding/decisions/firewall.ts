// Recovery firewall (SPEC-decision-recovery §9.4, laws 2.1–2.4).
//
// The model's answer is a set of claims. Each transcript quote must locate in
// a step that was actually supplied; each code quote must locate in a fetched
// file; offsets and lines are recomputed; anchor indexes must be anchors that
// were shown. Basis labels are re-derived from what survived (law 2.2), and
// `madeBy` / `unsupportedAutonomous` are computed, never read (§7.3).
// Anything unverifiable is dropped with a warning — never stored as text.

import type { StepKind } from '../../detection/normalize';
import { locateQuote, verifyCodeEvidence, MAX_STORED_QUOTE_CHARS } from '../trace/judge';
import { scrubSecrets } from '../trace/fetchPolicy';
import { MAX_AI_TEXT_CHARS } from '../../../types/evidence';
import { generateId } from '../../utils/ids';
import { asBasis, isUnsupportedAutonomous } from './meta';
import { MAX_ALTERNATIVES_PER_DECISION, MAX_ASSUMPTIONS_PER_DECISION, MAX_DECISIONS_PER_CALL } from './prompt';
import type { CodeEvidence } from '../../../types/intentTrace';
import type {
  DecisionAlternative,
  DecisionAssumption,
  DecisionBasis,
  DecisionInvalidation,
  DecisionMadeBy,
  TranscriptSpan,
} from '../../../types/decision';

export const MAX_STATEMENT_CHARS = 300;

export interface SuppliedStep {
  messageId: string;
  role: StepKind;
  /** Exactly the text the model saw. */
  text: string;
}

export interface FirewallContext {
  conversationId: string;
  /** Only the steps that were sent (law 2.1). */
  steps: Map<number, SuppliedStep>;
  /** stepIndex → anchor, for steps whose excerpt was a hunk. */
  anchorsByStep: Map<number, { stableKey: string; paths: string[] }>;
  /** path → scrubbed file text that was sent. */
  fetched: Map<string, string>;
  preExistingPaths: Set<string>;
  inspectedPaths: Set<string>;
  dependencies: Set<string>;
  existingDecisionIds: Set<string>;
  maxDecisions?: number;
  maxAssumptions?: number;
  maxAlternatives?: number;
}

export interface VerifiedDecision {
  existingObjectId: string | null;
  statement: string;
  why?: string;
  confidence: number;
  basis: DecisionBasis;
  madeBy: DecisionMadeBy;
  unsupportedAutonomous: boolean;
  transcriptEvidence: TranscriptSpan[];
  anchorStableKeys: string[];
  implEvidence: CodeEvidence[];
  alternatives: DecisionAlternative[];
  assumptions: DecisionAssumption[];
  firstStepIndex: number;
  primaryPath: string;
}

export interface ParsedRecovery {
  decisions: VerifiedDecision[];
  invalidates: DecisionInvalidation[];
  warnings: string[];
}

function asString(v: unknown, max = MAX_AI_TEXT_CHARS): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t ? scrubSecrets(t.slice(0, max)).text : undefined;
}

function rawSpans(v: unknown): Array<{ stepIndex: number; quote: string }> {
  if (!Array.isArray(v)) return [];
  const out: Array<{ stepIndex: number; quote: string }> = [];
  for (const e of v) {
    const rec = (e ?? {}) as Record<string, unknown>;
    const stepIndex = typeof rec.stepIndex === 'number' && Number.isInteger(rec.stepIndex) ? rec.stepIndex : null;
    const quote = typeof rec.quote === 'string' ? rec.quote : null;
    if (stepIndex !== null && quote && quote.trim()) out.push({ stepIndex, quote });
  }
  return out;
}

function rawCode(v: unknown): Array<{ path: string; quote: string }> {
  if (!Array.isArray(v)) return [];
  const out: Array<{ path: string; quote: string }> = [];
  for (const e of v) {
    const rec = (e ?? {}) as Record<string, unknown>;
    if (typeof rec.path === 'string' && typeof rec.quote === 'string' && rec.quote.trim()) {
      out.push({ path: rec.path, quote: rec.quote });
    }
  }
  return out;
}

/** Law 2.1 + 2.4: the step must have been supplied and the quote must locate in it. */
export function verifyTranscriptSpan(
  raw: { stepIndex: number; quote: string },
  ctx: Pick<FirewallContext, 'conversationId' | 'steps'>
): TranscriptSpan | null {
  const step = ctx.steps.get(raw.stepIndex);
  if (!step) return null;
  const located = locateQuote(raw.quote, step.text);
  if (!located) return null;
  return {
    conversationId: ctx.conversationId,
    messageId: step.messageId,
    stepIndex: raw.stepIndex,
    role: step.role,
    quote: step.text.slice(located.start, located.end).slice(0, MAX_STORED_QUOTE_CHARS),
    startOffset: located.start,
    endOffset: located.end,
  };
}

function verifySpans(
  raws: Array<{ stepIndex: number; quote: string }>,
  ctx: FirewallContext,
  warnings: string[],
  label: string
): TranscriptSpan[] {
  const out: TranscriptSpan[] = [];
  for (const r of raws) {
    const span = verifyTranscriptSpan(r, ctx);
    if (span) out.push(span);
  }
  if (out.length < raws.length) warnings.push(`Dropped ${raws.length - out.length} unverifiable transcript quote(s) on ${label}`);
  return out;
}

function verifyCode(
  raws: Array<{ path: string; quote: string }>,
  ctx: FirewallContext,
  warnings: string[],
  label: string
): CodeEvidence[] {
  const out: CodeEvidence[] = [];
  for (const r of raws) {
    const ev = verifyCodeEvidence(r, ctx.fetched);
    if (ev) out.push(ev);
  }
  if (out.length < raws.length) warnings.push(`Dropped ${raws.length - out.length} unverifiable code quote(s) on ${label}`);
  return out;
}

const AGENT_ROLES: readonly StepKind[] = ['agent_text', 'tool_call', 'tool_result'];

/** §7.3 — from span roles and ordering only. */
export function deriveMadeBy(spans: TranscriptSpan[]): DecisionMadeBy {
  if (spans.length === 0) return 'unknown';
  const userIdx = spans.filter((s) => s.role === 'user_msg').map((s) => s.stepIndex);
  const agentTextIdx = spans.filter((s) => s.role === 'agent_text').map((s) => s.stepIndex);
  if (userIdx.length > 0) {
    const firstUser = Math.min(...userIdx);
    return agentTextIdx.some((i) => i < firstUser) ? 'agent_user_adopted' : 'user';
  }
  return 'agent';
}

export interface BasisConstraintInput {
  claimed: unknown;
  spans: TranscriptSpan[];
  code: CodeEvidence[];
  inheritedFrom?: string;
}

/** Law 2.2 — permit or downgrade the model's label from what actually survived verification. */
export function constrainBasis(
  input: BasisConstraintInput,
  ctx: Pick<FirewallContext, 'preExistingPaths' | 'inspectedPaths' | 'dependencies'>
): { basis: DecisionBasis; warning?: string } {
  const claimedStr = typeof input.claimed === 'string' ? input.claimed.toLowerCase() : '';
  const claimed = asBasis(claimedStr);
  if (claimed === 'unknown' && claimedStr !== 'unknown') {
    return { basis: 'unknown', warning: `Unknown basis "${String(input.claimed)}"; recorded as unknown` };
  }
  const hasUser = input.spans.some((s) => s.role === 'user_msg');
  const hasAgent = input.spans.some((s) => AGENT_ROLES.includes(s.role));
  const fallback: DecisionBasis = hasAgent ? 'inferred' : 'unknown';

  switch (claimed) {
    case 'specified':
      return hasUser
        ? { basis: 'specified' }
        : { basis: fallback, warning: `"specified" had no user-message quote; downgraded to ${fallback}` };
    case 'inherited': {
      const codeOk = input.code.some((c) => ctx.preExistingPaths.has(c.path));
      const from = input.inheritedFrom;
      const pointerOk =
        Boolean(from) &&
        (ctx.preExistingPaths.has(from!) || ctx.inspectedPaths.has(from!) || ctx.dependencies.has(from!));
      return codeOk || pointerOk
        ? { basis: 'inherited' }
        : { basis: fallback, warning: `"inherited" had no pre-existing code, inspected path, or dependency pointer; downgraded to ${fallback}` };
    }
    case 'invented':
      return hasUser
        ? { basis: 'inferred', warning: '"invented" cited a user message; recorded as inferred' }
        : { basis: 'invented' };
    case 'inferred':
      return hasAgent
        ? { basis: 'inferred' }
        : { basis: 'unknown', warning: '"inferred" had no agent quote; recorded as unknown' };
    default:
      return { basis: 'unknown' };
  }
}

export function parseRecoveryResponse(text: string, ctx: FirewallContext): ParsedRecovery {
  const stripped = text.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
  let raw: unknown;
  try {
    raw = JSON.parse(stripped);
  } catch {
    throw new Error('Recovery response was not valid JSON');
  }
  const obj = (raw ?? {}) as Record<string, unknown>;
  const warnings: string[] = [];
  const maxDecisions = ctx.maxDecisions ?? MAX_DECISIONS_PER_CALL;
  const maxAssumptions = ctx.maxAssumptions ?? MAX_ASSUMPTIONS_PER_DECISION;
  const maxAlternatives = ctx.maxAlternatives ?? MAX_ALTERNATIVES_PER_DECISION;

  const decisions: VerifiedDecision[] = [];
  const rawDecisions = Array.isArray(obj.decisions) ? obj.decisions : [];
  for (const entry of rawDecisions) {
    if (decisions.length >= maxDecisions) {
      warnings.push(`Dropped decisions beyond the cap of ${maxDecisions}`);
      break;
    }
    const rec = (entry ?? {}) as Record<string, unknown>;
    const statement = asString(rec.statement, MAX_STATEMENT_CHARS);
    if (!statement) {
      warnings.push('Dropped decision without a statement');
      continue;
    }
    const spans = verifySpans(rawSpans(rec.evidence), ctx, warnings, `"${statement}"`);
    if (spans.length === 0) {
      warnings.push(`Dropped "${statement}": no verifiable transcript evidence (law 2.1)`);
      continue;
    }
    const implementedBy = (rec.implementedBy ?? {}) as Record<string, unknown>;
    const implEvidence = verifyCode(rawCode(implementedBy.code), ctx, warnings, `"${statement}"`);
    const anchorStableKeys: string[] = [];
    const anchorPaths: string[] = [];
    const rawAnchorIdx = Array.isArray(implementedBy.anchorStepIndexes) ? implementedBy.anchorStepIndexes : [];
    for (const idx of rawAnchorIdx) {
      const anchor = typeof idx === 'number' ? ctx.anchorsByStep.get(idx) : undefined;
      if (!anchor) {
        warnings.push(`Dropped anchor step ${String(idx)} on "${statement}": not an edit that was shown`);
        continue;
      }
      if (!anchorStableKeys.includes(anchor.stableKey)) {
        anchorStableKeys.push(anchor.stableKey);
        anchorPaths.push(...anchor.paths);
      }
    }

    const alternatives: DecisionAlternative[] = [];
    const rawAlts = Array.isArray(rec.alternatives) ? rec.alternatives.slice(0, maxAlternatives) : [];
    for (const a of rawAlts) {
      const arec = (a ?? {}) as Record<string, unknown>;
      const altStatement = asString(arec.statement, MAX_STATEMENT_CHARS);
      if (!altStatement) continue;
      alternatives.push({
        statement: altStatement,
        transcriptEvidence: verifySpans(rawSpans(arec.evidence), ctx, warnings, `alternative "${altStatement}"`),
        rejectedBecause: asString(arec.rejectedBecause),
      });
    }

    const assumptions: DecisionAssumption[] = [];
    const rawAssumptions = Array.isArray(rec.assumptions) ? rec.assumptions : [];
    if (rawAssumptions.length > maxAssumptions) warnings.push(`Dropped assumptions beyond the cap of ${maxAssumptions} on "${statement}"`);
    for (const a of rawAssumptions.slice(0, maxAssumptions)) {
      const arec = (a ?? {}) as Record<string, unknown>;
      const aStatement = asString(arec.statement, MAX_STATEMENT_CHARS);
      if (!aStatement) continue;
      const aSpans = verifySpans(rawSpans(arec.evidence), ctx, warnings, `assumption "${aStatement}"`);
      if (aSpans.length === 0) {
        warnings.push(`Dropped assumption "${aStatement}": no verifiable transcript evidence (law 2.1)`);
        continue;
      }
      const aCode = verifyCode(rawCode(arec.code), ctx, warnings, `assumption "${aStatement}"`);
      const inheritedFrom = asString(arec.inheritedFrom, 300);
      const constrained = constrainBasis({ claimed: arec.basis, spans: aSpans, code: aCode, inheritedFrom }, ctx);
      if (constrained.warning) warnings.push(`Assumption "${aStatement}": ${constrained.warning}`);
      assumptions.push({
        id: generateId(),
        statement: aStatement,
        basis: constrained.basis,
        transcriptEvidence: aSpans,
        codeEvidence: aCode,
        inheritedFrom: constrained.basis === 'inherited' ? inheritedFrom : undefined,
        rationale: asString(arec.rationale),
      });
    }

    const constrained = constrainBasis(
      { claimed: rec.basis, spans, code: implEvidence, inheritedFrom: undefined },
      ctx
    );
    if (constrained.warning) warnings.push(`Decision "${statement}": ${constrained.warning}`);
    const madeBy = deriveMadeBy(spans);

    let existingObjectId = asString(rec.existingObjectId, 200) ?? null;
    if (existingObjectId && !ctx.existingDecisionIds.has(existingObjectId)) {
      warnings.push(`Dropped unknown existingObjectId "${existingObjectId}" on "${statement}"; treated as new`);
      existingObjectId = null;
    }

    const confidence =
      typeof rec.confidence === 'number' && Number.isFinite(rec.confidence)
        ? Math.min(1, Math.max(0, rec.confidence))
        : 0.5;

    decisions.push({
      existingObjectId,
      statement,
      why: asString(rec.why),
      confidence,
      basis: constrained.basis,
      madeBy,
      unsupportedAutonomous: isUnsupportedAutonomous(madeBy, constrained.basis),
      transcriptEvidence: spans,
      anchorStableKeys,
      implEvidence,
      alternatives,
      assumptions,
      firstStepIndex: Math.min(...spans.map((s) => s.stepIndex)),
      primaryPath: anchorPaths[0] ?? implEvidence[0]?.path ?? '',
    });
  }

  const invalidates: DecisionInvalidation[] = [];
  const rawInvalidates = Array.isArray(obj.invalidates) ? obj.invalidates : [];
  for (const entry of rawInvalidates) {
    const rec = (entry ?? {}) as Record<string, unknown>;
    const target = asString(rec.existingObjectId, 200);
    if (!target || !ctx.existingDecisionIds.has(target)) {
      warnings.push('Dropped invalidation of an unknown decision');
      continue;
    }
    const spans = verifySpans(rawSpans(rec.evidence), ctx, warnings, `invalidation of ${target}`);
    const code = verifyCode(rawCode(rec.code), ctx, warnings, `invalidation of ${target}`);
    if (spans.length === 0 && code.length === 0) {
      warnings.push(`Dropped invalidation of ${target}: no verifiable evidence`);
      continue;
    }
    const assumptionStatement = asString(rec.assumptionStatement, MAX_STATEMENT_CHARS);
    invalidates.push({
      decisionObjectId: target,
      // The assumption id is resolved by the runner against the target's latest trace.
      assumptionId: assumptionStatement ? `statement:${assumptionStatement}` : undefined,
      evidence: spans,
      codeEvidence: code,
    });
  }

  return { decisions, invalidates, warnings };
}

// Loop detector (SPEC §2.1). Deterministic and rule-based: flags exact
// signature repeats within a sliding step window and short signature
// sequences repeating consecutively. Two suppression stages guard against
// false positives — retry-shaped whitelisting and intervening state changes —
// and every surviving finding records both evaluations.

import type { SuppressionOutcome } from '../../../types/detection';
import type { NormalizedSession, Step } from '../normalize';
import type { Detector, DetectorFinding } from '../registry';

export const LOOP_DETECTOR_VERSION = '1.0.0';

export interface LoopDetectorConfig {
  /** N: occurrences of one signature within the window to flag. */
  repeatThreshold: number;
  /** M: sliding window size, measured in session steps. */
  windowSize: number;
  /** Shortest signature sequence considered for sequence repeats. */
  sequenceMinLength: number;
  /** Longest signature sequence considered for sequence repeats. */
  sequenceMaxLength: number;
  /** Consecutive repeats of a sequence required to flag. */
  sequenceMinRepeats: number;
  /**
   * Regex sources matched against Bash commands (or the signature for other
   * tools). A candidate whose every distinct signature matches is
   * retry-shaped (polling, watchers, backoff) and is dropped.
   */
  retryWhitelist: string[];
  [key: string]: unknown;
}

export const DEFAULT_LOOP_CONFIG: LoopDetectorConfig = {
  repeatThreshold: 3,
  windowSize: 10,
  sequenceMinLength: 2,
  sequenceMaxLength: 4,
  sequenceMinRepeats: 2,
  retryWhitelist: [
    'gh\\s+run\\s+(view|watch)\\b',
    'gh\\s+pr\\s+checks\\b',
    '\\bsleep\\b',
    '--watch\\b',
    '\\bkubectl\\s+get\\b',
    '\\bdocker\\s+ps\\b',
    '\\b(status|health|healthz|ping)\\b',
  ],
};

interface ToolCallRef {
  step: Step;
  /** Text the retry whitelist matches against. */
  matchTarget: string;
}

interface LoopCandidate {
  kind: 'exact_repeat' | 'sequence_repeat';
  /** The repeated unit: one signature, or the sequence of signatures. */
  signatures: string[];
  /** All tool_call steps participating, in order. */
  calls: ToolCallRef[];
  suppressions: SuppressionOutcome[];
}

export const loopDetector: Detector<LoopDetectorConfig> = {
  id: 'loop',
  version: LOOP_DETECTOR_VERSION,
  defaultConfig: DEFAULT_LOOP_CONFIG,
  run(session, config) {
    const calls = collectToolCalls(session);

    const sequenceCandidates = findSequenceCandidates(calls, config);
    const exactCandidates = findExactCandidates(calls, session, config).filter(
      (candidate) => !isSubsumedBySequence(candidate, sequenceCandidates)
    );

    const findings: DetectorFinding[] = [];
    for (const candidate of [...exactCandidates, ...sequenceCandidates]) {
      const finding = applySuppressions(candidate, session, config);
      if (finding) findings.push(finding);
    }
    return findings.sort((a, b) => a.stepRange.start - b.stepRange.start);
  },
};

function collectToolCalls(session: NormalizedSession): ToolCallRef[] {
  const refs: ToolCallRef[] = [];
  for (const step of session.steps) {
    if (step.kind !== 'tool_call' || !step.signature) continue;
    const command =
      step.toolName === 'Bash' && typeof step.toolInput?.command === 'string'
        ? step.toolInput.command
        : undefined;
    refs.push({ step, matchTarget: command ?? step.signature });
  }
  return refs;
}

// ── Exact repeats: same signature ≥N times within an M-step window ──────────

function findExactCandidates(
  calls: ToolCallRef[],
  session: NormalizedSession,
  config: LoopDetectorConfig
): LoopCandidate[] {
  const bySignature = new Map<string, ToolCallRef[]>();
  for (const ref of calls) {
    const sig = ref.step.signature!;
    const list = bySignature.get(sig) ?? [];
    list.push(ref);
    bySignature.set(sig, list);
  }

  const candidates: LoopCandidate[] = [];
  for (const [signature, occurrences] of bySignature) {
    let i = 0;
    while (i < occurrences.length) {
      // Seed: does an M-step window starting at occurrence i hold ≥N repeats?
      let j = i;
      while (
        j + 1 < occurrences.length &&
        occurrences[j + 1].step.index <=
          occurrences[i].step.index + config.windowSize - 1
      ) {
        j++;
      }
      if (j - i + 1 < config.repeatThreshold) {
        i++;
        continue;
      }
      // Extend: once looping is established, subsequent repeats within one
      // window-length of the previous occurrence continue the same loop.
      let k = j;
      while (
        k + 1 < occurrences.length &&
        occurrences[k + 1].step.index - occurrences[k].step.index <=
          config.windowSize
      ) {
        k++;
      }
      candidates.push({
        kind: 'exact_repeat',
        signatures: [signature],
        calls: occurrences.slice(i, k + 1),
        suppressions: [],
      });
      i = k + 1;
    }
  }
  return candidates;
}

function windowQualifies(refs: ToolCallRef[], config: LoopDetectorConfig): boolean {
  for (let i = 0; i + config.repeatThreshold - 1 < refs.length; i++) {
    const last = refs[i + config.repeatThreshold - 1];
    if (last.step.index <= refs[i].step.index + config.windowSize - 1) return true;
  }
  return false;
}

// ── Sequence repeats: a 2–4 signature block repeating ≥2x consecutively ─────

function findSequenceCandidates(
  calls: ToolCallRef[],
  config: LoopDetectorConfig
): LoopCandidate[] {
  const sigs = calls.map((c) => c.step.signature!);
  const candidates: LoopCandidate[] = [];

  let i = 0;
  while (i < calls.length) {
    let best: { length: number; repeats: number } | null = null;
    for (let L = config.sequenceMinLength; L <= config.sequenceMaxLength; L++) {
      if (i + 2 * L > calls.length) break;
      const unit = sigs.slice(i, i + L);
      // A one-signature "sequence" is the exact-repeat detector's job.
      if (new Set(unit).size < 2) continue;

      let repeats = 1;
      while (
        i + (repeats + 1) * L <= calls.length &&
        unit.every((sig, o) => sigs[i + repeats * L + o] === sig)
      ) {
        repeats++;
      }
      if (repeats >= config.sequenceMinRepeats) {
        if (!best || repeats * L > best.repeats * best.length) {
          best = { length: L, repeats };
        }
      }
    }
    if (best) {
      const span = best.length * best.repeats;
      candidates.push({
        kind: 'sequence_repeat',
        signatures: sigs.slice(i, i + best.length),
        calls: calls.slice(i, i + span),
        suppressions: [],
      });
      i += span;
    } else {
      i++;
    }
  }
  return candidates;
}

function isSubsumedBySequence(
  exact: LoopCandidate,
  sequences: LoopCandidate[]
): boolean {
  const sig = exact.signatures[0];
  return sequences.some(
    (seq) =>
      seq.signatures.includes(sig) &&
      exact.calls.every(
        (c) =>
          c.step.index >= seq.calls[0].step.index &&
          c.step.index <= seq.calls[seq.calls.length - 1].step.index
      )
  );
}

// ── Suppressions ─────────────────────────────────────────────────────────────

function applySuppressions(
  candidate: LoopCandidate,
  session: NormalizedSession,
  config: LoopDetectorConfig
): DetectorFinding | null {
  const whitelist = config.retryWhitelist.map((src) => new RegExp(src, 'i'));

  // 1. Retry whitelist: retry-shaped when every distinct signature matches.
  const targets = new Map<string, string>();
  for (const ref of candidate.calls) {
    targets.set(ref.step.signature!, ref.matchTarget);
  }
  const allWhitelisted = [...targets.values()].every((target) =>
    whitelist.some((re) => re.test(target))
  );
  candidate.suppressions.push({
    rule: 'retry-whitelist',
    fired: allWhitelisted,
    detail: allWhitelisted
      ? 'all signatures match retry-shaped patterns (polling/watch/backoff)'
      : 'no retry-shaped pattern matched every signature',
  });
  if (allWhitelisted) return null;

  // 2. Intervening state change: a state-changing call that is not part of
  // the loop's own signature set breaks repetition — occurrences after it
  // are trimmed off; the candidate dies if too few repeats remain.
  let survivingCalls = candidate.calls;
  let trimmedAt: number | null = null;

  if (candidate.kind === 'exact_repeat') {
    const loopSignatures = new Set(candidate.signatures);
    const segments = segmentByStateChange(candidate.calls, session, loopSignatures);
    const qualifying = segments.find((seg) =>
      seg.length >= config.repeatThreshold && windowQualifies(seg, config)
    );
    if (!qualifying) {
      // Fully suppressed — no finding survives to carry the record.
      return null;
    }
    if (qualifying.length < candidate.calls.length) {
      survivingCalls = qualifying;
      trimmedAt = firstStateChangeAfter(
        qualifying[qualifying.length - 1].step.index,
        session,
        new Set(candidate.signatures)
      );
    }
  }
  // Sequence repeats are consecutive in the tool-call stream, so no external
  // tool call can sit between repeats; the rule is evaluated but cannot fire.
  candidate.suppressions.push({
    rule: 'intervening-state-change',
    fired: trimmedAt !== null,
    detail:
      trimmedAt !== null
        ? `occurrences after step ${trimmedAt} excluded (state change at step ${trimmedAt})`
        : 'no state change between repeats',
  });

  return buildFinding(candidate, survivingCalls, session, config);
}

/** Split occurrences wherever an external state-changing call intervenes. */
function segmentByStateChange(
  occurrences: ToolCallRef[],
  session: NormalizedSession,
  loopSignatures: Set<string>
): ToolCallRef[][] {
  const segments: ToolCallRef[][] = [[occurrences[0]]];
  for (let i = 1; i < occurrences.length; i++) {
    const prev = occurrences[i - 1].step.index;
    const curr = occurrences[i].step.index;
    if (hasExternalStateChange(session, prev, curr, loopSignatures)) {
      segments.push([]);
    }
    segments[segments.length - 1].push(occurrences[i]);
  }
  return segments;
}

function hasExternalStateChange(
  session: NormalizedSession,
  afterStep: number,
  beforeStep: number,
  loopSignatures: Set<string>
): boolean {
  for (let s = afterStep + 1; s < beforeStep; s++) {
    const step = session.steps[s];
    if (
      step.kind === 'tool_call' &&
      step.toolClass === 'state_changing' &&
      !loopSignatures.has(step.signature ?? '')
    ) {
      return true;
    }
  }
  return false;
}

function firstStateChangeAfter(
  stepIndex: number,
  session: NormalizedSession,
  loopSignatures: Set<string>
): number | null {
  for (let s = stepIndex + 1; s < session.steps.length; s++) {
    const step = session.steps[s];
    if (
      step.kind === 'tool_call' &&
      step.toolClass === 'state_changing' &&
      !loopSignatures.has(step.signature ?? '')
    ) {
      return s;
    }
  }
  return null;
}

// ── Finding assembly ─────────────────────────────────────────────────────────

function buildFinding(
  candidate: LoopCandidate,
  calls: ToolCallRef[],
  session: NormalizedSession,
  config: LoopDetectorConfig
): DetectorFinding {
  const start = calls[0].step.index;
  const lastCall = calls[calls.length - 1].step.index;
  // Include the last repeat's immediate result so the evidence panel shows
  // what the repeated action kept producing.
  const next = session.steps[lastCall + 1];
  const end = next?.kind === 'tool_result' ? next.index : lastCall;

  const repeatCount =
    candidate.kind === 'exact_repeat'
      ? calls.length
      : calls.length / candidate.signatures.length;

  const summary =
    candidate.kind === 'exact_repeat'
      ? `Same action repeated ${repeatCount}x without progress: ${describeCall(calls[0])}`
      : `A ${candidate.signatures.length}-step action sequence repeated ${repeatCount}x without progress`;

  return {
    detector: loopDetector.id,
    severity: 'medium',
    stepRange: { start, end },
    summary,
    evidence: {
      kind: candidate.kind,
      signatures: candidate.signatures,
      repeatCount,
      occurrenceSteps: calls.map((c) => c.step.index),
      thresholds: {
        repeatThreshold: config.repeatThreshold,
        windowSize: config.windowSize,
        sequenceMinRepeats: config.sequenceMinRepeats,
      },
    },
    suppressionsEvaluated: candidate.suppressions,
  };
}

function describeCall(ref: ToolCallRef): string {
  const { step } = ref;
  if (step.toolName === 'Bash' && typeof step.toolInput?.command === 'string') {
    return `Bash \`${step.toolInput.command}\``;
  }
  return step.toolName ?? 'unknown tool';
}

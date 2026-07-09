// Verification-absence detector (SPEC §2.2). After every state-changing
// action, scan forward until the session moves to a new task (new user
// message, explicit task transition in agent text) or ends. Flag when no
// verification-shaped action — or read-back of the edited file — occurs in
// that span. Asserted-but-unverified ("the tests should pass now" with no
// verification following) escalates to high severity.

import type { SuppressionOutcome } from '../../../types/detection';
import { normalizePath } from '../signatures';
import type { NormalizedSession, Step } from '../normalize';
import type { Detector, DetectorFinding } from '../registry';

export const VERIFICATION_ABSENCE_DETECTOR_VERSION = '1.0.0';

export interface VerificationAbsenceConfig {
  /**
   * Regex sources matched (case-insensitively) against agent text within the
   * scanned span. A match with no verification following escalates to high.
   */
  successAssertionPatterns: string[];
  /**
   * Regex sources marking an explicit task transition in agent text — the
   * secondary topic-shift heuristic besides a new user message.
   */
  taskTransitionPatterns: string[];
  [key: string]: unknown;
}

export const DEFAULT_VERIFICATION_ABSENCE_CONFIG: VerificationAbsenceConfig = {
  successAssertionPatterns: [
    'should\\s+(now\\s+)?(pass|work|succeed|be\\s+fixed)',
    'should\\s+work\\s+correctly',
    '(this|that)\\s+fixes',
    '\\bfixed\\b',
    '\\ball\\s+set\\b',
    '\\bgood\\s+to\\s+go\\b',
    'works\\s+(now|as\\s+expected)',
  ],
  taskTransitionPatterns: [
    'moving\\s+on\\s+to',
    "now\\s+let'?s\\b",
    "next,?\\s+(i'?ll|let'?s)\\b",
    'turning\\s+to\\b',
  ],
};

type SpanEndReason = 'topic_shift' | 'task_transition' | 'session_end';

export const verificationAbsenceDetector: Detector<VerificationAbsenceConfig> = {
  id: 'verification_absence',
  version: VERIFICATION_ABSENCE_DETECTOR_VERSION,
  defaultConfig: DEFAULT_VERIFICATION_ABSENCE_CONFIG,
  run(session, config) {
    const transitionRes = config.taskTransitionPatterns.map(
      (src) => new RegExp(src, 'i')
    );
    const assertionRes = config.successAssertionPatterns.map(
      (src) => new RegExp(src, 'i')
    );

    const findings: DetectorFinding[] = [];
    for (const step of session.steps) {
      if (step.kind !== 'tool_call' || step.toolClass !== 'state_changing') {
        continue;
      }
      const finding = evaluateSpan(session, step, transitionRes, assertionRes);
      if (finding) findings.push(finding);
    }
    return findings;
  },
};

function evaluateSpan(
  session: NormalizedSession,
  anchor: Step,
  transitionRes: RegExp[],
  assertionRes: RegExp[]
): DetectorFinding | null {
  const { spanEnd, reason } = scanForward(session, anchor.index, transitionRes);
  const editedPaths = new Set(
    (anchor.editHunks ?? []).map((h) => h.filePath)
  );

  // Verification within the span: any verification-shaped call, or a
  // read-back of the file this action edited (SPEC §2.2 lists read-backs
  // of edited files as verification-shaped; intrinsic classification cannot
  // know "edited", so the detector resolves it contextually here).
  for (let i = anchor.index + 1; i <= spanEnd; i++) {
    const step = session.steps[i];
    if (step.kind !== 'tool_call') continue;
    if (step.toolClass === 'verification_shaped') return null;
    if (isReadBack(step, editedPaths)) return null;
  }

  const assertion = findSuccessAssertion(session, anchor.index, spanEnd, assertionRes);

  const suppressions: SuppressionOutcome[] = [
    {
      rule: 'verification-within-span',
      fired: false,
      detail: `no verification-shaped call or read-back between step ${anchor.index} and span end (step ${spanEnd})`,
    },
  ];

  const classifications = session.steps
    .slice(anchor.index, spanEnd + 1)
    .filter((s) => s.kind === 'tool_call')
    .map((s) => ({
      stepIndex: s.index,
      toolName: s.toolName ?? 'unknown',
      toolClass: s.toolClass ?? 'neutral',
    }));

  const what = describeAction(anchor);
  return {
    detector: verificationAbsenceDetector.id,
    severity: assertion ? 'high' : 'medium',
    stepRange: { start: anchor.index, end: spanEnd },
    summary: assertion
      ? `${what}, success asserted, but never verified before ${describeReason(reason)}`
      : `${what} but never verified before ${describeReason(reason)}`,
    evidence: {
      stateChangingStep: anchor.index,
      scannedSpan: { start: anchor.index, end: spanEnd },
      spanEndReason: reason,
      successAssertion: assertion ?? { detected: false },
      toolCallClassifications: classifications,
    },
    suppressionsEvaluated: suppressions,
  };
}

function scanForward(
  session: NormalizedSession,
  fromStep: number,
  transitionRes: RegExp[]
): { spanEnd: number; reason: SpanEndReason } {
  for (let i = fromStep + 1; i < session.steps.length; i++) {
    const step = session.steps[i];
    if (step.kind === 'user_msg') {
      return { spanEnd: i - 1, reason: 'topic_shift' };
    }
    if (
      step.kind === 'agent_text' &&
      step.text &&
      transitionRes.some((re) => re.test(step.text!))
    ) {
      return { spanEnd: i, reason: 'task_transition' };
    }
  }
  return { spanEnd: session.steps.length - 1, reason: 'session_end' };
}

function isReadBack(step: Step, editedPaths: Set<string>): boolean {
  if (editedPaths.size === 0 || step.toolName !== 'Read') return false;
  const path = step.toolInput?.file_path;
  return typeof path === 'string' && editedPaths.has(normalizePath(path));
}

interface AssertionEvidence {
  detected: true;
  stepIndex: number;
  excerpt: string;
  pattern: string;
}

function findSuccessAssertion(
  session: NormalizedSession,
  fromStep: number,
  spanEnd: number,
  assertionRes: RegExp[]
): AssertionEvidence | null {
  for (let i = fromStep + 1; i <= spanEnd; i++) {
    const step = session.steps[i];
    if (step.kind !== 'agent_text' || !step.text) continue;
    for (const re of assertionRes) {
      const match = re.exec(step.text);
      if (match) {
        return {
          detected: true,
          stepIndex: i,
          excerpt: excerptAround(step.text, match.index, match[0].length),
          pattern: re.source,
        };
      }
    }
  }
  return null;
}

function excerptAround(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 40);
  const end = Math.min(text.length, index + length + 40);
  return (
    (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '')
  );
}

function describeAction(anchor: Step): string {
  if (anchor.editHunks && anchor.editHunks.length > 0) {
    return `Edited ${anchor.editHunks[0].filePath}`;
  }
  if (anchor.toolName === 'Bash' && typeof anchor.toolInput?.command === 'string') {
    return `Ran \`${anchor.toolInput.command}\``;
  }
  return `State-changing ${anchor.toolName ?? 'tool'} call`;
}

function describeReason(reason: SpanEndReason): string {
  switch (reason) {
    case 'topic_shift':
      return 'the topic shifted';
    case 'task_transition':
      return 'the agent moved to a new task';
    case 'session_end':
      return 'the session ended';
  }
}

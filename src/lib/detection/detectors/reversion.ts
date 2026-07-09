// Silent-reversion detector (SPEC §2.3). Walks each file's edit timeline and
// flags later edits that restore a region to a previously seen state
// (textual hunk match after whitespace normalization). If the agent's text
// around the reverting edit acknowledges the reversal ("reverting",
// "undoing", "going back to"), the finding downgrades to informational —
// unacknowledged reversions are the dangerous ones.
//
// Cross-reference: an edit→revert→edit cycle is also loop-shaped. Detectors
// are independent (registry invariant), so instead of a hard link the
// evidence records the cycle steps; the UI connects findings by overlapping
// step ranges.

import type { SuppressionOutcome } from '../../../types/detection';
import type { EditHunk, NormalizedSession, TimelineEdit } from '../normalize';
import type { Detector, DetectorFinding } from '../registry';

export const REVERSION_DETECTOR_VERSION = '1.0.0';

export interface ReversionDetectorConfig {
  /** Regex sources (case-insensitive) that count as revert acknowledgment. */
  acknowledgmentPatterns: string[];
  /** Steps before the reverting edit scanned for acknowledgment text. */
  acknowledgmentLookbehind: number;
  /** Steps after the reverting edit scanned for acknowledgment text. */
  acknowledgmentLookahead: number;
  [key: string]: unknown;
}

export const DEFAULT_REVERSION_CONFIG: ReversionDetectorConfig = {
  acknowledgmentPatterns: [
    '\\brevert(ing|ed|s)?\\b',
    '\\bundo(ing)?\\b',
    '\\bundid\\b',
    '\\bgoing\\s+back\\s+to\\b',
    '\\broll(ing|ed)?\\s*back\\b',
    '\\brestor(e|ing|ed|es)\\b.{0,30}\\b(original|previous|earlier)\\b',
    '\\bback\\s+to\\s+the\\s+original\\b',
  ],
  acknowledgmentLookbehind: 3,
  acknowledgmentLookahead: 3,
};

export const reversionDetector: Detector<ReversionDetectorConfig> = {
  id: 'silent_reversion',
  version: REVERSION_DETECTOR_VERSION,
  defaultConfig: DEFAULT_REVERSION_CONFIG,
  run(session, config) {
    const ackRes = config.acknowledgmentPatterns.map((src) => new RegExp(src, 'i'));

    const findings: DetectorFinding[] = [];
    for (const [filePath, timeline] of session.editTimelines) {
      for (const pair of findReversionPairs(timeline)) {
        findings.push(buildFinding(session, filePath, timeline, pair, ackRes, config));
      }
    }
    return findings.sort((a, b) => a.stepRange.start - b.stepRange.start);
  },
};

interface ReversionPair {
  earlier: TimelineEdit;
  reverting: TimelineEdit;
}

/** Whitespace-normalized textual comparison (SPEC §2.3 step 2). */
function norm(text: string | undefined): string | undefined {
  return text?.trim().replace(/\s+/g, ' ');
}

function restores(later: EditHunk, earlier: EditHunk): boolean {
  if (earlier.oldString === undefined) return false; // whole-file Write has no prior region
  if (norm(later.newString) !== norm(earlier.oldString)) return false;
  // Region identity: the reverting edit removes the state the earlier edit
  // introduced. Whole-file Writes (no oldString) match on content alone.
  return later.oldString === undefined || norm(later.oldString) === norm(earlier.newString);
}

function findReversionPairs(timeline: TimelineEdit[]): ReversionPair[] {
  const pairs: ReversionPair[] = [];
  for (let j = 1; j < timeline.length; j++) {
    // Nearest earlier match wins: one finding per reverting edit.
    for (let i = j - 1; i >= 0; i--) {
      if (
        timeline[i].stepIndex !== timeline[j].stepIndex &&
        restores(timeline[j].hunk, timeline[i].hunk)
      ) {
        pairs.push({ earlier: timeline[i], reverting: timeline[j] });
        break;
      }
    }
  }
  return pairs;
}

interface AcknowledgmentEvidence {
  detected: true;
  stepIndex: number;
  excerpt: string;
  pattern: string;
}

function findAcknowledgment(
  session: NormalizedSession,
  revertStep: number,
  ackRes: RegExp[],
  config: ReversionDetectorConfig
): AcknowledgmentEvidence | null {
  const from = Math.max(0, revertStep - config.acknowledgmentLookbehind);
  const to = Math.min(
    session.steps.length - 1,
    revertStep + config.acknowledgmentLookahead
  );
  for (let i = from; i <= to; i++) {
    const step = session.steps[i];
    if (step.kind !== 'agent_text' || !step.text) continue;
    for (const re of ackRes) {
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

/**
 * Edit→revert→edit cross-reference: another edit on the same file repeating
 * either half of the reverted pair means the file is thrashing between two
 * states — which the loop detector may independently flag as a sequence
 * repeat. Recorded in evidence so the UI can connect the findings.
 */
function findCycleSteps(
  timeline: TimelineEdit[],
  pair: ReversionPair
): number[] {
  const halves = [pair.earlier.hunk, pair.reverting.hunk];
  const cycleSteps = timeline
    .filter(
      (edit) =>
        edit.stepIndex !== pair.earlier.stepIndex &&
        edit.stepIndex !== pair.reverting.stepIndex &&
        halves.some(
          (h) =>
            norm(edit.hunk.oldString) === norm(h.oldString) &&
            norm(edit.hunk.newString) === norm(h.newString)
        )
    )
    .map((edit) => edit.stepIndex);
  return cycleSteps.length > 0
    ? [pair.earlier.stepIndex, pair.reverting.stepIndex, ...cycleSteps].sort(
        (a, b) => a - b
      )
    : [];
}

function buildFinding(
  session: NormalizedSession,
  filePath: string,
  timeline: TimelineEdit[],
  pair: ReversionPair,
  ackRes: RegExp[],
  config: ReversionDetectorConfig
): DetectorFinding {
  const acknowledgment = findAcknowledgment(
    session,
    pair.reverting.stepIndex,
    ackRes,
    config
  );
  const cycleSteps = findCycleSteps(timeline, pair);

  const suppressions: SuppressionOutcome[] = [
    {
      rule: 'acknowledgment-language',
      fired: acknowledgment !== null,
      detail: acknowledgment
        ? `acknowledged at step ${acknowledgment.stepIndex} ("${acknowledgment.excerpt}") — downgraded to info`
        : `no acknowledgment language within ${config.acknowledgmentLookbehind} steps before / ${config.acknowledgmentLookahead} after the reverting edit`,
    },
  ];

  return {
    detector: reversionDetector.id,
    severity: acknowledgment ? 'info' : 'medium',
    stepRange: { start: pair.earlier.stepIndex, end: pair.reverting.stepIndex },
    summary: acknowledgment
      ? `Edit at step ${pair.reverting.stepIndex} restored ${filePath} to its state before step ${pair.earlier.stepIndex} (acknowledged)`
      : `Edit at step ${pair.reverting.stepIndex} silently restored ${filePath} to its state before step ${pair.earlier.stepIndex}`,
    evidence: {
      filePath,
      earlierEditStep: pair.earlier.stepIndex,
      revertingEditStep: pair.reverting.stepIndex,
      restoredRegion: {
        before: pair.earlier.hunk.oldString ?? null,
        after: pair.earlier.hunk.newString,
      },
      acknowledgment: acknowledgment ?? { detected: false },
      crossReference: {
        editRevertCycle: cycleSteps.length > 0,
        cycleSteps,
      },
    },
    suppressionsEvaluated: suppressions,
  };
}

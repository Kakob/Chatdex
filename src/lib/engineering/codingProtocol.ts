/**
 * Shared editing protocol. Human edits and agent results are identical
 * full-file source revisions with actor provenance and source fingerprints.
 * Does NOT execute pasted JavaScript, call an agent or write to Git.
 */
import type { EngineeringSourceBinding } from './sourceCatalog';

export type CodingActor = 'human' | 'agent';

export interface SourceEditProposal {
  id: string;
  projectId: string;
  targetId: string;
  bindingId: string;
  repoKey: string;
  path: string;
  sourceSha?: string;
  sourceKind: EngineeringSourceBinding['sourceKind'];
  baselineHash: string;
  proposedHash: string;
  baselineText: string;
  proposedText: string;
  intent: string;
  actor: CodingActor;
  /** e.g. "chatgpt-handoff", "codex", or a future plugin ID. */
  providerId: string;
  createdAt: Date;
}

export interface EngineeringCodingContext {
  projectId: string;
  targetId: string;
  targetName: string;
  binding: EngineeringSourceBinding;
  baselineText: string;
  intent: string;
}

/** Provider boundary shared by clipboard handoffs, agents and human editors. */
export interface EngineeringCodingProvider {
  id: string;
  actor: CodingActor;
  makeInstructions(context: EngineeringCodingContext): string;
}

/** The current "agent" is a handoff to ChatGPT, not an in-browser API call. */
export const chatGptHandoff: EngineeringCodingProvider = {
  id: 'chatgpt-handoff',
  actor: 'agent',
  makeInstructions({ projectId, targetId, targetName, binding, baselineText, intent }) {
    return [
      'ENGINEERING CODE CHANGE — Chatdex source-bound handoff',
      '',
      'Goal: ' + intent.trim(),
      'Selected model entity: ' + targetName + ' [' + targetId + ']',
      'Project ID: ' + projectId,
      'Repository source: ' + binding.repoKey,
      'File: ' + binding.path,
      'Source snapshot: ' + (binding.sha ?? 'BUNDLED/UNPINNED — verify current source before writing'),
      'Source binding anchor: ' + binding.needle,
      '',
      'Implement the requested behavior in a safe feature branch. Inspect any other',
      'affected files and tests rather than assuming this single binding is complete.',
      'Preserve existing behavior unless the goal requires changing it. Run relevant',
      'tests. Do not claim tests were run unless executed.',
      'Return changed full source file(s), exact paths, code diffs, test results,',
      'and unresolved model/behavior mismatches.',
      'In this first prototype, paste a complete changed file back into the',
      'Chatdex Build panel to stage it using the same path as human coding.',
      '',
      'Current source of selected file:',
      '--- BEGIN FILE ---',
      baselineText,
      '--- END FILE ---',
    ].join('\n');
  },
};

export const manualCoding: EngineeringCodingProvider = {
  id: 'manual-editor',
  actor: 'human',
  makeInstructions({ binding }) {
    return 'Edit or paste the complete contents of ' + binding.path + ' in the Build panel. Stage to inspect; nothing executes or writes automatically.';
  },
};

export interface CodeDiffSummary {
  added: number;
  removed: number;
  /** A bounded changed region, not a Myers diff. */
  oldChangedLines: string[];
  newChangedLines: string[];
  oldStartLine: number;
  newStartLine: number;
}

/** Stable, pure single-region summary; multiple hunks may appear in it. */
export function summarizeCodeDiff(before: string, after: string, maxLines = 16): CodeDiffSummary {
  const left = before.split('\n');
  const right = after.split('\n');
  let front = 0;
  while (front < left.length && front < right.length && left[front] === right[front]) front++;
  let tail = 0;
  while (tail < left.length - front && tail < right.length - front &&
         left[left.length - tail - 1] === right[right.length - tail - 1]) tail++;
  const oldChanged = left.slice(front, left.length - tail);
  const newChanged = right.slice(front, right.length - tail);
  return {
    added: newChanged.length, removed: oldChanged.length,
    oldChangedLines: oldChanged.slice(0, maxLines),
    newChangedLines: newChanged.slice(0, maxLines),
    oldStartLine: front + 1, newStartLine: front + 1,
  };
}

/** Byte comparison after a real source refresh; not a correctness proof. */
export type CodeSourceComparison = 'unchanged' | 'matches-proposal' | 'diverged';

export function compareSourceToProposal(edit: SourceEditProposal, currentText: string): CodeSourceComparison {
  if (currentText === edit.proposedText) return 'matches-proposal';
  if (currentText === edit.baselineText) return 'unchanged';
  return 'diverged';
}

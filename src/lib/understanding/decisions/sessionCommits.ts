// Session commits (SPEC-decision-recovery §8.2). Deterministic, no model:
// find `git commit` Bash calls in a normalized step stream and read the
// `[branch sha] message` line git prints from the paired tool result. Not
// persisted — the recovery planner surfaces it as a suggested sha to bind.

import type { Step } from '../../detection/normalize';

export interface SessionCommit {
  stepIndex: number;
  messageId: string;
  branch: string;
  /** As printed by git: 7–40 hex chars. */
  sha: string;
  /** First line of the commit subject when git echoed it. */
  subject?: string;
}

const GIT_COMMIT_RE = /\bgit\s+(?:-C\s+\S+\s+)?commit\b/;
const COMMIT_LINE_RE = /^\[([^\s\]]+)\s+(?:\(root-commit\)\s+)?([0-9a-f]{7,40})\]\s*(.*)$/m;

export function extractSessionCommits(steps: Step[]): SessionCommit[] {
  const out: SessionCommit[] = [];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (step.kind !== 'tool_call' || step.toolName !== 'Bash') continue;
    const command = step.toolInput?.command;
    if (typeof command !== 'string' || !GIT_COMMIT_RE.test(command)) continue;
    const result = pairedResult(steps, i);
    if (!result?.toolResult) continue;
    const m = COMMIT_LINE_RE.exec(result.toolResult);
    if (!m) continue;
    out.push({
      stepIndex: step.index,
      messageId: step.messageId,
      branch: m[1],
      sha: m[2],
      subject: m[3]?.trim() || undefined,
    });
  }
  return out;
}

/** tool_result paired by toolUseId first; otherwise the next tool_result step. */
function pairedResult(steps: Step[], callIndex: number): Step | undefined {
  const call = steps[callIndex];
  if (call.toolUseId) {
    const byId = steps.find(
      (s, j) => j > callIndex && s.kind === 'tool_result' && s.toolUseId === call.toolUseId
    );
    if (byId) return byId;
  }
  for (let j = callIndex + 1; j < steps.length; j++) {
    if (steps[j].kind === 'tool_result') return steps[j];
    if (steps[j].kind === 'tool_call') return undefined;
  }
  return undefined;
}

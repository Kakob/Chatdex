import { describe, it, expect } from 'vitest';
import { extractSessionCommits } from './sessionCommits';
import type { Step } from '../../detection/normalize';

function step(partial: Partial<Step> & Pick<Step, 'kind'>, index: number): Step {
  return { index, messageId: `m${index}`, ...partial };
}

describe('extractSessionCommits (SPEC-decision-recovery §8.2)', () => {
  it('reads the [branch sha] line from the paired tool result', () => {
    const steps: Step[] = [
      step({ kind: 'tool_call', toolName: 'Bash', toolInput: { command: 'git commit -m "feat: delete projects"' }, toolUseId: 'u1' }, 0),
      step({ kind: 'tool_result', toolUseId: 'u1', toolResult: '[demo/project-deletion 1a2b3c4] feat: delete projects\n 3 files changed' }, 1),
    ];
    expect(extractSessionCommits(steps)).toEqual([
      { stepIndex: 0, messageId: 'm0', branch: 'demo/project-deletion', sha: '1a2b3c4', subject: 'feat: delete projects' },
    ]);
  });

  it('handles root commits, git -C, adjacency pairing, and ignores non-commit git calls', () => {
    const steps: Step[] = [
      step({ kind: 'tool_call', toolName: 'Bash', toolInput: { command: 'git status' } }, 0),
      step({ kind: 'tool_result', toolResult: 'On branch main' }, 1),
      step({ kind: 'tool_call', toolName: 'Bash', toolInput: { command: 'git -C /repo commit -am x' } }, 2),
      step({ kind: 'tool_result', toolResult: '[main (root-commit) abcdef1234567890abcdef1234567890abcdef12] x' }, 3),
      step({ kind: 'tool_call', toolName: 'Bash', toolInput: { command: 'git commit -m y' } }, 4),
      step({ kind: 'tool_call', toolName: 'Bash', toolInput: { command: 'echo' } }, 5),
      step({ kind: 'tool_result', toolResult: '[main 9999999] y' }, 6),
    ];
    expect(extractSessionCommits(steps)).toEqual([
      { stepIndex: 2, messageId: 'm2', branch: 'main', sha: 'abcdef1234567890abcdef1234567890abcdef12', subject: 'x' },
    ]);
  });

  it('falls back to a git log --oneline line after a quiet commit, taking the branch from --show-current when present', () => {
    const steps: Step[] = [
      step({ kind: 'tool_call', toolName: 'Bash', toolInput: { command: "git branch --show-current && git status --short && git add a && git commit -q -F - <<'EOF'\nfeat: x\nEOF\ngit log --oneline -1" }, toolUseId: 'u' }, 0),
      step({ kind: 'tool_result', toolUseId: 'u', toolResult: 'demo/project-deletion\n M a\n9987455 feat: x\n       0' }, 1),
      step({ kind: 'tool_call', toolName: 'Bash', toolInput: { command: 'git commit -q -m y && git log --oneline -1' }, toolUseId: 'v' }, 2),
      step({ kind: 'tool_result', toolUseId: 'v', toolResult: 'abc1234 y' }, 3),
    ];
    expect(extractSessionCommits(steps)).toEqual([
      { stepIndex: 0, messageId: 'm0', branch: 'demo/project-deletion', sha: '9987455', subject: 'feat: x' },
      { stepIndex: 2, messageId: 'm2', branch: undefined, sha: 'abc1234', subject: 'y' },
    ]);
  });

  it('returns nothing when the commit failed (no summary line)', () => {
    const steps: Step[] = [
      step({ kind: 'tool_call', toolName: 'Bash', toolInput: { command: 'git commit -m z' }, toolUseId: 'u' }, 0),
      step({ kind: 'tool_result', toolUseId: 'u', toolResult: 'nothing to commit, working tree clean' }, 1),
    ];
    expect(extractSessionCommits(steps)).toEqual([]);
  });
});

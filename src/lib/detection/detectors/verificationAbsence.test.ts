import { describe, expect, it } from 'vitest';
import type { StoredMessage } from '../../../types/unified';
import { normalizeSession } from '../normalize';
import {
  DEFAULT_VERIFICATION_ABSENCE_CONFIG,
  verificationAbsenceDetector,
} from './verificationAbsence';

let seq = 0;

function msg(partial: Partial<StoredMessage> & Pick<StoredMessage, 'sender' | 'text'>): StoredMessage {
  seq++;
  return {
    id: `m${seq}`,
    conversationId: 'c1',
    createdAt: new Date(1751364000000 + seq * 1000),
    ...partial,
  };
}

const userMsg = (text: string) => msg({ sender: 'user', text });
const agentText = (text: string) => msg({ sender: 'assistant', text });
const toolCall = (name: string, input: Record<string, unknown>) =>
  msg({
    sender: 'tool',
    text: `[Tool: ${name}]`,
    contentBlocks: [{ type: 'tool_use', toolName: name, toolInput: input }],
  });
const edit = (file_path = '/app/src/a.ts') =>
  toolCall('Edit', { file_path, old_string: 'x', new_string: 'y' });
const bash = (command: string) => toolCall('Bash', { command });

function run(messages: StoredMessage[], overrides?: Record<string, unknown>) {
  const session = normalizeSession('c1', messages);
  return verificationAbsenceDetector.run(session, {
    ...DEFAULT_VERIFICATION_ABSENCE_CONFIG,
    ...overrides,
  });
}

describe('verification-absence — span scanning', () => {
  it('no finding when a verification-shaped call follows in the span', () => {
    expect(run([edit(), bash('npm run typecheck')])).toEqual([]);
  });

  it('flags an unverified edit ended by topic shift', () => {
    const findings = run([
      edit(), // 0
      agentText('Done, I have updated it.'), // 1
      userMsg('now something else'), // 2
      bash('npm test'), // 3 — verification AFTER the boundary must not count
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('medium');
    expect(findings[0].stepRange).toEqual({ start: 0, end: 1 });
    const evidence = findings[0].evidence as { spanEndReason: string };
    expect(evidence.spanEndReason).toBe('topic_shift');
  });

  it('flags an unverified edit at session end', () => {
    const findings = run([edit(), agentText('All done here.')]);
    expect(findings).toHaveLength(1);
    const evidence = findings[0].evidence as { spanEndReason: string };
    expect(evidence.spanEndReason).toBe('session_end');
  });

  it('ends the span at an explicit task transition in agent text', () => {
    const findings = run([
      edit(), // 0
      agentText("Now let's build the dashboard."), // 1 — transition
      bash('npm test'), // 2 — after the transition, must not verify step 0
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].stepRange).toEqual({ start: 0, end: 1 });
    const evidence = findings[0].evidence as { spanEndReason: string };
    expect(evidence.spanEndReason).toBe('task_transition');
  });

  it('emits one finding per unverified state-changing action', () => {
    const findings = run([edit('/app/a.ts'), edit('/app/b.ts')]);
    expect(findings).toHaveLength(2);
    expect(findings.map((f) => f.stepRange.start)).toEqual([0, 1]);
  });
});

describe('verification-absence — read-backs', () => {
  it('a read-back of the edited file counts as verification', () => {
    expect(
      run([edit('/app/src/a.ts'), toolCall('Read', { file_path: '/app/src/a.ts' })])
    ).toEqual([]);
  });

  it('normalizes paths when matching read-backs', () => {
    expect(
      run([edit('/app/src/a.ts'), toolCall('Read', { file_path: '/app//src/./a.ts' })])
    ).toEqual([]);
  });

  it('reading a different file does not verify', () => {
    const findings = run([
      edit('/app/src/a.ts'),
      toolCall('Read', { file_path: '/app/src/b.ts' }),
    ]);
    expect(findings).toHaveLength(1);
  });
});

describe('verification-absence — success-assertion escalation', () => {
  it('escalates to high when success is asserted and never verified', () => {
    const findings = run([edit(), agentText('That fixes the bug.')]);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('high');
    const evidence = findings[0].evidence as {
      successAssertion: { detected: boolean; stepIndex: number; excerpt: string };
    };
    expect(evidence.successAssertion.detected).toBe(true);
    expect(evidence.successAssertion.stepIndex).toBe(1);
    expect(evidence.successAssertion.excerpt).toContain('fixes the bug');
  });

  it('plain completion language is not a success assertion', () => {
    const findings = run([edit(), agentText('Done, I have updated the timeout.')]);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('medium');
  });

  it('an assertion followed by verification produces no finding at all', () => {
    expect(
      run([edit(), agentText('The tests should pass now.'), bash('npm test')])
    ).toEqual([]);
  });
});

describe('verification-absence — finding contract', () => {
  it('evidence classifies every tool call in the span', () => {
    const findings = run([
      edit('/app/a.ts'), // 0 state_changing
      toolCall('Grep', { pattern: 'foo' }), // 1 neutral
      agentText('ok'), // 2
    ]);
    const evidence = findings[0].evidence as {
      toolCallClassifications: { stepIndex: number; toolClass: string }[];
    };
    expect(evidence.toolCallClassifications).toEqual([
      { stepIndex: 0, toolName: 'Edit', toolClass: 'state_changing' },
      { stepIndex: 1, toolName: 'Grep', toolClass: 'neutral' },
    ]);
  });

  it('records the verification-within-span evaluation', () => {
    const findings = run([edit()]);
    expect(findings[0].suppressionsEvaluated).toEqual([
      {
        rule: 'verification-within-span',
        fired: false,
        detail: expect.stringContaining('no verification-shaped call'),
      },
    ]);
  });
});

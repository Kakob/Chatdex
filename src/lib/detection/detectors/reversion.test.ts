import { describe, expect, it } from 'vitest';
import type { StoredMessage } from '../../../types/unified';
import { normalizeSession } from '../normalize';
import { DEFAULT_LOOP_CONFIG, loopDetector } from './loop';
import { DEFAULT_REVERSION_CONFIG, reversionDetector } from './reversion';

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

const agentText = (text: string) => msg({ sender: 'assistant', text });
const toolCall = (name: string, input: Record<string, unknown>) =>
  msg({
    sender: 'tool',
    text: `[Tool: ${name}]`,
    contentBlocks: [{ type: 'tool_use', toolName: name, toolInput: input }],
  });
const edit = (old_string: string, new_string: string, file_path = '/app/a.ts') =>
  toolCall('Edit', { file_path, old_string, new_string });
const write = (content: string, file_path = '/app/a.ts') =>
  toolCall('Write', { file_path, content });

function run(messages: StoredMessage[], overrides?: Record<string, unknown>) {
  const session = normalizeSession('c1', messages);
  return reversionDetector.run(session, {
    ...DEFAULT_REVERSION_CONFIG,
    ...overrides,
  });
}

describe('reversion detector — inverse-hunk matching', () => {
  it('flags a later edit that exactly inverts an earlier one', () => {
    const findings = run([edit('a', 'b'), edit('b', 'a')]);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('medium');
    expect(findings[0].stepRange).toEqual({ start: 0, end: 1 });
    const evidence = findings[0].evidence as {
      filePath: string;
      restoredRegion: { before: string; after: string };
    };
    expect(evidence.filePath).toBe('/app/a.ts');
    expect(evidence.restoredRegion).toEqual({ before: 'a', after: 'b' });
  });

  it('matches after whitespace normalization', () => {
    const findings = run([
      edit('const x = 1', 'const  x =  2'),
      edit('const x  = 2', ' const x = 1 '),
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not flag ordinary forward progress', () => {
    expect(run([edit('a', 'b'), edit('b', 'c'), edit('c', 'd')])).toEqual([]);
  });

  it('does not pair edits across different files', () => {
    expect(
      run([edit('a', 'b', '/app/a.ts'), edit('b', 'a', '/app/b.ts')])
    ).toEqual([]);
  });

  it('flags a Write that restores a pre-edit state', () => {
    const findings = run([edit('a', 'b'), write('a')]);
    expect(findings).toHaveLength(1);
  });

  it('pairs the reverting edit with the nearest earlier match', () => {
    const findings = run([
      edit('a', 'b'), // 0
      edit('b', 'a'), // 1 reverts 0
      edit('a', 'b'), // 2 reverts 1
    ]);
    expect(findings).toHaveLength(2);
    expect(findings[0].stepRange).toEqual({ start: 0, end: 1 });
    expect(findings[1].stepRange).toEqual({ start: 1, end: 2 });
  });
});

describe('reversion detector — acknowledgment downgrade', () => {
  it('downgrades to info when the agent acknowledges before the edit', () => {
    const findings = run([
      edit('a', 'b'),
      agentText('That broke things — reverting to the original.'),
      edit('b', 'a'),
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('info');
    const outcome = findings[0].suppressionsEvaluated.find(
      (s) => s.rule === 'acknowledgment-language'
    );
    expect(outcome?.fired).toBe(true);
    expect(outcome?.detail).toContain('reverting');
  });

  it('detects acknowledgment shortly after the edit too', () => {
    const findings = run([
      edit('a', 'b'),
      edit('b', 'a'),
      agentText('I rolled back the change since it broke the tests.'),
    ]);
    expect(findings[0].severity).toBe('info');
  });

  it('ignores acknowledgment outside the configured window', () => {
    const findings = run(
      [
        edit('a', 'b'), // 0
        agentText('reverting this'), // 1
        agentText('filler'), // 2
        agentText('filler'), // 3
        agentText('filler'), // 4
        edit('b', 'a'), // 5
      ],
      { acknowledgmentLookbehind: 2 }
    );
    expect(findings[0].severity).toBe('medium');
  });

  it('neutral adjustment language is not an acknowledgment', () => {
    const findings = run([
      edit('a', 'b'),
      agentText('Let me adjust the implementation.'),
      edit('b', 'a'),
    ]);
    expect(findings[0].severity).toBe('medium');
  });
});

describe('reversion detector — loop cross-reference', () => {
  it('records cycle steps and coexists with a loop sequence finding on edit→revert thrash', () => {
    const messages = [
      edit('a', 'b'), // 0
      edit('b', 'a'), // 1
      edit('a', 'b'), // 2
      edit('b', 'a'), // 3
    ];
    const session = normalizeSession('c1', messages);

    const reversions = reversionDetector.run(session, DEFAULT_REVERSION_CONFIG);
    expect(reversions.length).toBeGreaterThanOrEqual(2);
    for (const finding of reversions) {
      const evidence = finding.evidence as {
        crossReference: { editRevertCycle: boolean; cycleSteps: number[] };
      };
      expect(evidence.crossReference.editRevertCycle).toBe(true);
      expect(evidence.crossReference.cycleSteps.length).toBeGreaterThanOrEqual(3);
    }

    // The same thrash is loop-shaped: the [edit, revert] signature pair
    // repeats consecutively, and in-loop state changes don't self-suppress.
    const loops = loopDetector.run(session, DEFAULT_LOOP_CONFIG);
    expect(loops).toHaveLength(1);
    const loopEvidence = loops[0].evidence as { kind: string };
    expect(loopEvidence.kind).toBe('sequence_repeat');
  });

  it('a single revert with no further thrash has no cycle', () => {
    const findings = run([edit('a', 'b'), edit('b', 'a')]);
    const evidence = findings[0].evidence as {
      crossReference: { editRevertCycle: boolean; cycleSteps: number[] };
    };
    expect(evidence.crossReference).toEqual({ editRevertCycle: false, cycleSteps: [] });
  });
});

import { describe, expect, it } from 'vitest';
import type { StoredMessage } from '../../../types/unified';
import { normalizeSession } from '../normalize';
import { DEFAULT_LOOP_CONFIG, loopDetector } from './loop';

let seq = 0;

function toolCall(name: string, input: Record<string, unknown>): StoredMessage {
  seq++;
  return {
    id: `m${seq}`,
    conversationId: 'c1',
    sender: 'tool',
    text: `[Tool: ${name}]`,
    contentBlocks: [{ type: 'tool_use', toolName: name, toolInput: input }],
    createdAt: new Date(1751364000000 + seq * 1000),
  };
}

function agentText(text: string): StoredMessage {
  seq++;
  return {
    id: `m${seq}`,
    conversationId: 'c1',
    sender: 'assistant',
    text,
    createdAt: new Date(1751364000000 + seq * 1000),
  };
}

function run(messages: StoredMessage[], overrides?: Record<string, unknown>) {
  const session = normalizeSession('c1', messages);
  return loopDetector.run(session, { ...DEFAULT_LOOP_CONFIG, ...overrides });
}

const bash = (command: string) => toolCall('Bash', { command });

describe('loop detector — window boundaries', () => {
  it('does not fire when no M-step window contains N occurrences', () => {
    // Occurrences at steps 0, 9, 18: every consecutive gap fits in the
    // window, but no single 10-step window holds all three.
    const messages: StoredMessage[] = [];
    for (let i = 0; i < 19; i++) {
      messages.push(
        i % 9 === 0 ? bash('flaky-command') : agentText(`filler ${i}`)
      );
    }
    expect(run(messages)).toEqual([]);
  });

  it('fires at exactly N occurrences inside one window', () => {
    const findings = run([
      bash('flaky-command'), // step 0
      agentText('retrying'), // step 1
      bash('flaky-command'), // step 2
      agentText('retrying'), // step 3
      bash('flaky-command'), // step 4
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].stepRange).toEqual({ start: 0, end: 4 });
    expect(findings[0].severity).toBe('medium');
  });

  it('respects a custom repeatThreshold', () => {
    const messages = [
      bash('flaky-command'),
      agentText('again'),
      bash('flaky-command'),
    ];
    expect(run(messages)).toEqual([]);
    expect(run(messages, { repeatThreshold: 2 })).toHaveLength(1);
  });
});

describe('loop detector — retry whitelist suppression', () => {
  it('suppresses a custom whitelisted command', () => {
    const messages = [
      bash('my-poller check'),
      bash('my-poller check'),
      bash('my-poller check'),
    ];
    expect(run(messages)).toHaveLength(1);
    expect(run(messages, { retryWhitelist: ['my-poller'] })).toEqual([]);
  });

  it('does NOT suppress a sequence when only one of its signatures is retry-shaped', () => {
    const pair = [bash('sleep 5'), bash('npm run build')];
    const findings = run([...pair, ...pair, ...pair]);
    expect(findings).toHaveLength(1);
    const whitelistOutcome = findings[0].suppressionsEvaluated.find(
      (s) => s.rule === 'retry-whitelist'
    );
    expect(whitelistOutcome?.fired).toBe(false);
  });
});

describe('loop detector — state-change suppression', () => {
  it('records a fired suppression with the trimming step when repeats resume after an edit', () => {
    const findings = run([
      bash('npm run check'), // 0
      bash('npm run check'), // 1
      bash('npm run check'), // 2
      toolCall('Edit', { file_path: '/a.ts', old_string: 'x', new_string: 'y' }), // 3
      bash('npm run check'), // 4
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].stepRange).toEqual({ start: 0, end: 2 });
    const outcome = findings[0].suppressionsEvaluated.find(
      (s) => s.rule === 'intervening-state-change'
    );
    expect(outcome?.fired).toBe(true);
    expect(outcome?.detail).toContain('step 3');
  });

  it('does not let the loop\'s own state-changing signature suppress it (edit-loop case)', () => {
    // The same failing Edit retried identically — SPEC §2.3 wants
    // edit/revert cycles to remain loop candidates.
    const edit = () =>
      toolCall('Edit', { file_path: '/a.ts', old_string: 'x', new_string: 'y' });
    const findings = run([edit(), edit(), edit()]);
    expect(findings).toHaveLength(1);
    const outcome = findings[0].suppressionsEvaluated.find(
      (s) => s.rule === 'intervening-state-change'
    );
    expect(outcome?.fired).toBe(false);
  });
});

describe('loop detector — sequence repeats', () => {
  it('dedupes: an exact repeat inside a sequence repeat yields one finding', () => {
    // A appears 3x within the window AND [A,B] repeats 3x — report the
    // sequence once, not an extra exact-repeat finding.
    const pair = [bash('cmd-a'), bash('cmd-b')];
    const findings = run([...pair, ...pair, ...pair]);
    expect(findings).toHaveLength(1);
    const evidence = findings[0].evidence as { kind: string; repeatCount: number };
    expect(evidence.kind).toBe('sequence_repeat');
    expect(evidence.repeatCount).toBe(3);
  });

  it('requires at least two distinct signatures in a sequence unit', () => {
    // [A,A] repeating is exact-repeat territory; ensure the sequence pass
    // leaves it to the exact detector rather than double-reporting.
    const findings = run([
      bash('cmd-a'),
      bash('cmd-a'),
      bash('cmd-a'),
      bash('cmd-a'),
    ]);
    expect(findings).toHaveLength(1);
    const evidence = findings[0].evidence as { kind: string };
    expect(evidence.kind).toBe('exact_repeat');
  });

  it('does not fire on a sequence that occurs only once', () => {
    expect(
      run([bash('cmd-a'), bash('cmd-b'), bash('cmd-c'), bash('cmd-d')])
    ).toEqual([]);
  });
});

describe('loop detector — finding contract', () => {
  it('populates both suppression evaluations on every finding', () => {
    const findings = run([
      bash('flaky-command'),
      bash('flaky-command'),
      bash('flaky-command'),
    ]);
    const rules = findings[0].suppressionsEvaluated.map((s) => s.rule).sort();
    expect(rules).toEqual(['intervening-state-change', 'retry-whitelist']);
  });

  it('evidence alone explains the finding: signatures, occurrences, thresholds', () => {
    const findings = run([
      bash('flaky-command'),
      agentText('hm'),
      bash('flaky-command'),
      agentText('hm'),
      bash('flaky-command'),
    ]);
    const evidence = findings[0].evidence as {
      signatures: string[];
      occurrenceSteps: number[];
      repeatCount: number;
      thresholds: { repeatThreshold: number; windowSize: number };
    };
    expect(evidence.signatures).toHaveLength(1);
    expect(evidence.occurrenceSteps).toEqual([0, 2, 4]);
    expect(evidence.repeatCount).toBe(3);
    expect(evidence.thresholds).toMatchObject({ repeatThreshold: 3, windowSize: 10 });
  });
});

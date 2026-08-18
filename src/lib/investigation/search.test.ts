import { describe, it, expect } from 'vitest';
import { searchStepTexts, stepDisplayText } from './search';
import type { Step } from '../detection/normalize';

describe('stepDisplayText — the renderer/search contract', () => {
  it('returns prose verbatim for user and agent steps', () => {
    const step: Step = { index: 0, kind: 'user_msg', messageId: 'm', text: 'Hello  world\n' };
    expect(stepDisplayText(step)).toBe('Hello  world\n');
  });

  it('returns pretty-printed input JSON for tool calls', () => {
    const step: Step = {
      index: 1,
      kind: 'tool_call',
      messageId: 'm',
      toolName: 'Edit',
      toolInput: { file_path: '/a.ts', old_string: 'x' },
    };
    expect(stepDisplayText(step)).toBe(
      JSON.stringify({ file_path: '/a.ts', old_string: 'x' }, null, 2)
    );
  });

  it('returns tool results verbatim', () => {
    const step: Step = {
      index: 2,
      kind: 'tool_result',
      messageId: 'm',
      toolResult: 'exit code 0',
    };
    expect(stepDisplayText(step)).toBe('exit code 0');
  });
});

describe('searchStepTexts — literal, case-insensitive, exact offsets (SPEC §8.6)', () => {
  const texts = ['The quick brown fox', 'QUICK fixes, quick wins', 'nothing here'];

  it('finds all occurrences across steps in document order', () => {
    expect(searchStepTexts(texts, 'quick')).toEqual([
      { stepIndex: 0, start: 4, end: 9 },
      { stepIndex: 1, start: 0, end: 5 },
      { stepIndex: 1, start: 13, end: 18 },
    ]);
  });

  it('offsets identify the exact matched characters', () => {
    const [m] = searchStepTexts(texts, 'brown F');
    expect(texts[m.stepIndex].slice(m.start, m.end)).toBe('brown f');
  });

  it('treats regex metacharacters as literal text', () => {
    expect(searchStepTexts(['a.c abc'], 'a.c')).toEqual([
      { stepIndex: 0, start: 0, end: 3 },
    ]);
    expect(searchStepTexts(['costs $12 (approx)'], '$12 (approx)')).toHaveLength(1);
  });

  it('matches nothing for empty or whitespace-only queries', () => {
    expect(searchStepTexts(texts, '')).toEqual([]);
    expect(searchStepTexts(texts, '   ')).toEqual([]);
  });

  it('handles adjacent non-overlapping repeats', () => {
    expect(searchStepTexts(['aaaa'], 'aa')).toEqual([
      { stepIndex: 0, start: 0, end: 2 },
      { stepIndex: 0, start: 2, end: 4 },
    ]);
  });

  it('finds matches inside non-ASCII text at correct UTF-16 offsets', () => {
    const text = '🎉 café déjà café';
    const matches = searchStepTexts([text], 'café');
    expect(matches).toHaveLength(2);
    for (const m of matches) {
      expect(text.slice(m.start, m.end)).toBe('café');
    }
  });
});

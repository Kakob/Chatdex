import { describe, it, expect } from 'vitest';
import { scoreIntentReply, filterPairs, INTENT_PATTERNS } from './heuristic';
import type { IntentPair } from './pairs';

function pair(replyText: string, overrides: Partial<IntentPair> = {}): IntentPair {
  return {
    conversationId: 'conv-1',
    promptI: 1,
    replyI: 2,
    promptText: 'Should I do it this way?',
    replyText,
    promptedByQuestion: true,
    ...overrides,
  };
}

// Hand-labelled casual intent statements, the way Jacob actually types them.
const POSITIVE = [
  'I want the badge on the sidebar',
  'no, don’t do that',
  'nah keep it simple',
  'yes but make it amber',
  'we should never auto-accept anything',
  "I'd rather it only shows when there's something pending",
  'not that one, the other layout',
  'exactly, and keep the count',
  'I need it to work offline',
  'it must not send anything before I confirm',
  'instead of a modal just use a banner',
  "let's go with option B",
  'please remove the map view',
  'I really want both origins recorded',
  'stop asking, just do the sidebar thing',
  'the default should be lenient',
  'add a filter for polarity',
  'drop the tooltip, it gets in the way',
  'I hate the popup',
  'use github not the local disk',
  'skip the spec leg when there is nothing',
  'only trace intents I have accepted',
  'make sure the token never leaves the browser',
  'we do not want codex parsing',
  'I expect a badge count, not a dot',
  'fine, amber it is',
];

// Replies that carry no requirement (meta-conversation, pasted, small talk).
const NEGATIVE_LONG = [
  'thanks that all makes sense to me now and it is clear and there is nothing more to say about it really so moving on to unrelated matters entirely, how has the weather been over there lately, because here it has been raining continuously for almost three weeks now without a single dry day and everyone is getting tired of it honestly and the forecast says more rain, which nobody is looking forward to at all, so that is the situation on this end at the moment and that is all there is to report from here tonight ok bye',
];

describe('INTENT_PATTERNS', () => {
  it('are all linear (no nested quantifiers or backreferences)', () => {
    for (const { pattern } of INTENT_PATTERNS) {
      const src = pattern.source;
      expect(src).not.toMatch(/\)[*+]\s*[*+]/);
      expect(src).not.toMatch(/\\\d/);
      expect(src).not.toMatch(/\([^)]*[*+]\)[*+]/);
    }
  });
});

describe('scoreIntentReply — lenient (default)', () => {
  it('keeps at least 95% of hand-labelled casual intents by pattern alone', () => {
    // promptedByQuestion=false so the short-answer rule cannot help.
    const kept = POSITIVE.filter((t) => scoreIntentReply(pair(t, { promptedByQuestion: false })).keep);
    expect(kept.length / POSITIVE.length).toBeGreaterThanOrEqual(0.95);
  });

  it('keeps a short answer to a question even without a pattern match', () => {
    const r = scoreIntentReply(pair('amber', { promptedByQuestion: true }));
    expect(r.keep).toBe(true);
    expect(r.matched).toContain('short-answer');
  });

  it('drops a long pattern-free reply', () => {
    for (const t of NEGATIVE_LONG) {
      expect(scoreIntentReply(pair(t, { promptedByQuestion: false })).keep).toBe(false);
    }
  });

  it('reports which patterns matched', () => {
    const r = scoreIntentReply(pair('no, I want the sidebar badge', { promptedByQuestion: false }));
    expect(r.matched).toEqual(expect.arrayContaining(['desire', 'reaction', 'product']));
  });

  it('honours extraPatterns', () => {
    const r = scoreIntentReply(pair('zorblat it', { promptedByQuestion: false }), {
      extraPatterns: [/zorblat/i],
    });
    expect(r.keep).toBe(true);
    expect(r.matched[0]).toMatch(/^extra:/);
  });
});

describe('scoreIntentReply — strict and off', () => {
  it('strict drops a short answer with no pattern match', () => {
    expect(scoreIntentReply(pair('amber'), { mode: 'strict' }).keep).toBe(false);
    expect(scoreIntentReply(pair('I want amber'), { mode: 'strict' }).keep).toBe(true);
  });

  it('off keeps everything', () => {
    const all = [...POSITIVE, ...NEGATIVE_LONG, 'k', ''].map((t) => pair(t, { promptedByQuestion: false }));
    expect(filterPairs(all, { mode: 'off' })).toHaveLength(all.length);
  });
});

describe('filterPairs', () => {
  it('filters with the given config', () => {
    const pairs = [pair('I want X', { promptedByQuestion: false }), pair(NEGATIVE_LONG[0], { promptedByQuestion: false })];
    expect(filterPairs(pairs)).toHaveLength(1);
  });
});

describe('ReDoS resistance (audit S8)', () => {
  it('scores adversarial 10 KB inputs quickly', () => {
    const inputs = [
      'I '.repeat(5000),
      'should'.repeat(1700),
      `${'no '.repeat(3000)}!`,
      'a'.repeat(10_000),
      'don\'t '.repeat(1700),
    ];
    const start = performance.now();
    for (const text of inputs) {
      for (let i = 0; i < 20; i++) scoreIntentReply(pair(text, { promptedByQuestion: false }));
    }
    expect(performance.now() - start).toBeLessThan(500);
  });
});

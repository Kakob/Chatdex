// Recall-oriented pre-filter for intent extraction (SPEC-intent-trace §7.2).
//
// Cuts LLM volume by dropping user replies that cannot plausibly state an
// intent. The user's phrasing is casual ("nah, keep it simple"), so the
// defaults err toward keeping: in 'lenient' mode a short answer to an
// assistant question is kept even with no pattern match, and 'off' sends
// everything. Patterns are deliberately linear (no nested quantifiers) and
// inputs are pre-capped by pair selection — audit S8.

import type { IntentPair } from './pairs';

export type HeuristicMode = 'off' | 'lenient' | 'strict';

export interface HeuristicConfig {
  /** Default 'lenient'. */
  mode?: HeuristicMode;
  /** Additional patterns; a match keeps the pair. */
  extraPatterns?: RegExp[];
  /** In 'lenient' mode, a reply this short that answers a question is kept regardless. Default 400. */
  shortReplyChars?: number;
}

export const DEFAULT_SHORT_REPLY_CHARS = 400;

export interface IntentPattern {
  name: string;
  pattern: RegExp;
}

/**
 * Documented default patterns. Each is a single linear scan; none uses
 * nested quantifiers or backreferences.
 */
export const INTENT_PATTERNS: readonly IntentPattern[] = [
  {
    // "I want", "we'd like", "I don't need", "I really expect", "I mean"
    name: 'desire',
    pattern:
      /\b(?:i|we)(?:'d|'ll|'m| would| do| don't| do not| really| just| also| still| definitely| actually)?\s+(?:want|need|like|prefer|expect|mean|intend|wish|hate|love)\b/i,
  },
  {
    // "should", "shouldn't", "must", "never", "always", "instead", "rather", "only"
    name: 'modal',
    pattern: /\b(?:should(?:n't| not)?|must(?:n't| not)?|never|always|instead|rather|only)\b/i,
  },
  {
    // Leading reaction to a proposal: "no,", "nah", "yes", "not that", "exactly"
    name: 'reaction',
    pattern: /^\s*(?:no|nope|nah|yes|yeah|yep|yup|sure|ok(?:ay)?|not that|not quite|exactly|correct|right|wrong|agreed|fine)\b/i,
  },
  {
    // Directives: "don't", "stop", "avoid", "keep", "make sure", "let's", "please"
    name: 'directive',
    pattern: /\b(?:don't|do not|stop|avoid|keep|make sure|let's|please|remove|drop|add|use|go with|leave|skip)\b/i,
  },
  {
    // Product nouns the user talks about when describing behaviour.
    name: 'product',
    pattern:
      /\b(?:feature|behav\w*|user|button|page|tab|option|setting|default|badge|sidebar|modal|panel|flow|screen|field|filter|list|link|export|import)s?\b/i,
  },
];

export function scoreIntentReply(
  pair: IntentPair,
  config: HeuristicConfig = {}
): { keep: boolean; matched: string[] } {
  const mode = config.mode ?? 'lenient';
  if (mode === 'off') return { keep: true, matched: ['off'] };

  const matched: string[] = [];
  for (const { name, pattern } of INTENT_PATTERNS) {
    if (pattern.test(pair.replyText)) matched.push(name);
  }
  for (const extra of config.extraPatterns ?? []) {
    if (extra.test(pair.replyText)) matched.push(`extra:${extra.source}`);
  }

  if (mode === 'lenient') {
    const shortLimit = config.shortReplyChars ?? DEFAULT_SHORT_REPLY_CHARS;
    if (pair.promptedByQuestion && pair.replyText.length <= shortLimit) {
      matched.push('short-answer');
    }
  }

  return { keep: matched.length > 0, matched };
}

export function filterPairs(pairs: IntentPair[], config: HeuristicConfig = {}): IntentPair[] {
  return pairs.filter((pair) => scoreIntentReply(pair, config).keep);
}

// Literal in-source search (SPEC-decision-investigation §8.6 as amended).
// Case-insensitive exact-substring matching over the same text the reader
// renders — no fuzzy matching, no scoring, no query rewriting, no synonyms.
// The renderer and this module share stepDisplayText so a match is always
// highlightable at the exact characters that matched.

import type { Step } from '../detection/normalize';

export interface StepSearchMatch {
  stepIndex: number;
  /** UTF-16 code-unit offsets into stepDisplayText(step). */
  start: number;
  end: number;
}

/**
 * The literal body text of a step as the workbench renders it:
 * prose verbatim; tool calls as their pretty-printed input JSON; tool
 * results verbatim.
 */
export function stepDisplayText(step: Step): string {
  switch (step.kind) {
    case 'tool_call':
      return step.toolInput ? JSON.stringify(step.toolInput, null, 2) : '';
    case 'tool_result':
      return step.toolResult ?? '';
    default:
      return step.text ?? '';
  }
}

/**
 * All occurrences of `query` in each text, in document order. The query is
 * literal text — regex metacharacters have no meaning. Empty/whitespace-only
 * queries match nothing.
 */
export function searchStepTexts(texts: string[], query: string): StepSearchMatch[] {
  const needle = query.toLowerCase();
  if (needle.trim().length === 0) return [];

  const matches: StepSearchMatch[] = [];
  for (let stepIndex = 0; stepIndex < texts.length; stepIndex++) {
    const haystack = texts[stepIndex].toLowerCase();
    let from = 0;
    while (true) {
      const at = haystack.indexOf(needle, from);
      if (at === -1) break;
      matches.push({ stepIndex, start: at, end: at + needle.length });
      from = at + needle.length;
    }
  }
  return matches;
}

// Deterministic pair selection for intent extraction (SPEC-intent-trace §7.1).
//
// A "pair" is one user message (the reply) together with the nearest
// preceding assistant text (the prompt), skipping tool calls/results between
// them. Every user message yields a pair; when no assistant text directly
// precedes it — an opening message, or a second consecutive user message —
// the pair has `promptI: null`, which the extraction firewall turns into a
// forced 'unprompted' origin (§2.2). No LLM, no DB, no network: pure over the
// stored message list, reusing the detection layer's normalizeSession as a
// read-only substrate (§2.5).
//
// Indexes (`promptI`, `replyI`) are positions in the *full* StoredMessage list
// the caller passes in — the same `i` convention discovery digests use — so a
// cited index maps straight back to a StoredMessage id at persist time.

import { normalizeSession, type Step } from '../../detection/normalize';
import type { StoredMessage } from '../../../types';

export interface IntentPair {
  conversationId: string;
  /** Index of the nearest preceding assistant text; null ⇒ no AI message directly precedes. */
  promptI: number | null;
  /** Index of the user message (same `i` convention as discovery digests). */
  replyI: number;
  /** Tail of the assistant text (questions usually sit at the end), ≤ maxPromptChars. */
  promptText: string;
  /** Head of the user text, ≤ maxReplyChars. */
  replyText: string;
  /** Previous user message excerpt for context, ≤ maxContextChars. */
  priorUserText?: string;
  /** Deterministic hint: the assistant text ends with a question or an options list. */
  promptedByQuestion: boolean;
}

export interface PairSelectionConfig {
  /** Characters of assistant text kept (from the end). Default 600. */
  maxPromptChars?: number;
  /** Characters of user text kept (from the start). Default 800. */
  maxReplyChars?: number;
  /** Characters of the previous user message kept as context. Default 200. */
  maxContextChars?: number;
  /** Pairs kept per conversation (most recent win). Default 60. */
  maxPairsPerConversation?: number;
}

export const DEFAULT_MAX_PROMPT_CHARS = 600;
export const DEFAULT_MAX_REPLY_CHARS = 800;
export const DEFAULT_MAX_CONTEXT_CHARS = 200;
export const DEFAULT_MAX_PAIRS_PER_CONVERSATION = 60;

/** Replies longer than this with no first-person verb are treated as pasted material. */
export const PASTED_LENGTH_THRESHOLD = 4000;
/** Fraction of lines that must look machine-generated for a multi-line reply to be skipped. */
export const PASTED_LINE_FRACTION = 0.7;

// Lines typical of logs, stack traces, JSON, or code: leading whitespace,
// braces/brackets, "at " frames, tags, table pipes, prompts.
const MACHINE_LINE = /^(?:\s+\S|[{}[\]<>]|at |\$ |>|\|)/;
const FIRST_PERSON = /\b(?:i|i'm|i'd|i'll|we|we're|we'd|let's)\b/i;
// A trailing question, or an options list somewhere in the tail.
const ENDS_WITH_QUESTION = /\?\s*(?:\*+|_+|`+)?\s*$/;
const OPTIONS_LIST = /(?:^|\n)\s*(?:\d+[.)]|[-*•]|\(?[a-cA-C]\))\s+\S/;
const TAIL_QUESTION_WINDOW = 300;

/**
 * True when a user message reads as pasted logs/code rather than the user's
 * own words: mostly machine-shaped lines, or very long with no first-person
 * verb at all.
 */
export function looksPasted(text: string): boolean {
  const lines = text.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length >= 4) {
    const machine = lines.filter((l) => MACHINE_LINE.test(l)).length;
    if (machine / lines.length >= PASTED_LINE_FRACTION) return true;
  }
  return text.length > PASTED_LENGTH_THRESHOLD && !FIRST_PERSON.test(text);
}

/** Deterministic hint that the assistant was asking or offering choices. */
export function endsWithQuestionOrOptions(promptText: string): boolean {
  const trimmed = promptText.trimEnd();
  if (ENDS_WITH_QUESTION.test(trimmed)) return true;
  const tail = trimmed.slice(-TAIL_QUESTION_WINDOW);
  return tail.includes('?') || OPTIONS_LIST.test(tail);
}

export function selectIntentPairs(
  conversationId: string,
  messages: StoredMessage[],
  config: PairSelectionConfig = {}
): IntentPair[] {
  const maxPromptChars = config.maxPromptChars ?? DEFAULT_MAX_PROMPT_CHARS;
  const maxReplyChars = config.maxReplyChars ?? DEFAULT_MAX_REPLY_CHARS;
  const maxContextChars = config.maxContextChars ?? DEFAULT_MAX_CONTEXT_CHARS;
  const maxPairs = config.maxPairsPerConversation ?? DEFAULT_MAX_PAIRS_PER_CONVERSATION;

  const indexById = new Map<string, number>();
  messages.forEach((m, i) => indexById.set(m.id, i));

  const { steps } = normalizeSession(conversationId, messages);

  // Group the text of each user message: a message may expand to several
  // user_msg steps (text around embedded blocks); we want one pair per message.
  const userMessages: Array<{ messageId: string; firstStep: number; text: string }> = [];
  for (const step of steps) {
    if (step.kind !== 'user_msg') continue;
    const last = userMessages[userMessages.length - 1];
    if (last && last.messageId === step.messageId) {
      last.text = `${last.text}\n${step.text ?? ''}`.trim();
    } else {
      userMessages.push({ messageId: step.messageId, firstStep: step.index, text: (step.text ?? '').trim() });
    }
  }

  const pairs: IntentPair[] = [];
  let priorUserText: string | undefined;

  for (const user of userMessages) {
    const replyI = indexById.get(user.messageId);
    if (replyI === undefined || !user.text) continue;

    const prompt = findPrecedingAssistantText(steps, user.firstStep);
    const promptI = prompt ? (indexById.get(prompt.messageId) ?? null) : null;
    const promptText = prompt ? tail(prompt.text, maxPromptChars) : '';

    const pasted = looksPasted(user.text);
    if (!pasted) {
      pairs.push({
        conversationId,
        promptI,
        replyI,
        promptText,
        replyText: head(user.text, maxReplyChars),
        ...(priorUserText ? { priorUserText: head(priorUserText, maxContextChars) } : {}),
        promptedByQuestion: prompt ? endsWithQuestionOrOptions(prompt.text) : false,
      });
    }
    // Pasted material still counts as "the previous thing the user said" only
    // when it was their own words; otherwise keep the earlier context.
    if (!pasted) priorUserText = user.text;
  }

  return pairs.length > maxPairs ? pairs.slice(pairs.length - maxPairs) : pairs;
}

/**
 * Walk backward from a user step over tool calls/results to the nearest
 * agent_text step, then gather every agent_text step of that same assistant
 * message (Claude Code splits one message's text around its tool blocks).
 * Stops with null at another user's message or the start of the session.
 */
function findPrecedingAssistantText(
  steps: Step[],
  fromStep: number
): { messageId: string; text: string } | null {
  let k = fromStep - 1;
  while (k >= 0) {
    const step = steps[k];
    if (step.kind === 'agent_text') break;
    if (step.kind === 'user_msg') return null;
    k--; // tool_call / tool_result: skip
  }
  if (k < 0) return null;
  const messageId = steps[k].messageId;
  const parts: string[] = [];
  for (let j = 0; j < steps.length && j < fromStep; j++) {
    const step = steps[j];
    if (step.messageId === messageId && step.kind === 'agent_text' && step.text) {
      parts.push(step.text);
    }
  }
  return { messageId, text: parts.join('\n').trim() };
}

function head(text: string, max: number): string {
  const normalized = text.replace(/[ \t]+/g, ' ').trim();
  return normalized.length <= max ? normalized : normalized.slice(0, max);
}

function tail(text: string, max: number): string {
  const normalized = text.replace(/[ \t]+/g, ' ').trim();
  return normalized.length <= max ? normalized : normalized.slice(normalized.length - max);
}

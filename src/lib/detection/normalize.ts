// Step normalization (IMPLEMENTATION_PLAN Phase 1).
// Converts a stored session (StoredMessage[]) into the NormalizedSession the
// detectors consume: an ordered step stream plus per-file edit timelines.
//
// Step indexing: flat-entry traces (one JSONL entry per tool call/result)
// normalize 1:1 — step index equals the entry's position among non-system
// entries, which is the convention golden-trace expectations rely on
// (IMPLEMENTATION_PLAN decisions log #4). Messages carrying embedded
// tool_use/tool_result content blocks expand to one step per block.

import type { StoredMessage } from '../../types/unified';
import { classifyToolCall, isKnownTool, type ToolCallClass } from './classify';
import { normalizePath, signatureFor } from './signatures';

export type StepKind = 'user_msg' | 'agent_text' | 'tool_call' | 'tool_result';

export interface EditHunk {
  filePath: string;
  /** Absent for whole-file writes. */
  oldString?: string;
  newString: string;
}

export interface Step {
  index: number;
  kind: StepKind;
  /** Backing message, for UI anchoring. */
  messageId: string;
  text?: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolResult?: string;
  /** Present on tool_call steps only. */
  signature?: string;
  toolClass?: ToolCallClass;
  /** Present on tool_call steps that edit files. */
  editHunks?: EditHunk[];
}

export interface TimelineEdit {
  stepIndex: number;
  hunk: EditHunk;
}

export interface NormalizedSession {
  sessionId: string;
  steps: Step[];
  /** Keyed by normalized file path, edits in step order. */
  editTimelines: Map<string, TimelineEdit[]>;
  /**
   * Tool-call names outside the curated classifier mapping (counted so
   * mapping gaps stay visible — such calls classify neutral, which can hide
   * state changes or verifications from the detectors).
   */
  unknownToolCounts: Record<string, number>;
}

export function normalizeSession(
  sessionId: string,
  messages: StoredMessage[]
): NormalizedSession {
  const steps: Step[] = [];
  const unknownToolCounts: Record<string, number> = {};

  for (const message of messages) {
    if (message.sender === 'system') continue;
    for (const partial of expandMessage(message)) {
      const step = finalizeStep(partial, steps.length, message.id);
      steps.push(step);
      if (step.kind === 'tool_call' && step.toolName && !isKnownTool(step.toolName)) {
        unknownToolCounts[step.toolName] = (unknownToolCounts[step.toolName] ?? 0) + 1;
      }
    }
  }

  return {
    sessionId,
    steps,
    editTimelines: buildEditTimelines(steps),
    unknownToolCounts,
  };
}

type PartialStep = Omit<Step, 'index' | 'messageId' | 'signature' | 'toolClass' | 'editHunks'>;

function expandMessage(message: StoredMessage): PartialStep[] {
  const textKind: StepKind = message.sender === 'user' ? 'user_msg' : 'agent_text';
  const blocks = message.contentBlocks;

  if (!blocks || blocks.length === 0) {
    return [fallbackStep(message, textKind)];
  }

  const parts: PartialStep[] = [];
  let textBuffer: string[] = [];

  const flushText = () => {
    const text = textBuffer.join('\n').trim();
    textBuffer = [];
    if (text) parts.push({ kind: textKind, text });
  };

  for (const block of blocks) {
    if (block.type === 'tool_use') {
      flushText();
      parts.push({
        kind: 'tool_call',
        toolName: block.toolName ?? message.toolName ?? 'unknown',
        toolInput: block.toolInput ?? parseToolInput(message.toolInput),
      });
    } else if (block.type === 'tool_result') {
      flushText();
      parts.push({
        kind: 'tool_result',
        toolName: block.toolName ?? message.toolName,
        toolResult: block.toolResult ?? message.toolResult ?? '',
      });
    } else if (block.text) {
      textBuffer.push(block.text);
    }
  }
  flushText();

  return parts.length > 0 ? parts : [fallbackStep(message, textKind)];
}

function fallbackStep(message: StoredMessage, textKind: StepKind): PartialStep {
  if (message.sender === 'tool') {
    if (message.toolResult !== undefined) {
      return {
        kind: 'tool_result',
        toolName: message.toolName,
        toolResult: message.toolResult,
      };
    }
    return {
      kind: 'tool_call',
      toolName: message.toolName ?? 'unknown',
      toolInput: parseToolInput(message.toolInput),
    };
  }
  return { kind: textKind, text: message.text };
}

function parseToolInput(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Malformed stored input — treat as empty rather than crash (Phase 8 rule).
  }
  return {};
}

function finalizeStep(partial: PartialStep, index: number, messageId: string): Step {
  const step: Step = { ...partial, index, messageId };
  if (step.kind === 'tool_call' && step.toolName && step.toolInput) {
    step.signature = signatureFor(step.toolName, step.toolInput);
    step.toolClass = classifyToolCall(step.toolName, step.toolInput);
    const hunks = extractEditHunks(step.toolName, step.toolInput);
    if (hunks.length > 0) step.editHunks = hunks;
  }
  return step;
}

function extractEditHunks(
  toolName: string,
  input: Record<string, unknown>
): EditHunk[] {
  const str = (v: unknown): string | undefined =>
    typeof v === 'string' ? v : undefined;

  switch (toolName) {
    case 'Edit': {
      const filePath = str(input.file_path);
      const newString = str(input.new_string);
      if (filePath === undefined || newString === undefined) return [];
      return [{ filePath: normalizePath(filePath), oldString: str(input.old_string), newString }];
    }
    case 'MultiEdit': {
      const filePath = str(input.file_path);
      if (filePath === undefined || !Array.isArray(input.edits)) return [];
      const normalized = normalizePath(filePath);
      const hunks: EditHunk[] = [];
      for (const edit of input.edits) {
        if (edit === null || typeof edit !== 'object') continue;
        const e = edit as Record<string, unknown>;
        const newString = str(e.new_string);
        if (newString === undefined) continue;
        hunks.push({ filePath: normalized, oldString: str(e.old_string), newString });
      }
      return hunks;
    }
    case 'Write': {
      const filePath = str(input.file_path);
      const content = str(input.content);
      if (filePath === undefined || content === undefined) return [];
      return [{ filePath: normalizePath(filePath), newString: content }];
    }
    case 'NotebookEdit': {
      const filePath = str(input.notebook_path);
      const newSource = str(input.new_source);
      if (filePath === undefined || newSource === undefined) return [];
      return [{ filePath: normalizePath(filePath), newString: newSource }];
    }
    default:
      return [];
  }
}

function buildEditTimelines(steps: Step[]): Map<string, TimelineEdit[]> {
  const timelines = new Map<string, TimelineEdit[]>();
  for (const step of steps) {
    if (!step.editHunks) continue;
    for (const hunk of step.editHunks) {
      const timeline = timelines.get(hunk.filePath) ?? [];
      timeline.push({ stepIndex: step.index, hunk });
      timelines.set(hunk.filePath, timeline);
    }
  }
  return timelines;
}

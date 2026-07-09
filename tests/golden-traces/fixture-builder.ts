// Emits schema-correct Claude Code JSONL for golden-trace fixtures.
// Entry shapes must stay in lockstep with src/types/claude-code.ts and
// parse cleanly through src/lib/parsers/claude-code.ts without modification.

import type {
  ClaudeCodeUserEntry,
  ClaudeCodeAssistantEntry,
  ClaudeCodeToolUseEntry,
  ClaudeCodeToolResultEntry,
} from '../../src/types/claude-code';

type TimestampedEntry =
  | ClaudeCodeUserEntry
  | ClaudeCodeAssistantEntry
  | ClaudeCodeToolUseEntry
  | ClaudeCodeToolResultEntry;

// Plain Omit over a union collapses to the keys the members share; this
// distributes so each entry shape keeps its own fields.
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

export type EntrySpec = DistributiveOmit<TimestampedEntry, 'timestamp'>;

export interface TraceOptions {
  sessionId: string;
  cwd?: string;
  gitBranch?: string;
  /** ISO timestamp of the first entry. */
  startTime?: string;
  /** Seconds between consecutive entries. */
  stepSeconds?: number;
}

export function userMsg(text: string): EntrySpec {
  return { type: 'user', message: { content: text } };
}

export function agentText(text: string): EntrySpec {
  return { type: 'assistant', message: { content: text } };
}

export function toolCall(
  toolName: string,
  input: Record<string, unknown>
): EntrySpec {
  return { type: 'tool_use', tool_name: toolName, tool_input: input };
}

export function toolResult(toolName: string, result: string): EntrySpec {
  return { type: 'tool_result', tool_name: toolName, result };
}

const DEFAULTS = {
  cwd: '/home/user/project',
  gitBranch: 'main',
  startTime: '2026-07-01T10:00:00.000Z',
  stepSeconds: 15,
} as const;

/**
 * Serialize entries to JSONL, assigning monotonically increasing timestamps
 * and attaching session metadata (sessionId/cwd/gitBranch) to the first entry,
 * mirroring how real session files carry metadata on ordinary entries.
 */
export function buildTrace(opts: TraceOptions, entries: EntrySpec[]): string {
  const { sessionId } = opts;
  const cwd = opts.cwd ?? DEFAULTS.cwd;
  const gitBranch = opts.gitBranch ?? DEFAULTS.gitBranch;
  const start = new Date(opts.startTime ?? DEFAULTS.startTime).getTime();
  const stepMs = (opts.stepSeconds ?? DEFAULTS.stepSeconds) * 1000;

  const lines = entries.map((entry, i) => {
    const stamped: TimestampedEntry = {
      ...entry,
      timestamp: new Date(start + i * stepMs).toISOString(),
    } as TimestampedEntry;
    if (i === 0) {
      return JSON.stringify({ ...stamped, sessionId, cwd, gitBranch });
    }
    return JSON.stringify(stamped);
  });

  return lines.join('\n') + '\n';
}

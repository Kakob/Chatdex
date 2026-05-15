// Types for Claude Code JSONL log format

// Metadata fields that may appear on any entry. Real session files attach
// these to user/assistant/tool entries (camelCase); the synthetic `system`
// entry from older fixtures used snake_case.
export interface ClaudeCodeEntryMetadata {
  cwd?: string;
  sessionId?: string;
  gitBranch?: string;
  session_id?: string;
  git_branch?: string;
}

export type ClaudeCodeEntry =
  | ClaudeCodeSystemEntry
  | ClaudeCodeUserEntry
  | ClaudeCodeAssistantEntry
  | ClaudeCodeToolUseEntry
  | ClaudeCodeToolResultEntry
  | ClaudeCodeUnknownEntry;

export interface ClaudeCodeSystemEntry extends ClaudeCodeEntryMetadata {
  type: 'system';
  model?: string;
  timestamp: string;
}

export interface ClaudeCodeUserEntry extends ClaudeCodeEntryMetadata {
  type: 'user';
  message: {
    content: string | ClaudeCodeContentBlock[];
  };
  timestamp: string;
}

export interface ClaudeCodeAssistantEntry extends ClaudeCodeEntryMetadata {
  type: 'assistant';
  message: {
    content: string | ClaudeCodeContentBlock[];
  };
  timestamp: string;
}

export interface ClaudeCodeToolUseEntry extends ClaudeCodeEntryMetadata {
  type: 'tool_use';
  tool_name: string;
  tool_input: Record<string, unknown>;
  timestamp: string;
}

export interface ClaudeCodeToolResultEntry extends ClaudeCodeEntryMetadata {
  type: 'tool_result';
  tool_name: string;
  result: string;
  timestamp: string;
}

// Catch-all for entry kinds we don't render (file-history-snapshot, etc.)
// — we still want to harvest cwd/sessionId if present.
export interface ClaudeCodeUnknownEntry extends ClaudeCodeEntryMetadata {
  type: string;
  timestamp?: string;
}

export interface ClaudeCodeContentBlock {
  type: 'text' | 'tool_use' | 'tool_result' | 'thinking' | string;
  // text / thinking
  text?: string;
  thinking?: string;
  // tool_use (Anthropic API shape: name + input; older logs used tool_name + tool_input)
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  // tool_result
  tool_use_id?: string;
  content?: string | ClaudeCodeContentBlock[];
  result?: string;
  is_error?: boolean;
}

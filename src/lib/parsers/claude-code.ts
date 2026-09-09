import type {
  ClaudeCodeEntry,
  ClaudeCodeContentBlock,
  ClaudeCodeUserEntry,
  ClaudeCodeAssistantEntry,
  ClaudeCodeToolUseEntry,
  ClaudeCodeToolResultEntry,
} from '../../types/claude-code';
import type { StoredConversation, StoredMessage, ContentBlock } from '../../types/unified';
import { estimateTokens } from '../utils/tokens';
import { generateId } from '../utils/ids';

// Stamped onto RawSource rows at import (SPEC-decision-investigation §7.1).
// Bump whenever parsing output changes for identical input.
// 1.1.0: preserve tool_use ids / tool_use_id on ContentBlock (toolUseId).
// 1.2.0: keep uuid / parentUuid / isSidechain / agentId (sourceMeta); subagent
//        transcripts get their own conversation id and a parent link
//        (SPEC-decision-recovery §8.3).
export const CLAUDE_CODE_PARSER_VERSION = '1.2.0';

/**
 * A line the parser could not use. Surfaced, never swallowed
 * (SPEC-decision-investigation §7.1: parser errors must be visible without
 * discarding unaffected source events).
 */
export interface ParseWarning {
  /** 1-based line number in the source file, counting blank lines. */
  line: number;
  reason: 'malformed-json';
}

export interface ParsedClaudeCode {
  conversations: StoredConversation[];
  messages: StoredMessage[];
  warnings: ParseWarning[];
}

export async function parseClaudeCodeJSONL(file: File): Promise<ParsedClaudeCode> {
  const content = await file.text();
  return parseClaudeCodeContent(content, file.name);
}

export function parseClaudeCodeContent(
  content: string,
  filename: string
): ParsedClaudeCode {
  const lines = content.split('\n');
  const entries: ClaudeCodeEntry[] = [];
  const warnings: ParseWarning[] = [];

  lines.forEach((line, index) => {
    if (!line.trim()) return;
    try {
      entries.push(JSON.parse(line) as ClaudeCodeEntry);
    } catch {
      // Keep going — one bad line must not discard the rest of the session —
      // but record it so the import result can say what was skipped.
      warnings.push({ line: index + 1, reason: 'malformed-json' });
    }
  });

  if (entries.length === 0) {
    throw new Error('No valid entries found in JSONL file');
  }

  return { ...parseEntries(entries, filename), warnings };
}

function parseEntries(
  entries: ClaudeCodeEntry[],
  filename: string
): Omit<ParsedClaudeCode, 'warnings'> {
  const messages: StoredMessage[] = [];
  const textParts: string[] = [];
  const now = new Date();

  // Metadata (cwd / sessionId / gitBranch) can live on any entry in real
  // Claude Code session files — not just a leading `system` entry — so we
  // sweep every entry and keep the first non-empty value we see.
  let sessionId: string | undefined;
  let workingDirectory: string | undefined;
  let gitBranch: string | undefined;
  let agentId: string | undefined;
  let sidechain = false;

  for (const entry of entries) {
    if (!sessionId) sessionId = entry.sessionId ?? entry.session_id;
    if (!workingDirectory) workingDirectory = entry.cwd;
    if (!gitBranch) gitBranch = entry.gitBranch ?? entry.git_branch;
    if (!agentId && typeof entry.agentId === 'string') agentId = entry.agentId;
    if (entry.isSidechain === true) sidechain = true;
  }

  // A subagent transcript carries its PARENT's sessionId. Give it its own
  // conversation id so it never collides with (or silently replaces) the
  // parent, and remember the parent for the delegation link.
  const parentSessionId = sidechain && sessionId ? sessionId : undefined;
  const conversationId = sidechain
    ? `${sessionId ?? 'session'}:agent:${agentId ?? generateId()}`
    : (sessionId ?? generateId());
  sessionId = conversationId;
  const projectPath = workingDirectory;

  let firstTimestamp: Date = now;
  let lastTimestamp: Date = now;
  let sawTimestamp = false;

  let userMessageCount = 0;
  let assistantMessageCount = 0;

  for (const entry of entries) {
    const timestamp = entry.timestamp ? new Date(entry.timestamp) : null;
    if (timestamp && !Number.isNaN(timestamp.getTime())) {
      if (!sawTimestamp || timestamp < firstTimestamp) firstTimestamp = timestamp;
      if (!sawTimestamp || timestamp > lastTimestamp) lastTimestamp = timestamp;
      sawTimestamp = true;
    }
    const entryTimestamp = timestamp && !Number.isNaN(timestamp.getTime()) ? timestamp : now;

    const msgId = generateId();
    const sourceMeta = sourceMetaOf(entry);

    switch (entry.type) {
      case 'user': {
        // Casts in this switch: ClaudeCodeUnknownEntry's `type: string`
        // catch-all defeats discriminated-union narrowing, so each case
        // asserts the shape its runtime `type` value implies.
        userMessageCount++;
        const { text, contentBlocks } = extractContent(
          (entry as ClaudeCodeUserEntry).message.content
        );
        textParts.push(text);
        messages.push({
          id: msgId,
          conversationId: sessionId,
          sender: 'user',
          text,
          contentBlocks: contentBlocks.length > 0 ? contentBlocks : undefined,
          createdAt: entryTimestamp,
          ...(sourceMeta ? { sourceMeta } : {}),
        });
        break;
      }

      case 'assistant': {
        assistantMessageCount++;
        const { text, contentBlocks } = extractContent(
          (entry as ClaudeCodeAssistantEntry).message.content
        );
        textParts.push(text);
        messages.push({
          id: msgId,
          conversationId: sessionId,
          sender: 'assistant',
          text,
          contentBlocks: contentBlocks.length > 0 ? contentBlocks : undefined,
          createdAt: entryTimestamp,
          ...(sourceMeta ? { sourceMeta } : {}),
        });
        break;
      }

      case 'system': {
        // System entries are metadata, skip for messages
        break;
      }

      case 'tool_use': {
        const toolUse = entry as ClaudeCodeToolUseEntry;
        const toolText = `[Tool: ${toolUse.tool_name}]`;
        const toolInputObj = toolUse.tool_input as Record<string, unknown>;
        messages.push({
          id: msgId,
          conversationId: sessionId,
          sender: 'tool',
          text: toolText,
          contentBlocks: [{
            type: 'tool_use',
            toolName: toolUse.tool_name,
            toolInput: toolInputObj,
          }],
          createdAt: entryTimestamp,
          toolName: toolUse.tool_name,
          toolInput: JSON.stringify(toolUse.tool_input, null, 2),
        });
        break;
      }

      case 'tool_result': {
        const toolResult = entry as ClaudeCodeToolResultEntry;
        const resultText = toolResult.result.slice(0, 500); // Truncate for text field
        messages.push({
          id: msgId,
          conversationId: sessionId,
          sender: 'tool',
          text: `[Tool Result: ${toolResult.tool_name}]`,
          contentBlocks: [{
            type: 'tool_result',
            toolName: toolResult.tool_name,
            toolResult: toolResult.result, // Full result in content block
          }],
          createdAt: entryTimestamp,
          toolName: toolResult.tool_name,
          toolResult: resultText,
        });
        break;
      }
    }
  }

  // Derive conversation name from filename or working directory
  const baseName = deriveConversationName(filename, workingDirectory);
  const name = sidechain ? `${baseName} · subagent ${(agentId ?? conversationId).slice(0, 8)}` : baseName;

  // Set conversationName on all messages
  for (const msg of messages) {
    msg.conversationName = name;
  }

  const fullText = textParts.join(' ');

  const conversation: StoredConversation = {
    id: sessionId,
    source: 'claude-code',
    name,
    summary: null,
    createdAt: firstTimestamp,
    updatedAt: lastTimestamp,
    importedAt: now,
    messageCount: messages.length,
    userMessageCount,
    assistantMessageCount,
    estimatedTokens: estimateTokens(fullText),
    fullText,
    projectPath,
    gitBranch,
    workingDirectory,
    providerMeta: {
      sourceFilename: filename,
      ...(sidechain ? { isSidechain: true } : {}),
      ...(agentId ? { agentId } : {}),
      ...(parentSessionId ? { parentSessionId } : {}),
    },
  };

  return {
    conversations: [conversation],
    messages,
  };
}

/** Entry identity fields, only when the source carried any (keeps old fixtures unchanged). */
function sourceMetaOf(entry: ClaudeCodeEntry): StoredMessage['sourceMeta'] | undefined {
  const meta: NonNullable<StoredMessage['sourceMeta']> = {};
  if (typeof entry.uuid === 'string') meta.uuid = entry.uuid;
  if (typeof entry.parentUuid === 'string') meta.parentUuid = entry.parentUuid;
  if (entry.isSidechain === true) meta.isSidechain = true;
  if (typeof entry.agentId === 'string') meta.agentId = entry.agentId;
  return Object.keys(meta).length > 0 ? meta : undefined;
}

interface ExtractedContent {
  text: string;
  contentBlocks: ContentBlock[];
}

function extractContent(content: string | ClaudeCodeContentBlock[]): ExtractedContent {
  if (typeof content === 'string') {
    const contentBlocks = parseTextForCodeBlocks(content);
    return { text: content, contentBlocks };
  }

  const textParts: string[] = [];
  const contentBlocks: ContentBlock[] = [];

  for (const block of content) {
    if (block.type === 'text' && block.text) {
      textParts.push(block.text);
      const parsed = parseTextForCodeBlocks(block.text);
      contentBlocks.push(...parsed);
    } else if (block.type === 'thinking' && block.thinking) {
      textParts.push(block.thinking);
      contentBlocks.push({ type: 'thinking', text: block.thinking });
    } else if (block.type === 'tool_use') {
      // Anthropic API shape uses `name`/`input`; older fixtures used `tool_name`/`tool_input`.
      const toolName = block.name ?? block.tool_name ?? 'tool';
      const toolInput = (block.input ?? block.tool_input ?? {}) as Record<string, unknown>;
      textParts.push(`[Tool: ${toolName}]`);
      contentBlocks.push({ type: 'tool_use', toolName, toolInput, toolUseId: block.id });
    } else if (block.type === 'tool_result') {
      const resultText = flattenToolResultContent(block.content ?? block.result);
      textParts.push(resultText ? `[Tool Result] ${resultText}` : '[Tool Result]');
      contentBlocks.push({
        type: 'tool_result',
        toolResult: resultText,
        toolUseId: block.tool_use_id,
      });
    }
  }

  return {
    text: textParts.join('\n'),
    contentBlocks,
  };
}

function flattenToolResultContent(
  content: string | ClaudeCodeContentBlock[] | undefined,
): string {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  return content
    .map((block) => {
      if (typeof block === 'string') return block;
      if (block.type === 'text' && block.text) return block.text;
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function parseTextForCodeBlocks(text: string): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  const codeBlockRegex = /```(\w*)\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let match;

  while ((match = codeBlockRegex.exec(text)) !== null) {
    // Add text before this code block
    if (match.index > lastIndex) {
      const textBefore = text.slice(lastIndex, match.index).trim();
      if (textBefore) {
        blocks.push({ type: 'text', text: textBefore });
      }
    }

    // Add the code block
    blocks.push({
      type: 'code',
      language: match[1] || undefined,
      text: match[2],
    });

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text after last code block
  if (lastIndex < text.length) {
    const remainingText = text.slice(lastIndex).trim();
    if (remainingText) {
      blocks.push({ type: 'text', text: remainingText });
    }
  }

  // If no code blocks found, return single text block
  if (blocks.length === 0 && text.trim()) {
    blocks.push({ type: 'text', text: text.trim() });
  }

  return blocks;
}

function deriveConversationName(
  filename: string,
  workingDirectory?: string
): string {
  // Try to extract a meaningful name from the working directory
  if (workingDirectory) {
    const parts = workingDirectory.split('/');
    const projectName = parts[parts.length - 1];
    if (projectName && projectName !== '~') {
      return projectName;
    }
  }

  // Fall back to filename without extension
  return filename.replace(/\.jsonl$/i, '').replace(/[-_]/g, ' ');
}

export function isClaudeCodeJSONL(file: File): boolean {
  return file.name.endsWith('.jsonl');
}

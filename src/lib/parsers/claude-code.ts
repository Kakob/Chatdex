import type {
  ClaudeCodeEntry,
  ClaudeCodeSystemEntry,
  ClaudeCodeContentBlock,
} from '../../types/claude-code';
import type { StoredConversation, StoredMessage, ContentBlock } from '../../types/unified';
import { estimateTokens } from '../utils/tokens';
import { generateId } from '../utils/ids';

export interface ParsedClaudeCode {
  conversations: StoredConversation[];
  messages: StoredMessage[];
}

export async function parseClaudeCodeJSONL(file: File): Promise<ParsedClaudeCode> {
  const content = await file.text();
  return parseClaudeCodeContent(content, file.name);
}

export function parseClaudeCodeContent(
  content: string,
  filename: string
): ParsedClaudeCode {
  const lines = content.split('\n').filter((line) => line.trim());
  const entries: ClaudeCodeEntry[] = [];

  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as ClaudeCodeEntry;
      entries.push(entry);
    } catch {
      // Skip malformed lines
      console.warn('Skipping malformed JSONL line');
    }
  }

  if (entries.length === 0) {
    throw new Error('No valid entries found in JSONL file');
  }

  return parseEntries(entries, filename);
}

function parseEntries(
  entries: ClaudeCodeEntry[],
  filename: string
): ParsedClaudeCode {
  const messages: StoredMessage[] = [];
  const textParts: string[] = [];
  const now = new Date();

  // Extract metadata from first entry if it's a system entry
  let sessionId = generateId();
  let workingDirectory: string | undefined;
  let gitBranch: string | undefined;
  let projectPath: string | undefined;
  let firstTimestamp: Date = now;
  let lastTimestamp: Date = now;

  const firstEntry = entries[0];
  if (firstEntry && firstEntry.type === 'system') {
    const sysEntry = firstEntry as ClaudeCodeSystemEntry;
    if (sysEntry.session_id) sessionId = sysEntry.session_id;
    workingDirectory = sysEntry.cwd;
    gitBranch = sysEntry.git_branch;
    projectPath = sysEntry.cwd;
  }

  let userMessageCount = 0;
  let assistantMessageCount = 0;

  for (const entry of entries) {
    const timestamp = new Date(entry.timestamp);

    if (timestamp < firstTimestamp) firstTimestamp = timestamp;
    if (timestamp > lastTimestamp) lastTimestamp = timestamp;

    const msgId = generateId();

    switch (entry.type) {
      case 'user': {
        userMessageCount++;
        const { text, contentBlocks } = extractContent(entry.message.content);
        textParts.push(text);
        messages.push({
          id: msgId,
          conversationId: sessionId,
          sender: 'user',
          text,
          contentBlocks: contentBlocks.length > 0 ? contentBlocks : undefined,
          createdAt: timestamp,
        });
        break;
      }

      case 'assistant': {
        assistantMessageCount++;
        const { text, contentBlocks } = extractContent(entry.message.content);
        textParts.push(text);
        messages.push({
          id: msgId,
          conversationId: sessionId,
          sender: 'assistant',
          text,
          contentBlocks: contentBlocks.length > 0 ? contentBlocks : undefined,
          createdAt: timestamp,
        });
        break;
      }

      case 'system': {
        // System entries are metadata, skip for messages
        break;
      }

      case 'tool_use': {
        const toolText = `[Tool: ${entry.tool_name}]`;
        const toolInputObj = entry.tool_input as Record<string, unknown>;
        messages.push({
          id: msgId,
          conversationId: sessionId,
          sender: 'tool',
          text: toolText,
          contentBlocks: [{
            type: 'tool_use',
            toolName: entry.tool_name,
            toolInput: toolInputObj,
          }],
          createdAt: timestamp,
          toolName: entry.tool_name,
          toolInput: JSON.stringify(entry.tool_input, null, 2),
        });
        break;
      }

      case 'tool_result': {
        const resultText = entry.result.slice(0, 500); // Truncate for text field
        messages.push({
          id: msgId,
          conversationId: sessionId,
          sender: 'tool',
          text: `[Tool Result: ${entry.tool_name}]`,
          contentBlocks: [{
            type: 'tool_result',
            toolName: entry.tool_name,
            toolResult: entry.result, // Full result in content block
          }],
          createdAt: timestamp,
          toolName: entry.tool_name,
          toolResult: resultText,
        });
        break;
      }
    }
  }

  // Derive conversation name from filename or working directory
  const name = deriveConversationName(filename, workingDirectory);

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
  };

  return {
    conversations: [conversation],
    messages,
  };
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
      const thinking = block.thinking;
      textParts.push(thinking);
      contentBlocks.push({
        type: 'thinking',
        text: thinking,
      });
    }
  }

  return {
    text: textParts.join('\n'),
    contentBlocks,
  };
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

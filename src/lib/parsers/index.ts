import JSZip from 'jszip';
import { parseClaudeAIJSON, CLAUDE_AI_PARSER_VERSION } from './claude-ai';
import { parseClaudeCodeContent, CLAUDE_CODE_PARSER_VERSION } from './claude-code';
import { parseChatGPTJSON, CHATGPT_PARSER_VERSION } from './chatgpt';
import type { StoredConversation, StoredMessage, DataSource } from '../../types';

// Verbatim payload a parser consumed, captured per input file so import can
// persist it as an immutable RawSource row (SPEC-decision-investigation §7.1).
export type RawSourceCapture = {
  kind: DataSource;
  filename: string;
  rawText: string;
  parserVersion: string;
  conversationIds: string[];
};

export type ParsedData = {
  conversations: StoredConversation[];
  messages: StoredMessage[];
  source: DataSource;
  rawSources: RawSourceCapture[];
};

export type FileFormat =
  | 'claude-ai-zip'
  | 'claude-ai-json'
  | 'claude-code-jsonl'
  | 'chatgpt-zip'
  | 'chatgpt-json'
  | 'unknown';

// Both Claude.ai and ChatGPT export ZIPs contain `conversations.json`, so
// filename alone can't discriminate. `sniffJSONContent` inspects the payload
// structure — ChatGPT wraps each conversation in a `mapping` node graph while
// Claude.ai uses a flat array of message envelopes. Ambiguous JSON defaults
// to Claude.ai so existing users can't regress.
export function sniffJSONContent(content: string): 'claude-ai' | 'chatgpt' | 'unknown' {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return 'unknown';
  }

  const sample = pickSampleConversation(parsed);
  if (!sample) return 'unknown';

  if (looksLikeChatGPT(sample)) return 'chatgpt';
  if (looksLikeClaudeAI(sample)) return 'claude-ai';
  return 'unknown';
}

function pickSampleConversation(data: unknown): Record<string, unknown> | null {
  const array = extractArray(data);
  if (!array) return null;
  for (const item of array) {
    if (item && typeof item === 'object') return item as Record<string, unknown>;
  }
  return null;
}

function extractArray(data: unknown): unknown[] | null {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    for (const key of ['conversations', 'chats', 'data']) {
      if (Array.isArray(obj[key])) return obj[key] as unknown[];
    }
  }
  return null;
}

function looksLikeChatGPT(item: Record<string, unknown>): boolean {
  return (
    ('mapping' in item && typeof item.mapping === 'object' && item.mapping !== null) ||
    typeof item.current_node === 'string'
  );
}

function looksLikeClaudeAI(item: Record<string, unknown>): boolean {
  return (
    typeof item.uuid === 'string' &&
    ('chat_messages' in item || 'messages' in item || 'name' in item)
  );
}

export async function detectFileFormat(file: File): Promise<FileFormat> {
  if (file.name.endsWith('.jsonl')) return 'claude-code-jsonl';

  if (isZipFile(file)) {
    const content = await tryExtractConversationsJSON(file);
    if (!content) return 'unknown';
    return sniffJSONContent(content) === 'chatgpt' ? 'chatgpt-zip' : 'claude-ai-zip';
  }

  if (isJSONFile(file)) {
    const content = await file.text().catch(() => '');
    if (!content) return 'unknown';
    return sniffJSONContent(content) === 'chatgpt' ? 'chatgpt-json' : 'claude-ai-json';
  }

  return 'unknown';
}

export async function parseFile(file: File): Promise<ParsedData> {
  if (file.name.endsWith('.jsonl')) {
    const content = await file.text();
    const result = parseClaudeCodeContent(content, file.name);
    return {
      ...result,
      source: 'claude-code',
      rawSources: [
        capture('claude-code', file.name, content, CLAUDE_CODE_PARSER_VERSION, result.conversations),
      ],
    };
  }

  if (isZipFile(file)) {
    // The retained payload is the extracted conversations.json — the text the
    // parser actually consumed — not the ZIP container bytes.
    const content = await extractConversationsJSON(file);
    return parseByContent(content, file.name);
  }

  if (isJSONFile(file)) {
    const content = await file.text();
    return parseByContent(content, file.name);
  }

  throw new Error(
    'Unknown file format. Expected ZIP (Claude.ai or ChatGPT export), JSON (conversations.json), or JSONL (Claude Code logs).'
  );
}

async function parseByContent(content: string, sourceFilename: string): Promise<ParsedData> {
  const sniffed = sniffJSONContent(content);
  if (sniffed === 'chatgpt') {
    const result = await parseChatGPTJSON(content, sourceFilename);
    return {
      ...result,
      source: 'chatgpt',
      rawSources: [
        capture('chatgpt', sourceFilename, content, CHATGPT_PARSER_VERSION, result.conversations),
      ],
    };
  }
  // 'claude-ai' or 'unknown': fall through to the Claude.ai parser so its
  // detailed error messages surface for truly invalid inputs.
  const result = await parseClaudeAIJSON(content, sourceFilename);
  return {
    ...result,
    source: 'claude.ai',
    rawSources: [
      capture('claude.ai', sourceFilename, content, CLAUDE_AI_PARSER_VERSION, result.conversations),
    ],
  };
}

function capture(
  kind: DataSource,
  filename: string,
  rawText: string,
  parserVersion: string,
  conversations: StoredConversation[]
): RawSourceCapture {
  return { kind, filename, rawText, parserVersion, conversationIds: conversations.map((c) => c.id) };
}

async function tryExtractConversationsJSON(file: File): Promise<string | null> {
  try {
    return await extractConversationsJSON(file);
  } catch {
    return null;
  }
}

async function extractConversationsJSON(file: File): Promise<string> {
  const zip = await JSZip.loadAsync(file);
  const candidates = [
    'conversations.json',
    'claude/conversations.json',
    'chatgpt/conversations.json',
    'export/conversations.json',
    'data/conversations.json',
  ];
  for (const path of candidates) {
    const entry = zip.file(path);
    if (entry) return entry.async('string');
  }
  const match = Object.keys(zip.files).find(
    (f) => f.endsWith('conversations.json') && !f.startsWith('__MACOSX')
  );
  if (match) {
    const entry = zip.file(match);
    if (entry) return entry.async('string');
  }
  const listing = Object.keys(zip.files)
    .filter((f) => !f.startsWith('__MACOSX'))
    .join(', ');
  throw new Error(
    `conversations.json not found in ZIP file. Files in archive: ${listing || '(empty)'}`
  );
}

function isZipFile(file: File): boolean {
  return file.type === 'application/zip' || file.name.endsWith('.zip');
}

function isJSONFile(file: File): boolean {
  return file.type === 'application/json' || file.name.endsWith('.json');
}

export async function parseFiles(
  files: File[],
  onProgress?: (current: number, total: number, filename: string) => void
): Promise<ParsedData> {
  const allConversations: StoredConversation[] = [];
  const allMessages: StoredMessage[] = [];
  const allRawSources: RawSourceCapture[] = [];
  let primarySource: DataSource = 'claude.ai';

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    onProgress?.(i + 1, files.length, file.name);

    const result = await parseFile(file);
    allConversations.push(...result.conversations);
    allMessages.push(...result.messages);
    allRawSources.push(...result.rawSources);

    if (i === 0) {
      primarySource = result.source;
    }
  }

  return {
    conversations: allConversations,
    messages: allMessages,
    source: primarySource,
    rawSources: allRawSources,
  };
}

export { parseClaudeAIZip, parseClaudeAIJSON } from './claude-ai';
export { parseClaudeCodeJSONL } from './claude-code';
export { parseChatGPTZip, parseChatGPTJSON } from './chatgpt';

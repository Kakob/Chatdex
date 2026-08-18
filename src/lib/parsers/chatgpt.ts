// ChatGPT export parser (official data-export ZIP).
//
// The export ships `conversations.json` as an array where each conversation is
// a `mapping` node graph, not a linear message list. Reconstructing the
// canonical thread means walking from `current_node` up to the root and
// reversing for chronological order — siblings in the graph are edits or
// regenerations that are discarded from the v1 message stream but counted in
// `providerMeta.prunedBranches` so the discarded evidence stays visible.

import JSZip from 'jszip';
import type {
  StoredConversation,
  StoredMessage,
  ContentBlock,
  MessageSender,
} from '../../types/unified';
import { estimateTokens } from '../utils/tokens';
import { generateId } from '../utils/ids';

// Stamped onto RawSource rows at import (SPEC-decision-investigation §7.1).
// Bump whenever parsing output changes for identical input.
export const CHATGPT_PARSER_VERSION = '1.0.0';

export interface ParsedChatGPT {
  conversations: StoredConversation[];
  messages: StoredMessage[];
}

interface ChatGPTAuthor {
  role?: string;
  name?: string | null;
  metadata?: Record<string, unknown>;
}

interface ChatGPTContent {
  content_type?: string;
  parts?: unknown[];
  text?: string;
  language?: string;
  thoughts?: Array<{ summary?: string; content?: string }>;
}

interface ChatGPTMessage {
  id?: string;
  author?: ChatGPTAuthor;
  create_time?: number | null;
  content?: ChatGPTContent;
  metadata?: Record<string, unknown>;
}

interface ChatGPTNode {
  id: string;
  parent?: string | null;
  children?: string[];
  message?: ChatGPTMessage | null;
}

interface ChatGPTConversation {
  id?: string;
  conversation_id?: string;
  title?: string | null;
  create_time?: number | null;
  update_time?: number | null;
  current_node?: string | null;
  mapping?: Record<string, ChatGPTNode>;
}

const IMAGE_PLACEHOLDER = '[image]';

export async function parseChatGPTZip(file: File): Promise<ParsedChatGPT> {
  const zip = await JSZip.loadAsync(file);

  // Same candidate paths as Claude.ai: exact hits first, then a broad search
  // through the archive. Real exports vary by capture tool.
  const candidatePaths = [
    'conversations.json',
    'chatgpt/conversations.json',
    'export/conversations.json',
    'data/conversations.json',
  ];

  let content: string | null = null;
  for (const path of candidatePaths) {
    const jsonFile = zip.file(path);
    if (jsonFile) {
      content = await jsonFile.async('string');
      break;
    }
  }

  if (!content) {
    const match = Object.keys(zip.files).find(
      (f) => f.endsWith('conversations.json') && !f.startsWith('__MACOSX')
    );
    if (match) {
      const jsonFile = zip.file(match);
      if (jsonFile) content = await jsonFile.async('string');
    }
  }

  if (!content) {
    const listing = Object.keys(zip.files)
      .filter((f) => !f.startsWith('__MACOSX'))
      .join(', ');
    throw new Error(
      `conversations.json not found in ChatGPT export ZIP. Files in archive: ${listing || '(empty)'}`
    );
  }

  return parseChatGPTJSON(content, file.name);
}

export async function parseChatGPTJSON(
  content: string,
  sourceFilename?: string
): Promise<ParsedChatGPT> {
  const data = JSON.parse(content);
  const rawConversations = extractConversationArray(data);

  const conversations: StoredConversation[] = [];
  const messages: StoredMessage[] = [];
  const importedAt = new Date();

  for (const raw of rawConversations) {
    try {
      const parsed = parseConversation(raw, importedAt, sourceFilename);
      if (parsed) {
        conversations.push(parsed.conversation);
        messages.push(...parsed.messages);
      }
    } catch (err) {
      console.warn('Skipping malformed ChatGPT conversation:', err);
    }
  }

  if (conversations.length === 0) {
    throw new Error('No valid conversations found in ChatGPT export');
  }

  return { conversations, messages };
}

function extractConversationArray(data: unknown): ChatGPTConversation[] {
  if (Array.isArray(data)) return data as ChatGPTConversation[];
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    for (const key of ['conversations', 'chats', 'data']) {
      const value = obj[key];
      if (Array.isArray(value)) return value as ChatGPTConversation[];
    }
  }
  throw new Error(
    'Invalid ChatGPT export format: could not find conversations array.'
  );
}

function parseConversation(
  raw: ChatGPTConversation,
  importedAt: Date,
  sourceFilename?: string
): { conversation: StoredConversation; messages: StoredMessage[] } | null {
  const mapping = raw.mapping;
  if (!mapping || typeof mapping !== 'object') return null;

  const currentNodeId = raw.current_node ?? findLeafNode(mapping);
  if (!currentNodeId) return null;

  const canonicalNodeIds = walkToRoot(mapping, currentNodeId);
  if (canonicalNodeIds.length === 0) return null;

  const conversationId = raw.conversation_id ?? raw.id ?? generateId();
  const name = raw.title?.trim() || 'Untitled ChatGPT Conversation';

  const messages: StoredMessage[] = [];
  const textParts: string[] = [name];
  let userMessageCount = 0;
  let assistantMessageCount = 0;
  let firstTimestamp: Date | null = null;
  let lastTimestamp: Date | null = null;

  for (const nodeId of canonicalNodeIds) {
    const node = mapping[nodeId];
    const message = node?.message;
    if (!message) continue;
    if (isHiddenMessage(message)) continue;

    const sender = mapRole(message.author?.role);
    if (!sender) continue;

    const { text, contentBlocks } = extractMessageContent(message);
    if (!text.trim() && contentBlocks.length === 0) continue;

    if (sender === 'user') userMessageCount++;
    else if (sender === 'assistant') assistantMessageCount++;

    const timestamp = unixToDate(message.create_time) ?? importedAt;
    if (!firstTimestamp || timestamp < firstTimestamp) firstTimestamp = timestamp;
    if (!lastTimestamp || timestamp > lastTimestamp) lastTimestamp = timestamp;

    textParts.push(text);
    messages.push({
      id: message.id ?? nodeId,
      conversationId,
      sender,
      text,
      contentBlocks: contentBlocks.length > 0 ? contentBlocks : undefined,
      conversationName: name,
      createdAt: timestamp,
    });
  }

  if (messages.length === 0) return null;

  const fullText = textParts.join('\n');
  const createdAt =
    unixToDate(raw.create_time) ?? firstTimestamp ?? importedAt;
  const updatedAt =
    unixToDate(raw.update_time) ?? lastTimestamp ?? createdAt;

  const canonicalSet = new Set(canonicalNodeIds);
  const totalMappingNodes = Object.keys(mapping).length;
  const prunedBranches = Math.max(0, totalMappingNodes - canonicalSet.size);

  const conversation: StoredConversation = {
    id: conversationId,
    source: 'chatgpt',
    name,
    summary: null,
    createdAt,
    updatedAt,
    importedAt,
    messageCount: messages.length,
    userMessageCount,
    assistantMessageCount,
    estimatedTokens: estimateTokens(fullText),
    fullText,
    providerMeta: {
      currentNodeId,
      canonicalNodeCount: canonicalNodeIds.length,
      totalMappingNodes,
      prunedBranches,
      ...(sourceFilename ? { sourceFilename } : {}),
    },
  };

  return { conversation, messages };
}

// Walk from a leaf up to the root, then reverse for chronological order.
// Cycle guard: mapping is user-supplied JSON, so a corrupted parent chain
// shouldn't hang the parser.
function walkToRoot(
  mapping: Record<string, ChatGPTNode>,
  startId: string
): string[] {
  const ordered: string[] = [];
  const seen = new Set<string>();
  let cursor: string | null | undefined = startId;
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    if (mapping[cursor]) ordered.push(cursor);
    cursor = mapping[cursor]?.parent ?? null;
  }
  return ordered.reverse();
}

// Fallback when current_node is missing: pick the deepest leaf by walking
// children from the root and preferring the last child at each step, matching
// how the ChatGPT UI shows the newest edit branch.
function findLeafNode(mapping: Record<string, ChatGPTNode>): string | null {
  const rootId = Object.keys(mapping).find(
    (id) => !mapping[id]?.parent || !(mapping[id].parent! in mapping)
  );
  if (!rootId) return null;

  let cursor = rootId;
  const seen = new Set<string>();
  while (!seen.has(cursor)) {
    seen.add(cursor);
    const children = mapping[cursor]?.children ?? [];
    if (children.length === 0) return cursor;
    cursor = children[children.length - 1];
  }
  return cursor;
}

function mapRole(role: string | undefined): MessageSender | null {
  switch (role) {
    case 'user':
      return 'user';
    case 'assistant':
      return 'assistant';
    case 'system':
      return 'system';
    case 'tool':
      return 'tool';
    default:
      return null;
  }
}

function isHiddenMessage(message: ChatGPTMessage): boolean {
  const flag = message.metadata?.is_visually_hidden_from_conversation;
  return flag === true;
}

function unixToDate(seconds: number | null | undefined): Date | null {
  if (seconds == null || !Number.isFinite(seconds)) return null;
  return new Date(seconds * 1000);
}

interface ExtractedContent {
  text: string;
  contentBlocks: ContentBlock[];
}

function extractMessageContent(message: ChatGPTMessage): ExtractedContent {
  const content = message.content;
  if (!content) return { text: '', contentBlocks: [] };

  switch (content.content_type) {
    case 'text':
      return extractTextParts(content.parts);

    case 'code': {
      const code = typeof content.text === 'string'
        ? content.text
        : stringifyParts(content.parts);
      if (!code) return { text: '', contentBlocks: [] };
      return {
        text: code,
        contentBlocks: [{ type: 'code', language: content.language, text: code }],
      };
    }

    case 'execution_output': {
      const output = typeof content.text === 'string'
        ? content.text
        : stringifyParts(content.parts);
      if (!output) return { text: '', contentBlocks: [] };
      return {
        text: output,
        contentBlocks: [{ type: 'code', language: 'output', text: output }],
      };
    }

    case 'multimodal_text':
      return extractMultimodal(content.parts);

    case 'thoughts':
    case 'reasoning_recap':
      return extractThoughts(content.thoughts, content.parts);

    default:
      // Best-effort fallback: prefer `parts`, then `text`, else drop the
      // message. Unknown content types render as plain text so nothing is
      // silently lost.
      if (Array.isArray(content.parts)) return extractTextParts(content.parts);
      if (typeof content.text === 'string' && content.text.trim()) {
        return {
          text: content.text,
          contentBlocks: [{ type: 'text', text: content.text }],
        };
      }
      return { text: '', contentBlocks: [] };
  }
}

function extractTextParts(parts: unknown[] | undefined): ExtractedContent {
  if (!Array.isArray(parts)) return { text: '', contentBlocks: [] };
  const joined = parts
    .filter((p): p is string => typeof p === 'string')
    .join('\n')
    .trim();
  if (!joined) return { text: '', contentBlocks: [] };
  return { text: joined, contentBlocks: [{ type: 'text', text: joined }] };
}

function extractMultimodal(parts: unknown[] | undefined): ExtractedContent {
  if (!Array.isArray(parts)) return { text: '', contentBlocks: [] };
  const blocks: ContentBlock[] = [];
  const textFragments: string[] = [];

  for (const part of parts) {
    if (typeof part === 'string') {
      if (part.trim()) {
        blocks.push({ type: 'text', text: part });
        textFragments.push(part);
      }
    } else if (part && typeof part === 'object') {
      // Image/audio pointers can't be inlined; keep a placeholder so the
      // message survives the round-trip and the block count stays accurate.
      const label = (part as { content_type?: string }).content_type ?? 'attachment';
      blocks.push({ type: 'unsupported', text: `[${label}]` });
      textFragments.push(IMAGE_PLACEHOLDER);
    }
  }

  return { text: textFragments.join('\n'), contentBlocks: blocks };
}

function extractThoughts(
  thoughts: ChatGPTContent['thoughts'],
  fallbackParts: unknown[] | undefined
): ExtractedContent {
  const summaries = Array.isArray(thoughts)
    ? thoughts
        .map((t) => [t?.summary, t?.content].filter(Boolean).join('\n'))
        .filter(Boolean)
    : [];
  const joined = summaries.length > 0
    ? summaries.join('\n\n')
    : stringifyParts(fallbackParts);
  if (!joined) return { text: '', contentBlocks: [] };
  return { text: joined, contentBlocks: [{ type: 'thinking', text: joined }] };
}

function stringifyParts(parts: unknown[] | undefined): string {
  if (!Array.isArray(parts)) return '';
  return parts.filter((p): p is string => typeof p === 'string').join('\n').trim();
}

export function isChatGPTZip(file: File): boolean {
  return file.type === 'application/zip' || file.name.endsWith('.zip');
}

export function isChatGPTJSON(file: File): boolean {
  return file.type === 'application/json' || file.name.endsWith('.json');
}

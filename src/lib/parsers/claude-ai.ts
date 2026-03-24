import JSZip from 'jszip';
import type { ClaudeAIConversation, ClaudeAIMessage } from '../../types/claude-ai';
import type { StoredConversation, StoredMessage, ContentBlock } from '../../types/unified';
import { estimateTokens } from '../utils/tokens';

export interface ParsedClaudeAI {
  conversations: StoredConversation[];
  messages: StoredMessage[];
}

export async function parseClaudeAIZip(file: File): Promise<ParsedClaudeAI> {
  const zip = await JSZip.loadAsync(file);

  // Try multiple possible locations for conversations.json
  const possiblePaths = [
    'conversations.json',
    'claude/conversations.json',
    'export/conversations.json',
    'data/conversations.json',
  ];

  let content: string | null = null;

  // First try exact paths
  for (const path of possiblePaths) {
    const jsonFile = zip.file(path);
    if (jsonFile) {
      content = await jsonFile.async('string');
      break;
    }
  }

  // If not found, search for any conversations.json in the zip
  if (!content) {
    const files = Object.keys(zip.files);
    const conversationsFile = files.find(
      (f) => f.endsWith('conversations.json') && !f.startsWith('__MACOSX')
    );
    if (conversationsFile) {
      const jsonFile = zip.file(conversationsFile);
      if (jsonFile) {
        content = await jsonFile.async('string');
      }
    }
  }

  if (!content) {
    // List files in zip for debugging
    const fileList = Object.keys(zip.files).filter(f => !f.startsWith('__MACOSX')).join(', ');
    throw new Error(
      `conversations.json not found in ZIP file. Files in archive: ${fileList || '(empty)'}`
    );
  }

  return parseClaudeAIJSON(content);
}

export async function parseClaudeAIJSON(content: string): Promise<ParsedClaudeAI> {
  const data = JSON.parse(content);

  console.log('[Parser] Data type:', typeof data, 'isArray:', Array.isArray(data));
  if (!Array.isArray(data)) {
    console.log('[Parser] Object keys:', Object.keys(data));
  } else {
    console.log('[Parser] Array length:', data.length);
  }

  // Handle multiple possible formats
  let conversationsArray: ClaudeAIConversation[];

  if (Array.isArray(data)) {
    // Raw array of conversations
    conversationsArray = data;
  } else if (data.conversations && Array.isArray(data.conversations)) {
    // Standard format: { conversations: [...] }
    conversationsArray = data.conversations;
  } else if (data.chats && Array.isArray(data.chats)) {
    // Alternative format: { chats: [...] }
    conversationsArray = data.chats;
  } else {
    // Try to find any array property that looks like conversations
    const arrayProps = Object.keys(data).filter((k) => Array.isArray(data[k]));
    if (arrayProps.length === 1) {
      conversationsArray = data[arrayProps[0]];
    } else {
      throw new Error(
        `Invalid Claude.ai export format: could not find conversations array. ` +
        `Found keys: ${Object.keys(data).join(', ')}`
      );
    }
  }

  const conversations: StoredConversation[] = [];
  const messages: StoredMessage[] = [];
  const now = new Date();

  for (const conv of conversationsArray) {
    try {
      const { conversation, convMessages } = parseConversation(conv, now);
      conversations.push(conversation);
      messages.push(...convMessages);
    } catch (err) {
      // Skip malformed conversations but continue parsing
      console.warn('Skipping malformed conversation:', err);
    }
  }

  if (conversations.length === 0) {
    throw new Error('No valid conversations found in export');
  }

  return { conversations, messages };
}

function parseConversation(
  conv: ClaudeAIConversation,
  importedAt: Date
): { conversation: StoredConversation; convMessages: StoredMessage[] } {
  const convMessages: StoredMessage[] = [];
  const textParts: string[] = [conv.name || ''];

  let userMessageCount = 0;
  let assistantMessageCount = 0;

  // Handle both chat_messages and messages arrays
  const messagesArray = conv.chat_messages || (conv as unknown as { messages: ClaudeAIMessage[] }).messages || [];

  for (const msg of messagesArray) {
    const sender = msg.sender === 'human' ? 'user' : 'assistant';

    if (sender === 'user') {
      userMessageCount++;
    } else {
      assistantMessageCount++;
    }

    // Extract text and content blocks from message
    const { text: messageText, contentBlocks } = extractMessageContent(msg);
    textParts.push(messageText);

    convMessages.push({
      id: msg.uuid,
      conversationId: conv.uuid,
      sender,
      text: messageText,
      contentBlocks: contentBlocks.length > 0 ? contentBlocks : undefined,
      conversationName: conv.name || 'Untitled Conversation',
      createdAt: new Date(msg.created_at),
    });
  }

  const fullText = textParts.join(' ');

  const conversation: StoredConversation = {
    id: conv.uuid,
    source: 'claude.ai',
    name: conv.name || 'Untitled Conversation',
    summary: conv.summary || null,
    createdAt: new Date(conv.created_at),
    updatedAt: new Date(conv.updated_at),
    importedAt,
    messageCount: convMessages.length,
    userMessageCount,
    assistantMessageCount,
    estimatedTokens: estimateTokens(fullText),
    fullText,
  };

  return { conversation, convMessages };
}

interface RawContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  language?: string;
  // Artifact fields
  name?: string;
  title?: string;
  content?: string;
  artifact_type?: string;
  // Tool fields
  id?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
}

interface ExtractedContent {
  text: string;
  contentBlocks: ContentBlock[];
}

function extractMessageContent(msg: ClaudeAIMessage): ExtractedContent {
  const contentBlocks: ContentBlock[] = [];
  const textParts: string[] = [];

  // Check for files array (Claude artifacts)
  const rawMsg = msg as unknown as Record<string, unknown>;
  const files = rawMsg.files as Array<{
    file_name?: string;
    file_type?: string;
    content?: string;
    extracted_content?: string;
  }> | undefined;

  if (files && files.length > 0) {
    for (const file of files) {
      const content = file.content || file.extracted_content;
      const fileName = file.file_name || 'Artifact';

      if (content) {
        // File has content - render it
        const fileType = file.file_type || '';
        const isCode = /\.(js|ts|tsx|jsx|py|rb|go|rs|java|cpp|c|h|css|html|json|yaml|yml|xml|sql|sh|bash)$/i.test(fileName);

        if (isCode) {
          const ext = fileName.split('.').pop() || '';
          contentBlocks.push({
            type: 'code',
            language: ext,
            text: content,
          });
        } else {
          contentBlocks.push({
            type: 'artifact',
            artifactTitle: fileName,
            artifactType: fileType || 'text/plain',
            text: content,
          });
        }
        textParts.push(content);
      } else if (fileName && fileName !== 'paste.txt') {
        // File exists but no content exported - show as unavailable artifact
        contentBlocks.push({
          type: 'artifact',
          artifactTitle: fileName,
          text: '', // Empty - will show as unavailable
        });
      }
    }
  }

  // Check for attachments (user uploads)
  if (msg.attachments && msg.attachments.length > 0) {
    for (const attachment of msg.attachments) {
      if (attachment.extracted_content) {
        const isMarkdown = attachment.file_name?.endsWith('.md') ||
                          attachment.file_type?.includes('markdown');
        const isCode = attachment.file_type?.includes('text/') ||
                      /\.(js|ts|tsx|jsx|py|rb|go|rs|java|cpp|c|h|css|html|json|yaml|yml|xml|sql|sh|bash)$/i.test(attachment.file_name || '');

        if (isCode && !isMarkdown) {
          const ext = attachment.file_name?.split('.').pop() || '';
          contentBlocks.push({
            type: 'code',
            language: ext,
            text: attachment.extracted_content,
          });
        } else {
          contentBlocks.push({
            type: 'artifact',
            artifactTitle: attachment.file_name || 'Attachment',
            artifactType: attachment.file_type || 'text/markdown',
            text: attachment.extracted_content,
          });
        }
        textParts.push(attachment.extracted_content);
      }
    }
  }

  // If text field is populated, parse for code blocks
  if (msg.text && msg.text.trim()) {
    const parsed = parseTextForCodeBlocks(msg.text);
    contentBlocks.push(...parsed);
    textParts.push(msg.text);
  }

  // Also extract from content array (newer format)
  const content = (msg as unknown as { content?: RawContentBlock[] }).content;
  if (content && Array.isArray(content)) {
    for (const block of content) {
      if (block.type === 'text' && block.text) {
        // Check if this text block contains markdown code blocks
        const parsed = parseTextForCodeBlocks(block.text);
        contentBlocks.push(...parsed);
        textParts.push(block.text);
      } else if (block.type === 'thinking' && block.thinking) {
        // Capture full thinking block (not truncated)
        contentBlocks.push({
          type: 'thinking',
          text: block.thinking,
        });
        textParts.push(block.thinking);
      } else if (block.type === 'tool_use') {
        // Handle tool use blocks
        const toolBlock = block as unknown as {
          name?: string;
          id?: string;
          input?: Record<string, unknown>;
        };
        contentBlocks.push({
          type: 'tool_use',
          toolName: toolBlock.name || 'Tool',
          toolInput: toolBlock.input,
        });
      } else if (block.type === 'tool_result') {
        // Handle tool result blocks
        const resultBlock = block as unknown as {
          tool_use_id?: string;
          content?: string | Array<{ type: string; text?: string }>;
        };
        let resultText = '';
        if (typeof resultBlock.content === 'string') {
          resultText = resultBlock.content;
        } else if (Array.isArray(resultBlock.content)) {
          resultText = resultBlock.content
            .filter(c => c.type === 'text' && c.text)
            .map(c => c.text)
            .join('\n');
        }
        if (resultText) {
          contentBlocks.push({
            type: 'tool_result',
            toolResult: resultText,
          });
          textParts.push(resultText);
        }
      } else if (block.type === 'artifact') {
        // Handle artifact blocks directly in content array
        const artifactContent = block.content || block.text || '';
        if (artifactContent) {
          contentBlocks.push({
            type: 'artifact',
            artifactTitle: block.title || block.name || 'Artifact',
            artifactType: block.artifact_type || 'text/plain',
            text: artifactContent,
          });
          textParts.push(artifactContent);
        }
      }
    }
  }

  return {
    text: textParts.join('\n'),
    contentBlocks,
  };
}

// Patterns for unsupported block placeholders from Claude.ai exports
const UNSUPPORTED_PATTERNS = [
  /This block is not supported on your current device yet\.?/gi,
  /\[(?:File|Image|Attachment):?\s*[^\]]*\]/gi,
];

function isUnsupportedPlaceholder(text: string): boolean {
  const trimmed = text.trim();
  return UNSUPPORTED_PATTERNS.some(pattern => pattern.test(trimmed));
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
        const block = createTextOrUnsupportedBlock(textBefore);
        if (block) blocks.push(block);
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
      const block = createTextOrUnsupportedBlock(remainingText);
      if (block) blocks.push(block);
    }
  }

  // If no code blocks found, return single text block
  if (blocks.length === 0 && text.trim()) {
    const block = createTextOrUnsupportedBlock(text.trim());
    if (block) blocks.push(block);
  }

  return blocks;
}

function createTextOrUnsupportedBlock(text: string): ContentBlock | null {
  // Check if entire text is just unsupported placeholder
  if (isUnsupportedPlaceholder(text)) {
    return { type: 'unsupported', text };
  }

  // Filter out unsupported placeholders from within text
  let filtered = text;
  for (const pattern of UNSUPPORTED_PATTERNS) {
    filtered = filtered.replace(pattern, '').trim();
  }

  if (!filtered) return null;
  return { type: 'text', text: filtered };
}

export function isClaudeAIZip(file: File): boolean {
  return file.type === 'application/zip' || file.name.endsWith('.zip');
}

export function isClaudeAIJSON(file: File): boolean {
  return file.type === 'application/json' || file.name.endsWith('.json');
}

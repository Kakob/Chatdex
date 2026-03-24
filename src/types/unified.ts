// Unified data model for both Claude.ai and Claude Code

export type DataSource = 'claude.ai' | 'claude-code';

// Content block types for structured message rendering
export type ContentBlockType = 'text' | 'code' | 'thinking' | 'tool_use' | 'tool_result' | 'artifact' | 'unsupported';

export interface ContentBlock {
  type: ContentBlockType;
  text?: string;
  // Code blocks
  language?: string;
  // Tool blocks
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolResult?: string;
  // Artifact blocks
  artifactTitle?: string;
  artifactType?: string;
}

export interface StoredConversation {
  id: string;
  source: DataSource;
  name: string;
  summary: string | null;
  createdAt: Date;
  updatedAt: Date;
  importedAt: Date;
  messageCount: number;
  userMessageCount: number;
  assistantMessageCount: number;
  estimatedTokens: number;
  fullText: string;
  // Claude Code specific
  projectPath?: string;
  gitBranch?: string;
  workingDirectory?: string;
}

export type MessageSender = 'user' | 'assistant' | 'system' | 'tool';

export interface StoredMessage {
  id: string;
  conversationId: string;
  sender: MessageSender;
  text: string;                    // Keep for search/backward compat
  contentBlocks?: ContentBlock[];  // Structured blocks for rendering
  conversationName?: string;
  createdAt: Date;
  // Tool use (Claude Code) - kept for backward compat
  toolName?: string;
  toolInput?: string;
  toolResult?: string;
}

export interface StoredPrompt {
  id: string;
  title: string;
  content: string;
  description: string;
  folder: string | null;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
  usageCount: number;
}

// Tags
export type EntityType = 'prompt' | 'conversation' | 'anchor' | 'thread';

export interface Tag {
  id: string;
  name: string;
  color: string | null;
  category: EntityType | null;
  usageCount: number;
  createdAt: Date;
}

export interface EntityTag {
  id: string;
  tagId: string;
  entityId: string;
  entityType: EntityType;
  createdAt: Date;
}

export interface AppMetadata {
  key: string;
  value: unknown;
}

// Metadata keys
export type MetadataKey =
  | 'lastSync.claude.ai'
  | 'lastSync.claude-code'
  | 'stats.totalConversations'
  | 'stats.totalMessages'
  | 'license.key'
  | 'license.validatedAt'
  | 'settings.theme';

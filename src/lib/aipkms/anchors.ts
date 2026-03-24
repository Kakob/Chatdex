// Anchor management utilities
import type { AnchoredItem, ContentType, KnowledgeType, Priority } from './types';

export interface CreateAnchorInput {
  contentType: ContentType;
  userPrompt?: string;
  claudeResponse?: string;
  selectedText?: string;
  conversationId: string;
  conversationUrl?: string;
  messageIndex: number;
  tags?: string[];
  annotation?: string;
  priority?: Priority;
  knowledgeType?: KnowledgeType;
  workspaceId?: string;
}

export function createAnchor(input: CreateAnchorInput): AnchoredItem {
  const now = new Date();
  return {
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    contentType: input.contentType,
    userPrompt: input.userPrompt || '',
    claudeResponse: input.claudeResponse || '',
    selectedText: input.selectedText || null,
    conversationId: input.conversationId,
    conversationUrl: input.conversationUrl || null,
    messageIndex: input.messageIndex,
    tags: input.tags || [],
    annotation: input.annotation || null,
    priority: input.priority || 'medium',
    knowledgeType: input.knowledgeType || null,
    workspaceId: input.workspaceId || null,
    autoTags: [],
    relatedItemIds: [],
  };
}

export function createAnchorFromSelection(
  conversationId: string,
  messageIndex: number,
  selectedText: string,
  claudeResponse: string
): AnchoredItem {
  return createAnchor({
    contentType: 'selection',
    selectedText,
    claudeResponse,
    conversationId,
    messageIndex,
  });
}

export function createAnchorFromPromptPair(
  conversationId: string,
  messageIndex: number,
  userPrompt: string,
  claudeResponse: string
): AnchoredItem {
  return createAnchor({
    contentType: 'prompt_response_pair',
    userPrompt,
    claudeResponse,
    conversationId,
    messageIndex,
  });
}

export function updateAnchor(
  anchor: AnchoredItem,
  updates: Partial<Pick<AnchoredItem, 'tags' | 'annotation' | 'priority' | 'knowledgeType' | 'workspaceId'>>
): AnchoredItem {
  return {
    ...anchor,
    ...updates,
    updatedAt: new Date(),
  };
}

export function filterAnchorsByConversation(anchors: AnchoredItem[], conversationId: string): AnchoredItem[] {
  return anchors.filter((a) => a.conversationId === conversationId);
}

export function filterAnchorsByTag(anchors: AnchoredItem[], tagName: string): AnchoredItem[] {
  return anchors.filter((a) => a.tags.includes(tagName));
}

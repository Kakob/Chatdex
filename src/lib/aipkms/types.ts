// AIPKMS data model types and validators
// Based on PRD: docs/prd-aipkms.md Section 3.1

export type ContentType = 'full_response' | 'selection' | 'prompt_response_pair';
export type Priority = 'low' | 'medium' | 'high';
export type SynthesisDocumentType = 'study_guide' | 'decision_log' | 'reference_sheet' | 'retrospective' | 'custom';

export interface AnchoredItem {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  contentType: ContentType;
  userPrompt: string;
  claudeResponse: string;
  selectedText: string | null;
  conversationId: string;
  conversationUrl: string | null;
  messageId: string | null;
  messageIndex: number;
  tags: string[];
  annotation: string | null;
  priority: Priority;
  workspaceId: string | null;
  folder: string | null;
  autoTags: string[];
  relatedItemIds: string[];
}

export interface Thread {
  id: string;
  name: string;
  description: string | null;
  workspaceId: string | null;
  itemIds: string[];
  isLiving: boolean;
  livingCriteria: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Workspace {
  id: string;
  name: string;
  description: string | null;
  isArchived: boolean;
  createdAt: Date;
}

export interface SynthesisDocument {
  id: string;
  threadId: string | null;
  sourceItemIds: string[];
  documentType: SynthesisDocumentType;
  content: string;
  format: 'markdown' | 'plaintext';
  createdAt: Date;
}

// Validators

const CONTENT_TYPES: ContentType[] = ['full_response', 'selection', 'prompt_response_pair'];
const PRIORITIES: Priority[] = ['low', 'medium', 'high'];

export function isValidContentType(value: string): value is ContentType {
  return CONTENT_TYPES.includes(value as ContentType);
}

export function isValidPriority(value: string): value is Priority {
  return PRIORITIES.includes(value as Priority);
}

export interface ValidationError {
  field: string;
  message: string;
}

export function validateAnchoredItem(item: Partial<AnchoredItem>): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!item.contentType || !isValidContentType(item.contentType)) {
    errors.push({ field: 'contentType', message: 'Valid content type is required' });
  }
  if (!item.userPrompt && !item.claudeResponse) {
    errors.push({ field: 'content', message: 'Either userPrompt or claudeResponse is required' });
  }
  if (!item.conversationId) {
    errors.push({ field: 'conversationId', message: 'Conversation ID is required' });
  }

  return errors;
}

export function validateThread(thread: Partial<Thread>): ValidationError[] {
  const errors: ValidationError[] = [];
  if (!thread.name?.trim()) {
    errors.push({ field: 'name', message: 'Thread name is required' });
  }
  return errors;
}

export function validateWorkspace(workspace: Partial<Workspace>): ValidationError[] {
  const errors: ValidationError[] = [];
  if (!workspace.name?.trim()) {
    errors.push({ field: 'name', message: 'Workspace name is required' });
  }
  return errors;
}

export function validateSynthesisDocument(doc: Partial<SynthesisDocument>): ValidationError[] {
  const errors: ValidationError[] = [];
  if (!doc.content) {
    errors.push({ field: 'content', message: 'Content is required' });
  }
  if (!doc.documentType) {
    errors.push({ field: 'documentType', message: 'Document type is required' });
  }
  return errors;
}

// Synthesis engine helpers
import type { AnchoredItem, SynthesisDocument, SynthesisDocumentType } from './types';

const DOC_TYPE_PROMPTS: Record<SynthesisDocumentType, string> = {
  study_guide: 'Create a comprehensive study guide from the following knowledge items. Organize by topic with clear explanations.',
  decision_log: 'Create a decision log from the following items. For each decision, include context, options considered, and rationale.',
  reference_sheet: 'Create a concise reference sheet from the following items. Use bullet points and code snippets where appropriate.',
  retrospective: 'Create a project retrospective from the following items. Include timeline, key decisions, lessons learned, and outcomes.',
  custom: 'Synthesize the following knowledge items into a coherent document.',
};

export function buildSynthesisPrompt(
  items: AnchoredItem[],
  documentType: SynthesisDocumentType,
  customInstructions?: string
): string {
  const instruction = customInstructions || DOC_TYPE_PROMPTS[documentType];

  const itemsText = items
    .map((item, i) => {
      const parts = [`## Source ${i + 1}`];
      if (item.annotation) parts.push(`**Note:** ${item.annotation}`);
      if (item.tags.length > 0) parts.push(`**Tags:** ${item.tags.join(', ')}`);
      if (item.userPrompt) parts.push(`**User:** ${item.userPrompt}`);
      if (item.claudeResponse) parts.push(`**Claude:** ${item.claudeResponse}`);
      if (item.selectedText) parts.push(`**Selected:** ${item.selectedText}`);
      return parts.join('\n');
    })
    .join('\n\n---\n\n');

  return `${instruction}\n\n${itemsText}`;
}

export function formatSynthesisAsMarkdown(
  content: string,
  sourceItems: AnchoredItem[]
): string {
  const attribution = sourceItems
    .map((item, i) => `${i + 1}. ${item.annotation || item.tags[0] || `Item ${item.id.slice(0, 8)}`} (from conversation ${item.conversationId.slice(0, 8)})`)
    .join('\n');

  return `${content}\n\n---\n\n### Sources\n\n${attribution}`;
}

export function formatSynthesisAsPlaintext(markdownContent: string): string {
  return markdownContent
    .replace(/#{1,6}\s*/g, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/`(.*?)`/g, '$1')
    .replace(/---/g, '---')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
}

export function createSynthesisDocument(
  content: string,
  documentType: SynthesisDocumentType,
  sourceItemIds: string[],
  threadId?: string
): SynthesisDocument {
  return {
    id: crypto.randomUUID(),
    threadId: threadId || null,
    sourceItemIds,
    documentType,
    content,
    format: 'markdown',
    createdAt: new Date(),
  };
}

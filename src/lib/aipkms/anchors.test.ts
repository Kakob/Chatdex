import { describe, it, expect } from 'vitest';
import {
  createAnchor,
  createAnchorFromSelection,
  createAnchorFromPromptPair,
  updateAnchor,
  filterAnchorsByConversation,
  filterAnchorsByTag,
} from './anchors';

describe('createAnchor', () => {
  it('generates UUID and timestamps', () => {
    const anchor = createAnchor({
      contentType: 'full_response',
      claudeResponse: 'Hello',
      conversationId: 'conv-1',
      messageIndex: 0,
    });
    expect(anchor.id).toBeDefined();
    expect(anchor.createdAt).toBeInstanceOf(Date);
    expect(anchor.updatedAt).toBeInstanceOf(Date);
  });

  it('captures conversation context', () => {
    const anchor = createAnchor({
      contentType: 'full_response',
      claudeResponse: 'Hello',
      conversationId: 'conv-1',
      messageIndex: 3,
    });
    expect(anchor.conversationId).toBe('conv-1');
    expect(anchor.messageIndex).toBe(3);
  });

  it('defaults priority to medium', () => {
    const anchor = createAnchor({
      contentType: 'full_response',
      claudeResponse: 'x',
      conversationId: 'c',
      messageIndex: 0,
    });
    expect(anchor.priority).toBe('medium');
  });

  it('accepts optional fields', () => {
    const anchor = createAnchor({
      contentType: 'full_response',
      claudeResponse: 'x',
      conversationId: 'c',
      messageIndex: 0,
      tags: ['react', 'hooks'],
      annotation: 'Important pattern',
      knowledgeType: 'code_pattern',
    });
    expect(anchor.tags).toEqual(['react', 'hooks']);
    expect(anchor.annotation).toBe('Important pattern');
    expect(anchor.knowledgeType).toBe('code_pattern');
  });
});

describe('createAnchorFromSelection', () => {
  it('sets content_type to selection and stores selected_text', () => {
    const anchor = createAnchorFromSelection('conv-1', 2, 'selected part', 'full response');
    expect(anchor.contentType).toBe('selection');
    expect(anchor.selectedText).toBe('selected part');
    expect(anchor.claudeResponse).toBe('full response');
  });
});

describe('createAnchorFromPromptPair', () => {
  it('sets content_type to prompt_response_pair and stores both', () => {
    const anchor = createAnchorFromPromptPair('conv-1', 2, 'user q', 'claude a');
    expect(anchor.contentType).toBe('prompt_response_pair');
    expect(anchor.userPrompt).toBe('user q');
    expect(anchor.claudeResponse).toBe('claude a');
  });
});

describe('updateAnchor', () => {
  it('merges partial updates without overwriting unmodified fields', () => {
    const anchor = createAnchor({
      contentType: 'full_response',
      claudeResponse: 'Hello',
      conversationId: 'conv-1',
      messageIndex: 0,
      tags: ['react'],
    });
    const updated = updateAnchor(anchor, { annotation: 'New note' });
    expect(updated.annotation).toBe('New note');
    expect(updated.tags).toEqual(['react']); // unchanged
    expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(anchor.updatedAt.getTime());
  });
});

describe('filterAnchorsByConversation', () => {
  it('filters by conversationId', () => {
    const anchors = [
      createAnchor({ contentType: 'full_response', claudeResponse: 'a', conversationId: 'c1', messageIndex: 0 }),
      createAnchor({ contentType: 'full_response', claudeResponse: 'b', conversationId: 'c2', messageIndex: 0 }),
      createAnchor({ contentType: 'full_response', claudeResponse: 'c', conversationId: 'c1', messageIndex: 1 }),
    ];
    expect(filterAnchorsByConversation(anchors, 'c1')).toHaveLength(2);
  });
});

describe('filterAnchorsByTag', () => {
  it('filters by tag name', () => {
    const anchors = [
      createAnchor({ contentType: 'full_response', claudeResponse: 'a', conversationId: 'c1', messageIndex: 0, tags: ['react'] }),
      createAnchor({ contentType: 'full_response', claudeResponse: 'b', conversationId: 'c1', messageIndex: 1, tags: ['vue'] }),
    ];
    expect(filterAnchorsByTag(anchors, 'react')).toHaveLength(1);
  });
});

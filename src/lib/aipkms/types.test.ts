import { describe, it, expect } from 'vitest';
import {
  isValidContentType,
  isValidKnowledgeType,
  isValidPriority,
  validateAnchoredItem,
  validateThread,
  validateWorkspace,
  validateSynthesisDocument,
} from './types';

describe('isValidContentType', () => {
  it.each(['full_response', 'selection', 'prompt_response_pair'])('accepts %s', (val) => {
    expect(isValidContentType(val)).toBe(true);
  });

  it('rejects invalid values', () => {
    expect(isValidContentType('invalid')).toBe(false);
    expect(isValidContentType('')).toBe(false);
  });
});

describe('isValidKnowledgeType', () => {
  const validTypes = [
    'code_pattern', 'architecture_decision', 'explanation', 'creative_idea',
    'study_material', 'action_item', 'reference', 'debug_solution',
  ];

  it.each(validTypes)('accepts %s', (val) => {
    expect(isValidKnowledgeType(val)).toBe(true);
  });

  it('rejects invalid values', () => {
    expect(isValidKnowledgeType('random')).toBe(false);
  });
});

describe('isValidPriority', () => {
  it.each(['low', 'medium', 'high'])('accepts %s', (val) => {
    expect(isValidPriority(val)).toBe(true);
  });

  it('rejects invalid values', () => {
    expect(isValidPriority('urgent')).toBe(false);
  });
});

describe('validateAnchoredItem', () => {
  it('returns errors for missing required fields', () => {
    const errors = validateAnchoredItem({});
    expect(errors.length).toBeGreaterThanOrEqual(2);
    expect(errors.some((e) => e.field === 'contentType')).toBe(true);
    expect(errors.some((e) => e.field === 'conversationId')).toBe(true);
  });

  it('returns error when neither userPrompt nor claudeResponse provided', () => {
    const errors = validateAnchoredItem({ contentType: 'full_response', conversationId: 'c1' });
    expect(errors.some((e) => e.field === 'content')).toBe(true);
  });

  it('passes for complete valid item', () => {
    const errors = validateAnchoredItem({
      contentType: 'full_response',
      claudeResponse: 'Hello',
      conversationId: 'c1',
    });
    expect(errors).toHaveLength(0);
  });
});

describe('validateThread', () => {
  it('requires name', () => {
    const errors = validateThread({});
    expect(errors.some((e) => e.field === 'name')).toBe(true);
  });

  it('passes with name', () => {
    expect(validateThread({ name: 'My Thread' })).toHaveLength(0);
  });
});

describe('validateWorkspace', () => {
  it('requires name', () => {
    expect(validateWorkspace({}).length).toBeGreaterThan(0);
  });

  it('passes with name', () => {
    expect(validateWorkspace({ name: 'Project X' })).toHaveLength(0);
  });
});

describe('validateSynthesisDocument', () => {
  it('requires content and documentType', () => {
    const errors = validateSynthesisDocument({});
    expect(errors.some((e) => e.field === 'content')).toBe(true);
    expect(errors.some((e) => e.field === 'documentType')).toBe(true);
  });

  it('passes with both fields', () => {
    expect(validateSynthesisDocument({ content: 'text', documentType: 'study_guide' })).toHaveLength(0);
  });
});

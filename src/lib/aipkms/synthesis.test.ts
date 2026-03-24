import { describe, it, expect } from 'vitest';
import {
  buildSynthesisPrompt,
  formatSynthesisAsMarkdown,
  formatSynthesisAsPlaintext,
  createSynthesisDocument,
} from './synthesis';
import { createAnchor } from './anchors';

const makeTestAnchor = (override?: { annotation?: string; tags?: string[]; userPrompt?: string }) =>
  createAnchor({
    contentType: 'full_response',
    claudeResponse: 'Claude said this',
    conversationId: 'conv-1',
    messageIndex: 0,
    tags: override?.tags || ['react'],
    annotation: override?.annotation,
    ...(override?.userPrompt ? { userPrompt: override.userPrompt } : {}),
  });

describe('buildSynthesisPrompt', () => {
  it('includes all source item contents', () => {
    const items = [
      makeTestAnchor({ annotation: 'First item' }),
      makeTestAnchor({ annotation: 'Second item' }),
    ];
    const prompt = buildSynthesisPrompt(items, 'study_guide');
    expect(prompt).toContain('Source 1');
    expect(prompt).toContain('Source 2');
    expect(prompt).toContain('Claude said this');
  });

  it('respects document_type for instruction', () => {
    const items = [makeTestAnchor()];
    const studyGuide = buildSynthesisPrompt(items, 'study_guide');
    const decisionLog = buildSynthesisPrompt(items, 'decision_log');
    expect(studyGuide).toContain('study guide');
    expect(decisionLog).toContain('decision log');
  });

  it('includes source attribution metadata', () => {
    const items = [makeTestAnchor({ tags: ['react', 'hooks'], annotation: 'Key pattern' })];
    const prompt = buildSynthesisPrompt(items, 'reference_sheet');
    expect(prompt).toContain('react, hooks');
    expect(prompt).toContain('Key pattern');
  });
});

describe('formatSynthesisAsMarkdown', () => {
  it('produces markdown with sources section', () => {
    const items = [makeTestAnchor({ annotation: 'My note' })];
    const result = formatSynthesisAsMarkdown('# Summary\n\nContent here', items);
    expect(result).toContain('### Sources');
    expect(result).toContain('My note');
  });
});

describe('formatSynthesisAsPlaintext', () => {
  it('strips markdown formatting', () => {
    const result = formatSynthesisAsPlaintext('## Heading\n\n**bold** and *italic* and `code`');
    expect(result).not.toContain('##');
    expect(result).not.toContain('**');
    expect(result).not.toContain('`');
    expect(result).toContain('bold');
    expect(result).toContain('italic');
    expect(result).toContain('code');
  });
});

describe('createSynthesisDocument', () => {
  it('stores source_item_ids for attribution', () => {
    const doc = createSynthesisDocument(
      'Synthesized content',
      'study_guide',
      ['item-1', 'item-2'],
      'thread-1'
    );
    expect(doc.sourceItemIds).toEqual(['item-1', 'item-2']);
    expect(doc.threadId).toBe('thread-1');
    expect(doc.documentType).toBe('study_guide');
    expect(doc.format).toBe('markdown');
    expect(doc.id).toBeDefined();
  });
});

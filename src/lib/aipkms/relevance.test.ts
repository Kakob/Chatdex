import { describe, it, expect } from 'vitest';
import { scoreRelevance, rankByRelevance, detectTopicTags } from './relevance';
import { createAnchor } from './anchors';

const makeAnchorWithTags = (tags: string[], priority: 'low' | 'medium' | 'high' = 'medium') =>
  createAnchor({
    contentType: 'full_response',
    claudeResponse: 'test',
    conversationId: 'c1',
    messageIndex: 0,
    tags,
    priority,
  });

describe('scoreRelevance', () => {
  it('returns value in 0.0-1.0 range', () => {
    const item = makeAnchorWithTags(['react']);
    const score = scoreRelevance(item, { queryTags: ['react'] });
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('boosts score for exact tag matches', () => {
    const item = makeAnchorWithTags(['react', 'hooks']);
    const withMatch = scoreRelevance(item, { queryTags: ['react'] });
    const noMatch = scoreRelevance(item, { queryTags: ['vue'] });
    expect(withMatch).toBeGreaterThan(noMatch);
  });

  it('gives higher score to high-priority items', () => {
    const high = makeAnchorWithTags([], 'high');
    const low = makeAnchorWithTags([], 'low');
    const ctx = { queryTags: [] };
    expect(scoreRelevance(high, ctx)).toBeGreaterThan(scoreRelevance(low, ctx));
  });

  it('gives same-conversation boost', () => {
    const item = makeAnchorWithTags([]);
    const sameConv = scoreRelevance(item, { queryTags: [], currentConversationId: 'c1' });
    const diffConv = scoreRelevance(item, { queryTags: [], currentConversationId: 'c99' });
    expect(sameConv).toBeGreaterThan(diffConv);
  });
});

describe('rankByRelevance', () => {
  it('returns items sorted descending by score', () => {
    const items = [
      makeAnchorWithTags([], 'low'),
      makeAnchorWithTags(['react'], 'high'),
      makeAnchorWithTags([], 'medium'),
    ];
    const ranked = rankByRelevance(items, { queryTags: ['react'] });
    // The item with tag match + high priority should be first
    expect(ranked[0].tags).toContain('react');
  });

  it('respects limit parameter', () => {
    const items = [
      makeAnchorWithTags(['a']),
      makeAnchorWithTags(['b']),
      makeAnchorWithTags(['c']),
    ];
    const ranked = rankByRelevance(items, { queryTags: ['a'] }, 2);
    expect(ranked).toHaveLength(2);
  });
});

describe('detectTopicTags', () => {
  it('extracts keyword-based tags from text', () => {
    const tags = detectTopicTags('React hooks are great for state management in React applications');
    expect(tags).toContain('react');
    expect(tags.length).toBeGreaterThan(0);
    expect(tags.length).toBeLessThanOrEqual(5);
  });

  it('filters out stop words', () => {
    const tags = detectTopicTags('the quick brown fox jumps over the lazy dog');
    expect(tags).not.toContain('the');
    expect(tags).not.toContain('over');
  });

  it('returns at most 5 tags', () => {
    const tags = detectTopicTags(
      'typescript javascript python rust golang ruby elixir kotlin swift dart'
    );
    expect(tags.length).toBeLessThanOrEqual(5);
  });
});

// Knowledge resurfacing relevance scoring
import type { AnchoredItem } from './types';

export interface RelevanceContext {
  queryTags: string[];
  queryText?: string;
  currentConversationId?: string;
}

export function scoreRelevance(item: AnchoredItem, context: RelevanceContext): number {
  let score = 0;
  const maxScore = 1.0;

  // Tag matching (up to 0.4)
  if (context.queryTags.length > 0) {
    const allTags = [...item.tags, ...item.autoTags];
    const exactMatches = context.queryTags.filter((t) => allTags.includes(t)).length;
    const tagScore = Math.min(exactMatches / context.queryTags.length, 1.0) * 0.4;
    score += tagScore;
  }

  // Priority boost (up to 0.2)
  const priorityWeights = { high: 0.2, medium: 0.1, low: 0.05 };
  score += priorityWeights[item.priority] || 0;

  // Recency bias (up to 0.2) — items from last 30 days get full credit
  const daysSinceCreation = (Date.now() - item.createdAt.getTime()) / (1000 * 60 * 60 * 24);
  const recencyScore = Math.max(0, 1 - daysSinceCreation / 180) * 0.2;
  score += recencyScore;

  // Same conversation boost (0.2)
  if (context.currentConversationId && item.conversationId === context.currentConversationId) {
    score += 0.2;
  }

  return Math.min(score, maxScore);
}

export function rankByRelevance(
  items: AnchoredItem[],
  context: RelevanceContext,
  limit?: number
): AnchoredItem[] {
  const scored = items
    .map((item) => ({ item, score: scoreRelevance(item, context) }))
    .sort((a, b) => b.score - a.score);

  const result = scored.map((s) => s.item);
  return limit ? result.slice(0, limit) : result;
}

export function detectTopicTags(text: string): string[] {
  // Simple keyword extraction — upgrade to embeddings in Phase 4C
  const stopWords = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for',
    'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'about',
    'over', 'and', 'but', 'or', 'not', 'no', 'if', 'then', 'so', 'than', 'that',
    'this', 'it', 'i', 'you', 'he', 'she', 'we', 'they', 'my', 'your',
    'what', 'how', 'when', 'where', 'why', 'which', 'who',
  ]);

  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stopWords.has(w));

  // Count frequency
  const freq = new Map<string, number>();
  for (const w of words) {
    freq.set(w, (freq.get(w) || 0) + 1);
  }

  // Return top 5 by frequency
  return Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([word]) => word);
}

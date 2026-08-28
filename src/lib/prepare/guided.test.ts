// SPEC-change-workspace §13 Guided helpers: pure symbol/path derivation and bounded local lookups.
import { beforeEach, describe, expect, it } from 'vitest';
import { bulkPutConversations, bulkPutMessages, clearAllData, putUnderstandingProject } from '../db';
import { putProjectAssociation } from '../db/understanding';
import { basename, findRelatedConversations, symbolFromLabel } from './guided';

const now = new Date('2026-08-28T00:00:00Z');

beforeEach(async () => {
  await clearAllData();
});

describe('symbolFromLabel / basename', () => {
  it('picks the identifier a node label names', () => {
    expect(symbolFromLabel('router.push')).toBe('push');
    expect(symbolFromLabel('handleResultClick')).toBe('handleResultClick');
    expect(symbolFromLabel('the ConversationsPage component')).toBe('component');
    expect(symbolFromLabel('???')).toBeNull();
    expect(symbolFromLabel('a')).toBeNull();
    expect(basename('src/pages/SearchPage.tsx')).toBe('SearchPage');
    expect(basename('README')).toBe('README');
  });
});

describe('findRelatedConversations', () => {
  it('searches only associated conversations, counts hits, and deep-links the first message', async () => {
    await putUnderstandingProject({ id: 'p1', name: 'Chatdex', origin: 'user', reviewState: 'accepted', createdAt: now, updatedAt: now });
    await bulkPutConversations([
      { id: 'c-in', source: 'claude-code', name: 'in project', summary: null, createdAt: now, updatedAt: now, importedAt: now, messageCount: 2, userMessageCount: 2, assistantMessageCount: 0, estimatedTokens: 5, fullText: 'scrollTo scrollTo' },
      { id: 'c-out', source: 'claude.ai', name: 'other project', summary: null, createdAt: now, updatedAt: now, importedAt: now, messageCount: 1, userMessageCount: 1, assistantMessageCount: 0, estimatedTokens: 5, fullText: 'scrollTo' },
      { id: 'c-rejected', source: 'claude.ai', name: 'rejected', summary: null, createdAt: now, updatedAt: now, importedAt: now, messageCount: 1, userMessageCount: 1, assistantMessageCount: 0, estimatedTokens: 5, fullText: 'scrollTo' },
    ]);
    await bulkPutMessages([
      { id: 'm1', conversationId: 'c-in', sender: 'user', text: 'nothing here', createdAt: now },
      { id: 'm2', conversationId: 'c-in', sender: 'user', text: 'ScrollTo appears; scrollTo twice', createdAt: new Date(now.getTime() + 1) },
      { id: 'm3', conversationId: 'c-out', sender: 'user', text: 'scrollTo', createdAt: now },
      { id: 'm4', conversationId: 'c-rejected', sender: 'user', text: 'scrollTo', createdAt: now },
    ]);
    await putProjectAssociation({ id: 'a1', projectId: 'p1', conversationId: 'c-in', confidence: 1, origin: 'user', reviewState: 'accepted', createdAt: now, updatedAt: now });
    await putProjectAssociation({ id: 'a2', projectId: 'p1', conversationId: 'c-rejected', confidence: 1, origin: 'user', reviewState: 'rejected', createdAt: now, updatedAt: now });

    const result = await findRelatedConversations('p1', 'scrollto');
    expect(result.related).toEqual([{ conversationId: 'c-in', name: 'in project', source: 'claude-code', hits: 2, firstMessageId: 'm2' }]);
    expect(result.scanned).toBe(1);
    expect((await findRelatedConversations('p1', '   ')).related).toEqual([]);
  });
});

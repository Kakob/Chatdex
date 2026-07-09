import { describe, it, expect, beforeEach } from 'vitest';
import {
  db,
  putConversation,
  getConversation,
  getConversations,
  deleteConversation,
  deleteConversationsBySource,
  putMessage,
  bulkPutMessages,
  getMessagesForConversation,
  addActivity,
  getActivities,
  putAnchor,
  listAnchors,
  getAnchorsByConversation,
  deleteAnchor,
  putTag,
  listTags,
  tagEntity,
  getEntityTags,
  untagEntity,
  createFolder,
  listFolders,
  deleteFolder,
  getDailyStats,
  updateDailyStats,
  getMetadata,
  setMetadata,
  clearAllData,
  findLegacyClaudeCodeImports,
  deleteLegacyClaudeCodeImports,
} from './index';
import type { StoredConversation, StoredMessage, StoredActivity, Tag } from '../../types';
import type { AnchoredItem } from '../aipkms/types';

beforeEach(async () => {
  await clearAllData();
});

function makeConv(overrides: Partial<StoredConversation> = {}): StoredConversation {
  const now = new Date('2026-01-01T00:00:00Z');
  return {
    id: crypto.randomUUID(),
    source: 'claude.ai',
    name: 'Test conversation',
    summary: null,
    createdAt: now,
    updatedAt: now,
    importedAt: now,
    messageCount: 0,
    userMessageCount: 0,
    assistantMessageCount: 0,
    estimatedTokens: 0,
    fullText: '',
    ...overrides,
  };
}

function makeMsg(conversationId: string, overrides: Partial<StoredMessage> = {}): StoredMessage {
  return {
    id: crypto.randomUUID(),
    conversationId,
    sender: 'user',
    text: 'hello',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function makeAnchor(overrides: Partial<AnchoredItem> = {}): AnchoredItem {
  const now = new Date('2026-01-01T00:00:00Z');
  return {
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    contentType: 'full_response',
    userPrompt: '',
    claudeResponse: 'response text',
    selectedText: null,
    conversationId: 'conv-1',
    conversationUrl: null,
    messageId: null,
    messageIndex: 0,
    tags: [],
    annotation: null,
    priority: 'medium',
    workspaceId: null,
    folder: null,
    autoTags: [],
    relatedItemIds: [],
    ...overrides,
  };
}

describe('conversations', () => {
  it('round-trips a conversation', async () => {
    const conv = makeConv({ name: 'Round-trip' });
    await putConversation(conv);
    const fetched = await getConversation(conv.id);
    expect(fetched?.name).toBe('Round-trip');
    expect(fetched?.createdAt).toBeInstanceOf(Date);
  });

  it('lists conversations sorted by updatedAt desc', async () => {
    const older = makeConv({ updatedAt: new Date('2026-01-01T00:00:00Z') });
    const newer = makeConv({ updatedAt: new Date('2026-02-01T00:00:00Z') });
    await putConversation(older);
    await putConversation(newer);
    const list = await getConversations();
    expect(list).toHaveLength(2);
    expect(list[0].id).toBe(newer.id);
  });

  it('filters by source', async () => {
    await putConversation(makeConv({ source: 'claude.ai' }));
    await putConversation(makeConv({ source: 'claude-code' }));
    const code = await getConversations({ source: 'claude-code' });
    expect(code).toHaveLength(1);
    expect(code[0].source).toBe('claude-code');
  });

  it('paginates with limit + offset', async () => {
    for (let i = 0; i < 5; i++) {
      await putConversation(
        makeConv({
          name: `c${i}`,
          updatedAt: new Date(`2026-01-0${i + 1}T00:00:00Z`),
        })
      );
    }
    const page = await getConversations({ limit: 2, offset: 1 });
    expect(page).toHaveLength(2);
  });

  it('cascades delete to messages and anchors', async () => {
    const conv = makeConv();
    await putConversation(conv);
    await bulkPutMessages([makeMsg(conv.id), makeMsg(conv.id)]);
    await putAnchor(makeAnchor({ conversationId: conv.id }));

    await deleteConversation(conv.id);

    expect(await getConversation(conv.id)).toBeUndefined();
    expect(await getMessagesForConversation(conv.id)).toHaveLength(0);
    expect(await getAnchorsByConversation(conv.id)).toHaveLength(0);
  });

  it('deleteConversationsBySource removes only that source', async () => {
    const a = makeConv({ source: 'claude.ai' });
    const b = makeConv({ source: 'claude-code' });
    await putConversation(a);
    await putConversation(b);
    await deleteConversationsBySource('claude.ai');
    expect(await db.conversations.count()).toBe(1);
    expect((await getConversation(b.id))?.source).toBe('claude-code');
  });
});

describe('messages', () => {
  it('returns messages ordered by createdAt for a conversation', async () => {
    const cid = 'conv-1';
    const m1 = makeMsg(cid, { createdAt: new Date('2026-01-02T00:00:00Z') });
    const m2 = makeMsg(cid, { createdAt: new Date('2026-01-01T00:00:00Z') });
    await putMessage(m1);
    await putMessage(m2);
    const out = await getMessagesForConversation(cid);
    expect(out).toHaveLength(2);
    expect(out[0].id).toBe(m2.id);
    expect(out[1].id).toBe(m1.id);
  });
});

describe('activities', () => {
  function makeActivity(overrides: Partial<StoredActivity> = {}): StoredActivity {
    return {
      id: crypto.randomUUID(),
      type: 'message_sent',
      source: 'claude.ai',
      conversationId: 'c1',
      conversationTitle: 'Title',
      model: 'claude-sonnet-4-6',
      timestamp: new Date('2026-01-01T00:00:00Z'),
      tokens: null,
      metadata: {},
      ...overrides,
    };
  }

  it('filters by type and source', async () => {
    await addActivity(makeActivity({ type: 'message_sent', source: 'claude.ai' }));
    await addActivity(makeActivity({ type: 'tool_use', source: 'extension' }));
    const got = await getActivities({ types: ['tool_use'] });
    expect(got).toHaveLength(1);
    expect(got[0].type).toBe('tool_use');
  });

  it('client-side search matches metadata previews', async () => {
    await addActivity(
      makeActivity({ metadata: { messagePreview: 'something about React' } })
    );
    await addActivity(makeActivity({ metadata: { messagePreview: 'about Vue' } }));
    const got = await getActivities({ search: 'react' });
    expect(got).toHaveLength(1);
  });

  it('orders by timestamp desc', async () => {
    const older = makeActivity({ timestamp: new Date('2026-01-01T00:00:00Z') });
    const newer = makeActivity({ timestamp: new Date('2026-02-01T00:00:00Z') });
    await addActivity(older);
    await addActivity(newer);
    const got = await getActivities();
    expect(got[0].id).toBe(newer.id);
  });
});

describe('anchors', () => {
  it('lists anchors filtered by search across content fields', async () => {
    await putAnchor(makeAnchor({ claudeResponse: 'about kubernetes' }));
    await putAnchor(makeAnchor({ userPrompt: 'tell me about react' }));
    await putAnchor(makeAnchor({ annotation: 'kubernetes notes' }));

    const r = await listAnchors({ search: 'kubernetes' });
    expect(r.total).toBe(2);
  });

  it('filters by conversationId and folder', async () => {
    await putAnchor(makeAnchor({ conversationId: 'c1', folder: 'work' }));
    await putAnchor(makeAnchor({ conversationId: 'c2', folder: 'personal' }));

    const r = await listAnchors({ folder: 'work' });
    expect(r.total).toBe(1);
    expect(r.data[0].folder).toBe('work');
  });

  it('cascades delete', async () => {
    const a = makeAnchor();
    await putAnchor(a);
    await deleteAnchor(a.id);
    const r = await listAnchors();
    expect(r.total).toBe(0);
  });
});

describe('tags', () => {
  function makeTag(overrides: Partial<Tag> = {}): Tag {
    return {
      id: crypto.randomUUID(),
      name: `tag-${Math.random().toString(36).slice(2, 7)}`,
      color: null,
      category: null,
      usageCount: 0,
      createdAt: new Date(),
      ...overrides,
    };
  }

  it('tagging an entity is idempotent and bumps usageCount once', async () => {
    const t = makeTag({ name: 'react' });
    await putTag(t);
    await tagEntity(t.id, 'entity-1', 'conversation');
    await tagEntity(t.id, 'entity-1', 'conversation');
    const after = await db.tags.get(t.id);
    expect(after?.usageCount).toBe(1);
  });

  it('untag decrements usageCount and removes link', async () => {
    const t = makeTag({ name: 'go' });
    await putTag(t);
    await tagEntity(t.id, 'entity-1', 'conversation');
    await untagEntity(t.id, 'entity-1', 'conversation');
    const after = await db.tags.get(t.id);
    expect(after?.usageCount).toBe(0);
    expect(await getEntityTags('conversation', 'entity-1')).toHaveLength(0);
  });

  it('listTags filters by category and search query', async () => {
    await putTag(makeTag({ name: 'frontend', category: 'conversation' }));
    await putTag(makeTag({ name: 'backend', category: 'anchor' }));
    const a = await listTags(undefined, 'conversation');
    expect(a).toHaveLength(1);
    const b = await listTags('back');
    expect(b).toHaveLength(1);
    expect(b[0].name).toBe('backend');
  });

  it('getEntityTags resolves linked tags', async () => {
    const t1 = makeTag({ name: 'a' });
    const t2 = makeTag({ name: 'b' });
    await putTag(t1);
    await putTag(t2);
    await tagEntity(t1.id, 'e1', 'anchor');
    await tagEntity(t2.id, 'e1', 'anchor');
    const tags = await getEntityTags('anchor', 'e1');
    expect(tags).toHaveLength(2);
  });
});

describe('folders', () => {
  it('createFolder is idempotent on name', async () => {
    await createFolder('Inbox');
    await createFolder('Inbox');
    const list = await listFolders();
    expect(list).toEqual(['Inbox']);
  });

  it('deleteFolder unsets folder on anchors that referenced it', async () => {
    await createFolder('Project X');
    const a = makeAnchor({ folder: 'Project X' });
    await putAnchor(a);
    await deleteFolder('Project X');
    const after = await db.anchors.get(a.id);
    expect(after?.folder).toBeNull();
    expect(await listFolders()).toEqual([]);
  });
});

describe('dailyStats', () => {
  it('updateDailyStats inserts a new row when missing', async () => {
    await updateDailyStats('2026-01-01', { inputTokens: 100, outputTokens: 200 });
    const got = await getDailyStats('2026-01-01', '2026-01-01');
    expect(got).toHaveLength(1);
    expect(got[0].inputTokens).toBe(100);
    expect(got[0].outputTokens).toBe(200);
  });

  it('updateDailyStats merges into existing row', async () => {
    await updateDailyStats('2026-01-01', { inputTokens: 100 });
    await updateDailyStats('2026-01-01', { outputTokens: 50 });
    const got = await getDailyStats('2026-01-01', '2026-01-01');
    expect(got[0].inputTokens).toBe(100);
    expect(got[0].outputTokens).toBe(50);
  });

  it('getDailyStats returns inclusive range', async () => {
    await updateDailyStats('2026-01-01', { messageCount: 1 });
    await updateDailyStats('2026-01-02', { messageCount: 2 });
    await updateDailyStats('2026-01-05', { messageCount: 5 });
    const range = await getDailyStats('2026-01-01', '2026-01-02');
    expect(range).toHaveLength(2);
  });
});

describe('metadata', () => {
  it('round-trips arbitrary JSON values', async () => {
    await setMetadata('settings.theme', 'dark');
    await setMetadata('stats.totalMessages', 42);
    await setMetadata('license.payload', { tier: 'pro', exp: 999 });
    expect(await getMetadata('settings.theme')).toBe('dark');
    expect(await getMetadata('stats.totalMessages')).toBe(42);
    expect(await getMetadata('license.payload')).toEqual({ tier: 'pro', exp: 999 });
  });

  it('returns undefined for unknown key', async () => {
    expect(await getMetadata('not-set')).toBeUndefined();
  });
});

describe('clearAllData', () => {
  it('wipes every table', async () => {
    await putConversation(makeConv());
    await addActivity({
      id: crypto.randomUUID(),
      type: 'message_sent',
      source: 'claude.ai',
      conversationId: null,
      conversationTitle: null,
      model: null,
      timestamp: new Date(),
      tokens: null,
      metadata: {},
    });
    await setMetadata('k', 'v');
    await clearAllData();
    expect(await db.conversations.count()).toBe(0);
    expect(await db.activities.count()).toBe(0);
    expect(await getMetadata('k')).toBeUndefined();
  });
});

describe('legacy claude-code import cleanup', () => {
  it('finds only claude-code conversations without a projectPath', async () => {
    const fossil = makeConv({ source: 'claude-code', name: 'agent a0c09c84', projectPath: undefined });
    const good = makeConv({ source: 'claude-code', projectPath: '/Users/x/dev/proj' });
    const webChat = makeConv({ source: 'claude.ai' }); // no projectPath, but not claude-code
    await putConversation(fossil);
    await putConversation(good);
    await putConversation(webChat);

    const legacy = await findLegacyClaudeCodeImports();
    expect(legacy.map((c) => c.id)).toEqual([fossil.id]);
  });

  it('deletes fossils with full cascade and leaves everything else', async () => {
    const fossil = makeConv({ source: 'claude-code', projectPath: undefined });
    const good = makeConv({ source: 'claude-code', projectPath: '/Users/x/dev/proj' });
    await putConversation(fossil);
    await putConversation(good);
    await bulkPutMessages([makeMsg(fossil.id), makeMsg(good.id)]);

    const deleted = await deleteLegacyClaudeCodeImports();

    expect(deleted).toBe(1);
    expect(await getConversation(fossil.id)).toBeUndefined();
    expect(await getMessagesForConversation(fossil.id)).toEqual([]);
    expect(await getConversation(good.id)).toBeDefined();
    expect((await getMessagesForConversation(good.id)).length).toBe(1);
  });
});

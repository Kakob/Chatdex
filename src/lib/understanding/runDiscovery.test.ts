import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildDisclosure, runDiscoveryInBatches } from './runDiscovery';
import type { StoredConversation, DataSource } from '../../types';

vi.mock('./discovery', () => ({ discoverProjects: vi.fn() }));

import { discoverProjects } from './discovery';
const discoverMock = vi.mocked(discoverProjects);

beforeEach(() => {
  discoverMock.mockReset();
});

function conv(source: DataSource, id = crypto.randomUUID()): StoredConversation {
  const now = new Date('2026-08-01T00:00:00Z');
  return {
    id,
    source,
    name: 'c',
    summary: null,
    createdAt: now,
    updatedAt: now,
    importedAt: now,
    messageCount: 1,
    userMessageCount: 1,
    assistantMessageCount: 0,
    estimatedTokens: 10,
    fullText: 'text',
  };
}

const emptyResult = {
  projectsCreated: 0,
  projectsMatched: 0,
  associationsCreated: 0,
  associationsSkipped: 0,
  objectsCreated: 0,
  warnings: [] as string[],
};

describe('buildDisclosure', () => {
  it('counts conversations per source, largest first', () => {
    const d = buildDisclosure(
      [conv('chatgpt'), conv('claude.ai'), conv('chatgpt')],
      'openai'
    );
    expect(d.totalConversations).toBe(3);
    expect(d.bySource).toEqual([
      { source: 'chatgpt', count: 2 },
      { source: 'claude.ai', count: 1 },
    ]);
  });

  it('flags sources going to a non-native provider', () => {
    const d = buildDisclosure([conv('chatgpt'), conv('claude-code')], 'anthropic');
    expect(d.crossProviderSources).toEqual(['chatgpt']);
    expect(d.providerLabel).toBeTruthy();
  });

  it('reports no cross-provider sources when everything is native', () => {
    const d = buildDisclosure([conv('claude.ai'), conv('claude-code')], 'anthropic');
    expect(d.crossProviderSources).toEqual([]);
  });
});

describe('runDiscoveryInBatches', () => {
  it('splits into batches and aggregates results', async () => {
    discoverMock.mockResolvedValue({ ...emptyResult, projectsCreated: 1, warnings: ['w'] });
    const conversations = [conv('claude.ai'), conv('claude.ai'), conv('claude.ai')];
    const progress: Array<[number, number]> = [];

    const outcome = await runDiscoveryInBatches(
      conversations,
      { provider: 'anthropic' },
      { batchSize: 2, onProgress: (d, t) => progress.push([d, t]) }
    );

    expect(discoverMock).toHaveBeenCalledTimes(2);
    expect(discoverMock.mock.calls[0][0]).toHaveLength(2);
    expect(discoverMock.mock.calls[1][0]).toHaveLength(1);
    expect(outcome).toMatchObject({
      projectsCreated: 2,
      batchesRun: 2,
      batchesTotal: 2,
      warnings: ['w', 'w'],
    });
    expect(progress).toEqual([
      [1, 2],
      [2, 2],
    ]);
  });

  it('stops at the first failing batch, keeping earlier results', async () => {
    discoverMock
      .mockResolvedValueOnce({ ...emptyResult, associationsCreated: 3 })
      .mockRejectedValueOnce(new Error('relay down'));

    const conversations = [conv('claude.ai'), conv('claude.ai'), conv('claude.ai')];
    const outcome = await runDiscoveryInBatches(
      conversations,
      { provider: 'anthropic' },
      { batchSize: 1 }
    );

    expect(discoverMock).toHaveBeenCalledTimes(2);
    expect(outcome.associationsCreated).toBe(3);
    expect(outcome.batchesRun).toBe(1);
    expect(outcome.batchesTotal).toBe(3);
    expect(outcome.warnings[0]).toMatch(/Stopped after batch 1 of 3: relay down/);
  });

  it('handles an empty conversation list without calling the provider', async () => {
    const outcome = await runDiscoveryInBatches([], { provider: 'anthropic' });
    expect(discoverMock).not.toHaveBeenCalled();
    expect(outcome.batchesTotal).toBe(0);
  });
});

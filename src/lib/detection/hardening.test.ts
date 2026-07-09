import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  db,
  clearAllData,
  bulkPutConversations,
  bulkPutMessages,
  putConversation,
} from '../db';
import { parseClaudeCodeContent } from '../parsers/claude-code';
import { buildTrace, toolCall, toolResult, userMsg } from '../../../tests/golden-traces/fixture-builder';
import { analyzeConversation, setStoredConfigOverrides } from './autoAnalyze';
import { computeObservabilityStats } from './stats';
import { findStaleSessions } from './staleness';
import { useFindingsStore } from '../../stores/findingsStore';
import type { StoredConversation } from '../../types/unified';

const GOLDEN_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../tests/golden-traces'
);

async function seedMixedSession(): Promise<string> {
  const jsonl = readFileSync(join(GOLDEN_DIR, 'mixed-session.jsonl'), 'utf-8');
  const parsed = parseClaudeCodeContent(jsonl, 'mixed-session.jsonl');
  await bulkPutConversations(parsed.conversations);
  await bulkPutMessages(parsed.messages);
  return parsed.conversations[0].id;
}

beforeEach(async () => {
  await clearAllData();
  useFindingsStore.setState({
    findingsByConversation: {},
    runCountByConversation: {},
    analyzingStage: {},
    selectedFindingId: null,
  });
});

// Issue #1 regression: re-analysis with changed config must not stack
// old + new findings in the UI or double-count on the dashboard.
describe('latest-run display filtering (issue #1)', () => {
  it('the store shows only the latest run after a config change', async () => {
    const sessionId = await seedMixedSession();
    await analyzeConversation(sessionId);
    await useFindingsStore.getState().loadFindings(sessionId);
    expect(useFindingsStore.getState().findingsByConversation[sessionId]).toHaveLength(3);

    // Loop threshold 4: the 3x npm test loop no longer fires.
    await setStoredConfigOverrides({ loop: { repeatThreshold: 4 } });
    await analyzeConversation(sessionId);
    await useFindingsStore.getState().loadFindings(sessionId);

    const visible = useFindingsStore.getState().findingsByConversation[sessionId];
    expect(visible).toHaveLength(2);
    expect(visible.map((f) => f.detector).sort()).toEqual([
      'silent_reversion',
      'verification_absence',
    ]);
    // Storage keeps both runs' findings — auditability intact.
    expect(await db.findings.count()).toBe(5);
    expect(await db.detectorRuns.count()).toBe(2);
  });

  it('dashboard stats count only the latest run per conversation', async () => {
    const sessionId = await seedMixedSession();
    await analyzeConversation(sessionId);
    await setStoredConfigOverrides({ loop: { repeatThreshold: 4 } });
    await analyzeConversation(sessionId);

    const stats = await computeObservabilityStats();
    expect(stats.totalFindings).toBe(2);
    expect(stats.detectorHealth.map((d) => d.detector).sort()).toEqual([
      'silent_reversion',
      'verification_absence',
    ]);
  });
});

describe('graceful degradation', () => {
  it('counts unknown tools on the run and aggregates them in stats', async () => {
    const trace = buildTrace({ sessionId: 'unknown-tools' }, [
      userMsg('do a thing'),
      toolCall('MysteryTool', { target: 'x' }),
      toolResult('MysteryTool', 'ok'),
      toolCall('MysteryTool', { target: 'y' }),
      toolResult('MysteryTool', 'ok'),
      toolCall('Read', { file_path: '/a.ts' }),
      toolResult('Read', 'content'),
    ]);
    const parsed = parseClaudeCodeContent(trace, 'unknown.jsonl');
    await bulkPutConversations(parsed.conversations);
    await bulkPutMessages(parsed.messages);

    const result = await analyzeConversation('unknown-tools');
    expect(result.run?.unknownToolCounts).toEqual({ MysteryTool: 2 });

    const stats = await computeObservabilityStats();
    expect(stats.unknownTools).toEqual({ MysteryTool: 2 });
  });

  it('analyzes partial and malformed traces without crashing', async () => {
    const clean = buildTrace({ sessionId: 'partial-session' }, [
      userMsg('start'),
      toolCall('Bash', { command: 'npm test' }), // no result follows
      toolResult('Grep', 'dangling result with no call'),
      toolCall('Edit', { file_path: '/a.ts' }), // missing new_string
    ]);
    const corrupted = clean + 'this is {not valid json\n';
    const parsed = parseClaudeCodeContent(corrupted, 'partial.jsonl');
    await bulkPutConversations(parsed.conversations);
    await bulkPutMessages(parsed.messages);

    const result = await analyzeConversation('partial-session');
    expect(result.skipped).toBe(false);
    expect(result.run?.errors).toBeUndefined();
  });

  it('analyzes an empty conversation without crashing', async () => {
    const conv: StoredConversation = {
      id: 'empty-session',
      source: 'claude-code',
      name: 'empty',
      summary: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      importedAt: new Date(),
      messageCount: 0,
      userMessageCount: 0,
      assistantMessageCount: 0,
      estimatedTokens: 0,
      fullText: '',
    };
    await putConversation(conv);
    const result = await analyzeConversation('empty-session');
    expect(result.skipped).toBe(false);
    expect(result.findings).toEqual([]);
  });
});

describe('stale-session detection (version bumps)', () => {
  it('reports never-analyzed and version-outdated sessions, then clears after re-analysis', async () => {
    const sessionId = await seedMixedSession();

    // Never analyzed yet.
    let report = await findStaleSessions();
    expect(report.neverAnalyzed).toEqual([sessionId]);
    expect(report.outdated).toEqual([]);

    await analyzeConversation(sessionId);
    report = await findStaleSessions();
    expect(report.neverAnalyzed).toEqual([]);
    expect(report.outdated).toEqual([]);

    // Simulate a version bump: rewrite the latest run's recorded versions.
    const run = (await db.detectorRuns.toArray())[0];
    await db.detectorRuns.put({
      ...run,
      detectorVersions: { ...run.detectorVersions, loop: '0.9.0' },
    });
    report = await findStaleSessions();
    expect(report.outdated).toEqual([sessionId]);
  });
});

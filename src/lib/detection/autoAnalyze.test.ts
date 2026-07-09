import { beforeEach, describe, expect, it } from 'vitest';
import { db, clearAllData, bulkPutConversations, bulkPutMessages } from '../db';
import { buildTrace, toolCall, toolResult, userMsg } from '../../../tests/golden-traces/fixture-builder';
import { parseClaudeCodeContent } from '../parsers/claude-code';
import {
  analyzeConversation,
  getStoredConfigOverrides,
  setStoredConfigOverrides,
} from './autoAnalyze';

// Two repeats of the same command: below the default loop threshold (N=3),
// above a configured N=2.
const TWO_REPEAT_TRACE = buildTrace({ sessionId: 'override-session' }, [
  userMsg('run it'),
  toolCall('Bash', { command: 'npm run flaky' }),
  toolResult('Bash', 'boom'),
  toolCall('Bash', { command: 'npm run flaky' }),
  toolResult('Bash', 'boom'),
]);

beforeEach(async () => {
  await clearAllData();
  const parsed = parseClaudeCodeContent(TWO_REPEAT_TRACE, 'override.jsonl');
  await bulkPutConversations(parsed.conversations);
  await bulkPutMessages(parsed.messages);
});

describe('analyzeConversation — stored config overrides (settings page)', () => {
  it('applies stored overrides to analysis and records them on the run', async () => {
    // Defaults: two repeats do not fire.
    const defaultRun = await analyzeConversation('override-session');
    expect(defaultRun.findings).toHaveLength(0);

    // Stored override N=2: re-analysis fires and is a NEW run (new runKey).
    await setStoredConfigOverrides({ loop: { repeatThreshold: 2 } });
    expect(await getStoredConfigOverrides()).toEqual({ loop: { repeatThreshold: 2 } });

    const overrideRun = await analyzeConversation('override-session');
    expect(overrideRun.skipped).toBe(false);
    expect(overrideRun.findings).toHaveLength(1);
    expect(overrideRun.findings[0].detector).toBe('loop');
    expect(overrideRun.run?.config.loop.repeatThreshold).toBe(2);

    // Both runs persist; findings from the first (empty) run untouched.
    expect(await db.detectorRuns.count()).toBe(2);
    expect(await db.findings.count()).toBe(1);
  });

  it('re-running under the same stored overrides stays idempotent', async () => {
    await setStoredConfigOverrides({ loop: { repeatThreshold: 2 } });
    await analyzeConversation('override-session');
    const second = await analyzeConversation('override-session');
    expect(second.skipped).toBe(true);
    expect(await db.findings.count()).toBe(1);
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db, clearAllData, bulkPutMessages, putConversation } from '../db';
import { generateMasterKey, encryptJSON, decryptJSON } from '../crypto';
import {
  envelopeFinding,
  rehydrateFinding,
  envelopeDetectorRun,
  rehydrateDetectorRun,
} from '../sync/serializer';
import type { StoredConversation, StoredMessage } from '../../types/unified';
import {
  clearDetectorRegistry,
  registerDetector,
  type Detector,
} from './registry';
import {
  analyzeSession,
  buildRunKey,
  computeDetectorRun,
} from './pipeline';
import { handleAnalyzeRequest, type WorkerResponse } from './workerHandler';

const SESSION_ID = 'session-under-test';

function makeConversation(id = SESSION_ID): StoredConversation {
  const now = new Date('2026-07-01T10:00:00Z');
  return {
    id,
    source: 'claude-code',
    name: 'test session',
    summary: null,
    createdAt: now,
    updatedAt: now,
    importedAt: now,
    messageCount: 0,
    userMessageCount: 0,
    assistantMessageCount: 0,
    estimatedTokens: 0,
    fullText: '',
  };
}

function makeMessages(conversationId: string, count: number): StoredMessage[] {
  const base = new Date('2026-07-01T10:00:00Z').getTime();
  return Array.from({ length: count }, (_, i) => {
    const createdAt = new Date(base + i * 1000);
    if (i % 2 === 0) {
      return {
        id: `${conversationId}-m${i}`,
        conversationId,
        sender: 'tool' as const,
        text: '[Tool: Bash]',
        contentBlocks: [
          {
            type: 'tool_use' as const,
            toolName: 'Bash',
            toolInput: { command: `echo step ${i}` },
          },
        ],
        createdAt,
      };
    }
    return {
      id: `${conversationId}-m${i}`,
      conversationId,
      sender: 'assistant' as const,
      text: `ok ${i}`,
      createdAt,
    };
  });
}

/** Stub detector: flags the first N steps, configurable severity. */
function makeStubDetector(overrides?: Partial<Detector>): Detector {
  return {
    id: 'stub',
    version: '1.0.0',
    defaultConfig: { severity: 'medium' },
    run: (session, config) =>
      session.steps.length === 0
        ? []
        : [
            {
              detector: 'stub',
              severity: config.severity as 'medium',
              stepRange: { start: 0, end: session.steps.length - 1 },
              summary: `stub saw ${session.steps.length} steps`,
              evidence: { stepCount: session.steps.length },
              suppressionsEvaluated: [
                { rule: 'stub-noop', fired: false },
              ],
            },
          ],
    ...overrides,
  };
}

beforeEach(async () => {
  await clearAllData();
  clearDetectorRegistry();
  registerDetector(makeStubDetector());
  await putConversation(makeConversation());
  await bulkPutMessages(makeMessages(SESSION_ID, 6));
});

afterEach(() => {
  clearDetectorRegistry();
});

describe('analyzeSession — persistence (acceptance: stub detector persists)', () => {
  it('persists findings and the DetectorRun to IndexedDB', async () => {
    const result = await analyzeSession(SESSION_ID);

    expect(result.skipped).toBe(false);
    expect(result.findings).toHaveLength(1);

    const storedFindings = await db.findings.toArray();
    const storedRuns = await db.detectorRuns.toArray();
    expect(storedFindings).toHaveLength(1);
    expect(storedRuns).toHaveLength(1);

    const finding = storedFindings[0];
    expect(finding.conversationId).toBe(SESSION_ID);
    expect(finding.runId).toBe(storedRuns[0].id);
    expect(finding.detector).toBe('stub');
    expect(finding.detectorVersion).toBe('1.0.0');
    expect(finding.userLabel).toBe('unset');
    expect(finding.stepRange).toEqual({ start: 0, end: 5 });
    expect(finding.suppressionsEvaluated).toEqual([{ rule: 'stub-noop', fired: false }]);

    const run = storedRuns[0];
    expect(run.detectorVersions).toEqual({ stub: '1.0.0' });
    expect(run.config).toEqual({ stub: { severity: 'medium' } });
    expect(run.findingsCount).toBe(1);
  });
});

describe('analyzeSession — idempotency (acceptance: no duplicates on re-run)', () => {
  it('is a no-op when re-run with identical versions and config', async () => {
    await analyzeSession(SESSION_ID);
    const second = await analyzeSession(SESSION_ID);

    expect(second.skipped).toBe(true);
    expect(await db.findings.count()).toBe(1);
    expect(await db.detectorRuns.count()).toBe(1);
  });

  it('creates a NEW run with new findings when config changes, leaving old findings intact', async () => {
    await analyzeSession(SESSION_ID);
    const rerun = await analyzeSession(SESSION_ID, { stub: { severity: 'high' } });

    expect(rerun.skipped).toBe(false);
    expect(await db.detectorRuns.count()).toBe(2);
    const findings = await db.findings.toArray();
    expect(findings).toHaveLength(2);
    expect(new Set(findings.map((f) => f.severity))).toEqual(new Set(['medium', 'high']));
  });

  it('creates a new run when the detector version bumps', async () => {
    await analyzeSession(SESSION_ID);
    clearDetectorRegistry();
    registerDetector(makeStubDetector({ version: '1.1.0' }));

    const rerun = await analyzeSession(SESSION_ID);
    expect(rerun.skipped).toBe(false);
    expect(await db.detectorRuns.count()).toBe(2);
    expect(await db.findings.count()).toBe(2);
  });

  it('buildRunKey is stable under config key order', () => {
    const a = buildRunKey('c1', { stub: '1.0.0' }, { stub: { n: 3, m: 10 } });
    const b = buildRunKey('c1', { stub: '1.0.0' }, { stub: { m: 10, n: 3 } });
    expect(a).toBe(b);
  });
});

describe('sync round-trip (acceptance: findings survive encryption/sync)', () => {
  it('finding: envelope → encrypt → decrypt → rehydrate is lossless', async () => {
    const { findings } = await analyzeSession(SESSION_ID);
    const key = await generateMasterKey();

    const env = envelopeFinding(findings[0]);
    const sealed = await encryptJSON(key, env.payload);
    const decrypted = await decryptJSON(key, sealed);
    expect(rehydrateFinding(decrypted)).toEqual(findings[0]);
    expect(env.parentId).toBe(SESSION_ID);
  });

  it('detector run: envelope → encrypt → decrypt → rehydrate is lossless', async () => {
    const { run } = await analyzeSession(SESSION_ID);
    const key = await generateMasterKey();

    const env = envelopeDetectorRun(run!);
    const sealed = await encryptJSON(key, env.payload);
    const decrypted = await decryptJSON(key, sealed);
    expect(rehydrateDetectorRun(decrypted)).toEqual(run);
  });
});

describe('worker handler — message protocol', () => {
  it('emits progress stages then a result', async () => {
    const responses: WorkerResponse[] = [];
    await handleAnalyzeRequest(
      { type: 'analyze', requestId: 'r1', sessionId: SESSION_ID },
      (r) => responses.push(r)
    );

    const stages = responses
      .filter((r) => r.type === 'progress')
      .map((r) => (r.type === 'progress' ? r.stage : ''));
    expect(stages).toEqual(['loading', 'normalizing', 'detecting']);

    const last = responses[responses.length - 1];
    expect(last.type).toBe('result');
    if (last.type === 'result') {
      expect(last.result.skipped).toBe(false);
      expect(last.result.findings).toHaveLength(1);
    }
    // Compute-only: the handler must not have persisted anything.
    expect(await db.findings.count()).toBe(0);
    expect(await db.detectorRuns.count()).toBe(0);
  });

  it('isolates a throwing detector: run completes, error recorded, others still find', async () => {
    clearDetectorRegistry();
    registerDetector(
      makeStubDetector({
        id: 'exploder',
        run: () => {
          throw new Error('detector exploded');
        },
      })
    );
    registerDetector(makeStubDetector());

    const responses: WorkerResponse[] = [];
    await handleAnalyzeRequest(
      { type: 'analyze', requestId: 'r2', sessionId: SESSION_ID },
      (r) => responses.push(r)
    );
    const last = responses[responses.length - 1];
    expect(last.type).toBe('result');
    if (last.type === 'result') {
      expect(last.result.run?.errors).toEqual({ exploder: 'detector exploded' });
      // The healthy detector's findings survive the neighbor's crash.
      expect(last.result.findings).toHaveLength(1);
      expect(last.result.findings[0].detector).toBe('stub');
    }
  });
});

describe('performance — synthetic 10k-step session', () => {
  it('computes a full pass in under 5 seconds', async () => {
    const bigId = 'big-session';
    await putConversation(makeConversation(bigId));
    await bulkPutMessages(makeMessages(bigId, 10_000));

    const started = performance.now();
    const result = await computeDetectorRun(bigId);
    const elapsed = performance.now() - started;

    expect(result.skipped).toBe(false);
    expect(result.findings[0].stepRange).toEqual({ start: 0, end: 9_999 });
    expect(elapsed).toBeLessThan(5_000);
  }, 20_000);
});

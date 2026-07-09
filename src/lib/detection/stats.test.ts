import { beforeEach, describe, expect, it } from 'vitest';
import {
  db,
  clearAllData,
  bulkPutConversations,
  bulkPutFindings,
  putDetectorRun,
} from '../db';
import { busiestSpan, computeObservabilityStats, weekStartOf } from './stats';
import type { StoredConversation } from '../../types/unified';
import type {
  FindingSeverity,
  StoredDetectorRun,
  StoredFinding,
  UserLabel,
} from '../../types/detection';

const DETECTORS = ['loop', 'verification_absence', 'silent_reversion'];
const PROJECTS = ['/home/u/alpha', '/home/u/beta', '/home/u/gamma'];
const SEVERITIES: FindingSeverity[] = ['info', 'low', 'medium', 'high'];
const LABELS: UserLabel[] = ['unset', 'confirmed', 'false_positive'];

function conv(i: number): StoredConversation {
  // Spread sessions across 8 ISO weeks starting 2026-05-04 (a Monday).
  const createdAt = new Date(Date.UTC(2026, 4, 4 + (i % 8) * 7, 12));
  return {
    id: `conv-${i}`,
    source: 'claude-code',
    name: `session ${i}`,
    summary: null,
    createdAt,
    updatedAt: createdAt,
    importedAt: createdAt,
    messageCount: 10,
    userMessageCount: 2,
    assistantMessageCount: 4,
    estimatedTokens: 100,
    fullText: '',
    projectPath: PROJECTS[i % PROJECTS.length],
  };
}

function finding(i: number, conversationId: string): StoredFinding {
  const now = new Date('2026-07-09T10:00:00Z');
  return {
    id: `finding-${conversationId}-${i}`,
    conversationId,
    runId: `run-${conversationId}`,
    detector: DETECTORS[i % DETECTORS.length],
    severity: SEVERITIES[i % SEVERITIES.length],
    stepRange: { start: i, end: i + 3 },
    summary: 'synthetic',
    evidence: {},
    suppressionsEvaluated: [],
    detectorVersion: '1.0.0',
    createdAt: now,
    updatedAt: now,
    userLabel: LABELS[i % LABELS.length],
  };
}

function run(conversationId: string): StoredDetectorRun {
  const now = new Date('2026-07-09T10:00:00Z');
  return {
    id: `run-${conversationId}`,
    conversationId,
    runKey: `key-${conversationId}`,
    detectorVersions: { loop: '1.0.0' },
    config: {},
    startedAt: now,
    finishedAt: now,
    findingsCount: 0,
  };
}

// Acceptance: dashboard numbers reconcile with raw finding counts over a
// corpus of 20+ analyzed sessions.
describe('computeObservabilityStats — reconciliation over a 24-session corpus', () => {
  beforeEach(async () => {
    await clearAllData();
    const conversations = Array.from({ length: 24 }, (_, i) => conv(i));
    await bulkPutConversations(conversations);
    const findings: StoredFinding[] = [];
    for (const [ci, c] of conversations.entries()) {
      await putDetectorRun(run(c.id));
      // 0-2 findings per session, varied across detectors/severities/labels.
      for (let f = 0; f < ci % 3; f++) findings.push(finding(ci + f, c.id));
    }
    await bulkPutFindings(findings);
  });

  it('totals reconcile with raw table counts', async () => {
    const stats = await computeObservabilityStats();
    expect(stats.totalFindings).toBe(await db.findings.count());
    expect(stats.analyzedSessionCount).toBe(24);

    const overTimeTotal = stats.findingsOverTime.reduce((sum, b) => sum + b.total, 0);
    const projectTotal = stats.perProject.reduce((sum, p) => sum + p.total, 0);
    const healthTotal = stats.detectorHealth.reduce((sum, d) => sum + d.total, 0);
    expect(overTimeTotal).toBe(stats.totalFindings);
    expect(projectTotal).toBe(stats.totalFindings);
    expect(healthTotal).toBe(stats.totalFindings);
  });

  it('buckets by the session date, not analysis date', async () => {
    const stats = await computeObservabilityStats();
    // All findings were created 2026-07-09, but sessions span May–June.
    expect(stats.findingsOverTime.length).toBeGreaterThan(1);
    for (const bucket of stats.findingsOverTime) {
      expect(bucket.weekStart < '2026-07-01').toBe(true);
    }
  });

  it('per-bucket group counts reconcile with bucket totals', async () => {
    const stats = await computeObservabilityStats();
    for (const bucket of stats.findingsOverTime) {
      const byDetector = Object.values(bucket.byDetector).reduce((a, b) => a + b, 0);
      const bySeverity = Object.values(bucket.bySeverity).reduce((a, b) => a + b, 0);
      expect(byDetector).toBe(bucket.total);
      expect(bySeverity).toBe(bucket.total);
    }
  });

  it('computes false-positive rate from labels only', async () => {
    const stats = await computeObservabilityStats();
    for (const d of stats.detectorHealth) {
      const raw = await db.findings.where('detector').equals(d.detector).toArray();
      const confirmed = raw.filter((f) => f.userLabel === 'confirmed').length;
      const fps = raw.filter((f) => f.userLabel === 'false_positive').length;
      expect(d.confirmed).toBe(confirmed);
      expect(d.falsePositives).toBe(fps);
      expect(d.falsePositiveRate).toBe(
        confirmed + fps > 0 ? fps / (confirmed + fps) : null
      );
    }
  });
});

describe('weekStartOf', () => {
  it('returns the Monday of the week', () => {
    expect(weekStartOf(new Date('2026-07-09T12:00:00Z'))).toBe('2026-07-06'); // Thursday
    expect(weekStartOf(new Date('2026-07-06T00:00:00Z'))).toBe('2026-07-06'); // Monday
    expect(weekStartOf(new Date('2026-07-12T23:00:00Z'))).toBe('2026-07-06'); // Sunday
  });
});

describe('busiestSpan', () => {
  const f = (start: number, end: number): StoredFinding =>
    ({ stepRange: { start, end } }) as StoredFinding;

  it('returns null with no findings', () => {
    expect(busiestSpan([])).toBeNull();
  });

  it('finds the range with the most overlapping findings', () => {
    const span = busiestSpan([f(0, 5), f(3, 10), f(4, 8), f(20, 22)]);
    expect(span).toEqual({ start: 0, end: 10, findingCount: 3 });
  });

  it('handles disjoint findings', () => {
    const span = busiestSpan([f(1, 2), f(10, 12)]);
    expect(span?.findingCount).toBe(1);
  });
});

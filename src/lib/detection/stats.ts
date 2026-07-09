// Observability dashboard aggregates (SPEC §5.2). Computed client-side from
// IndexedDB — findings joined to their conversations for session dates and
// project paths. Detector-agnostic: everything is grouped by whatever
// detector ids appear in the data.

import { db } from '../db';
import type { FindingSeverity, StoredFinding } from '../../types/detection';

export interface WeekBucket {
  /** ISO date of the bucket's Monday. */
  weekStart: string;
  total: number;
  byDetector: Record<string, number>;
  bySeverity: Partial<Record<FindingSeverity, number>>;
}

export interface ProjectBreakdown {
  project: string;
  total: number;
  byDetector: Record<string, number>;
  sessionCount: number;
}

export interface DetectorHealth {
  detector: string;
  total: number;
  confirmed: number;
  falsePositives: number;
  unlabeled: number;
  /** falsePositives / labeled; null until at least one label exists. */
  falsePositiveRate: number | null;
}

export interface ObservabilityStats {
  totalFindings: number;
  analyzedSessionCount: number;
  findingsOverTime: WeekBucket[];
  perProject: ProjectBreakdown[];
  detectorHealth: DetectorHealth[];
  /** Calls to tools outside the curated classifier mapping, across latest runs. */
  unknownTools: Record<string, number>;
}

/** Monday of the UTC week containing `date`, as YYYY-MM-DD. */
export function weekStartOf(date: Date): string {
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

export async function computeObservabilityStats(): Promise<ObservabilityStats> {
  const [allFindings, runs] = await Promise.all([
    db.findings.toArray(),
    db.detectorRuns.toArray(),
  ]);

  // Only each conversation's latest run counts (issue #1): older runs stay
  // stored for auditability but must not double-count here.
  const latestRunByConversation = new Map<string, string>();
  const latestFinishedAt = new Map<string, number>();
  const unknownTools: Record<string, number> = {};
  for (const run of runs) {
    const finished = run.finishedAt.getTime();
    if (finished >= (latestFinishedAt.get(run.conversationId) ?? -Infinity)) {
      latestFinishedAt.set(run.conversationId, finished);
      latestRunByConversation.set(run.conversationId, run.id);
    }
  }
  for (const run of runs) {
    if (latestRunByConversation.get(run.conversationId) !== run.id) continue;
    for (const [tool, count] of Object.entries(run.unknownToolCounts ?? {})) {
      unknownTools[tool] = (unknownTools[tool] ?? 0) + count;
    }
  }
  const findings = allFindings.filter((f) => {
    const latest = latestRunByConversation.get(f.conversationId);
    return latest === undefined || f.runId === latest;
  });

  const conversationIds = [...new Set(findings.map((f) => f.conversationId))];
  const conversations = await db.conversations.bulkGet(conversationIds);
  const convById = new Map(
    conversations.filter((c) => c !== undefined).map((c) => [c.id, c])
  );

  // Findings over time — bucketed by the SESSION's start date, not analysis
  // time, so bulk-importing history produces a real longitudinal view.
  const weekBuckets = new Map<string, WeekBucket>();
  const projects = new Map<string, ProjectBreakdown & { sessions: Set<string> }>();
  const health = new Map<string, DetectorHealth>();

  for (const finding of findings) {
    const conv = convById.get(finding.conversationId);
    const sessionDate = conv?.createdAt ?? finding.createdAt;

    const week = weekStartOf(sessionDate);
    const bucket =
      weekBuckets.get(week) ??
      ({ weekStart: week, total: 0, byDetector: {}, bySeverity: {} } as WeekBucket);
    bucket.total++;
    bucket.byDetector[finding.detector] = (bucket.byDetector[finding.detector] ?? 0) + 1;
    bucket.bySeverity[finding.severity] = (bucket.bySeverity[finding.severity] ?? 0) + 1;
    weekBuckets.set(week, bucket);

    const projectKey = conv?.projectPath ?? conv?.workingDirectory ?? '(unknown)';
    const project =
      projects.get(projectKey) ??
      ({ project: projectKey, total: 0, byDetector: {}, sessionCount: 0, sessions: new Set<string>() });
    project.total++;
    project.byDetector[finding.detector] = (project.byDetector[finding.detector] ?? 0) + 1;
    project.sessions.add(finding.conversationId);
    projects.set(projectKey, project);

    const detector =
      health.get(finding.detector) ??
      ({
        detector: finding.detector,
        total: 0,
        confirmed: 0,
        falsePositives: 0,
        unlabeled: 0,
        falsePositiveRate: null,
      } as DetectorHealth);
    detector.total++;
    if (finding.userLabel === 'confirmed') detector.confirmed++;
    else if (finding.userLabel === 'false_positive') detector.falsePositives++;
    else detector.unlabeled++;
    health.set(finding.detector, detector);
  }

  for (const detector of health.values()) {
    const labeled = detector.confirmed + detector.falsePositives;
    detector.falsePositiveRate = labeled > 0 ? detector.falsePositives / labeled : null;
  }

  return {
    totalFindings: findings.length,
    analyzedSessionCount: new Set(runs.map((r) => r.conversationId)).size,
    findingsOverTime: [...weekBuckets.values()].sort((a, b) =>
      a.weekStart.localeCompare(b.weekStart)
    ),
    perProject: [...projects.values()]
      .map(({ sessions, ...p }) => ({ ...p, sessionCount: sessions.size }))
      .sort((a, b) => b.total - a.total),
    detectorHealth: [...health.values()].sort((a, b) => b.total - a.total),
    unknownTools,
  };
}

export interface BusiestSpan {
  start: number;
  end: number;
  findingCount: number;
}

/**
 * Per-session report helper (SPEC §5.3): the step range where the most
 * finding ranges overlap — the session's "messiest" stretch.
 */
export function busiestSpan(findings: StoredFinding[]): BusiestSpan | null {
  if (findings.length === 0) return null;
  let best: StoredFinding[] = [];
  for (const candidate of findings) {
    const overlapping = findings.filter(
      (f) =>
        f.stepRange.start <= candidate.stepRange.end &&
        f.stepRange.end >= candidate.stepRange.start
    );
    if (overlapping.length > best.length) best = overlapping;
  }
  return {
    start: Math.min(...best.map((f) => f.stepRange.start)),
    end: Math.max(...best.map((f) => f.stepRange.end)),
    findingCount: best.length,
  };
}

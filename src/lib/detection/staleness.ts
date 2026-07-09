// Bulk re-analysis support for detector version bumps (IMPLEMENTATION_PLAN
// Phase 8). A session is stale when its latest run was produced by different
// detector versions than the current registry (or it was never analyzed).
// Config changes are handled separately by the settings-page re-analyze flow.

import { db } from '../db';
import { registerAllDetectors } from './registerAll';
import { getDetectors } from './registry';

export interface StaleReport {
  /** Claude Code sessions with no DetectorRun at all. */
  neverAnalyzed: string[];
  /** Sessions whose latest run used different detector versions. */
  outdated: string[];
}

export async function findStaleSessions(): Promise<StaleReport> {
  registerAllDetectors();
  const currentVersions: Record<string, string> = {};
  for (const detector of getDetectors()) {
    currentVersions[detector.id] = detector.version;
  }

  const [conversations, runs] = await Promise.all([
    db.conversations.where('source').equals('claude-code').toArray(),
    db.detectorRuns.toArray(),
  ]);

  const latestRun = new Map<string, (typeof runs)[number]>();
  for (const run of runs) {
    const existing = latestRun.get(run.conversationId);
    if (!existing || run.finishedAt.getTime() >= existing.finishedAt.getTime()) {
      latestRun.set(run.conversationId, run);
    }
  }

  const neverAnalyzed: string[] = [];
  const outdated: string[] = [];
  for (const conversation of conversations) {
    const run = latestRun.get(conversation.id);
    if (!run) {
      neverAnalyzed.push(conversation.id);
    } else if (!versionsMatch(run.detectorVersions, currentVersions)) {
      outdated.push(conversation.id);
    }
  }
  return { neverAnalyzed, outdated };
}

function versionsMatch(
  ran: Record<string, string>,
  current: Record<string, string>
): boolean {
  const keys = new Set([...Object.keys(ran), ...Object.keys(current)]);
  for (const key of keys) {
    if (ran[key] !== current[key]) return false;
  }
  return true;
}

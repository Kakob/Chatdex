// Detection pipeline orchestration (SPEC §4).
//
// Split into compute and persist halves because compute may run in a Web
// Worker while persistence must happen on the main thread — the sync engine's
// Dexie hooks only observe the main thread's db instance. Persistence is one
// batched transaction at run completion (IMPLEMENTATION_PLAN decisions log #3).

import { db } from '../db';
import { getMessagesForConversation } from '../db/messages';
import { getDetectorRunByKey } from '../db/detectorRuns';
import { generateId } from '../utils/ids';
import type {
  StoredDetectorRun,
  StoredFinding,
} from '../../types/detection';
import { normalizeSession, type NormalizedSession } from './normalize';
import { getDetectors, type DetectorConfig, type DetectorFinding } from './registry';

export type ConfigOverrides = Record<string, DetectorConfig>;

export type PipelineStage = 'loading' | 'normalizing' | 'detecting';

export interface PipelineProgress {
  stage: PipelineStage;
  detectorId?: string;
}

export interface PipelineResult {
  skipped: boolean;
  run: StoredDetectorRun | null;
  findings: StoredFinding[];
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const body = Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(',');
  return `{${body}}`;
}

export function buildRunKey(
  conversationId: string,
  detectorVersions: Record<string, string>,
  config: ConfigOverrides
): string {
  return stableStringify({ conversationId, detectorVersions, config });
}

function resolveConfigs(overrides?: ConfigOverrides): {
  detectorVersions: Record<string, string>;
  config: ConfigOverrides;
} {
  const detectorVersions: Record<string, string> = {};
  const config: ConfigOverrides = {};
  for (const detector of getDetectors()) {
    detectorVersions[detector.id] = detector.version;
    config[detector.id] = { ...detector.defaultConfig, ...overrides?.[detector.id] };
  }
  return { detectorVersions, config };
}

/**
 * Run all registered detectors over an already-normalized session. Pure
 * compute — no storage access. The golden-trace harness calls this directly.
 */
export function runDetectors(
  session: NormalizedSession,
  overrides?: ConfigOverrides,
  onProgress?: (progress: PipelineProgress) => void
): DetectorFinding[] {
  const { config } = resolveConfigs(overrides);
  const findings: DetectorFinding[] = [];
  for (const detector of getDetectors()) {
    onProgress?.({ stage: 'detecting', detectorId: detector.id });
    findings.push(...detector.run(session, config[detector.id]));
  }
  return findings;
}

/**
 * Load, normalize, and analyze one session. Reads storage but never writes.
 * Returns skipped=true when an identical run (same session, detector
 * versions, config) already exists — idempotency per SPEC §4.
 */
export async function computeDetectorRun(
  conversationId: string,
  overrides?: ConfigOverrides,
  onProgress?: (progress: PipelineProgress) => void
): Promise<PipelineResult> {
  const { detectorVersions, config } = resolveConfigs(overrides);
  const runKey = buildRunKey(conversationId, detectorVersions, config);

  const existing = await getDetectorRunByKey(runKey);
  if (existing) {
    return { skipped: true, run: existing, findings: [] };
  }

  const startedAt = new Date();
  onProgress?.({ stage: 'loading' });
  const messages = await getMessagesForConversation(conversationId);

  onProgress?.({ stage: 'normalizing' });
  const session = normalizeSession(conversationId, messages);

  const detectorFindings = runDetectors(session, overrides, onProgress);
  const finishedAt = new Date();

  const runId = generateId();
  const findings: StoredFinding[] = detectorFindings.map((f) => ({
    ...f,
    id: generateId(),
    conversationId,
    runId,
    detectorVersion: detectorVersions[f.detector],
    createdAt: finishedAt,
    updatedAt: finishedAt,
    userLabel: 'unset',
  }));

  const run: StoredDetectorRun = {
    id: runId,
    conversationId,
    runKey,
    detectorVersions,
    config,
    startedAt,
    finishedAt,
    findingsCount: findings.length,
  };

  return { skipped: false, run, findings };
}

/**
 * Persist a computed run and its findings in one batched transaction.
 * Main-thread only (sync hooks must observe these writes). Rechecks the
 * unique runKey inside the transaction so a concurrent duplicate is a no-op.
 */
export async function persistDetectorRun(result: PipelineResult): Promise<PipelineResult> {
  if (result.skipped || !result.run) return result;
  const { run, findings } = result;

  return db.transaction('rw', [db.detectorRuns, db.findings], async () => {
    const existing = await db.detectorRuns.where('runKey').equals(run.runKey).first();
    if (existing) {
      return { skipped: true, run: existing, findings: [] };
    }
    await db.detectorRuns.add(run);
    if (findings.length > 0) await db.findings.bulkAdd(findings);
    return result;
  });
}

/** Compute + persist. The non-worker path (tests, ingest hook). */
export async function analyzeSession(
  conversationId: string,
  overrides?: ConfigOverrides,
  onProgress?: (progress: PipelineProgress) => void
): Promise<PipelineResult> {
  const computed = await computeDetectorRun(conversationId, overrides, onProgress);
  return persistDetectorRun(computed);
}

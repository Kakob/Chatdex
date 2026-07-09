// Detector registry (SPEC §4). Adding a detector must require zero changes
// outside registering it here — the pipeline, storage, and UI are
// detector-agnostic and driven by this registry.

import type {
  FindingSeverity,
  StepRange,
  SuppressionOutcome,
} from '../../types/detection';
import type { NormalizedSession } from './normalize';

export type DetectorConfig = Record<string, unknown>;

/**
 * What a detector emits. The pipeline fills in identity, run linkage, and
 * timestamps to produce a StoredFinding.
 */
export interface DetectorFinding {
  detector: string;
  severity: FindingSeverity;
  stepRange: StepRange;
  summary: string;
  evidence: unknown;
  suppressionsEvaluated: SuppressionOutcome[];
}

export interface Detector<C extends DetectorConfig = DetectorConfig> {
  id: string;
  /** Semver; bump on ANY behavior change — findings are immutable per version. */
  version: string;
  defaultConfig: C;
  run(session: NormalizedSession, config: C): DetectorFinding[];
}

const detectors = new Map<string, Detector>();

export function registerDetector(detector: Detector): void {
  if (detectors.has(detector.id)) {
    throw new Error(`Detector "${detector.id}" is already registered`);
  }
  detectors.set(detector.id, detector);
}

export function getDetectors(): Detector[] {
  return [...detectors.values()];
}

export function getDetector(id: string): Detector | undefined {
  return detectors.get(id);
}

/** Test helper — production code registers once at startup and never clears. */
export function clearDetectorRegistry(): void {
  detectors.clear();
}

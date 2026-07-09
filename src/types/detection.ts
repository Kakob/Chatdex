// Agent-observability entities (SPEC-agent-observability.md §3).
// Stored plaintext in IndexedDB, ciphertext in Postgres via the sync layer.
//
// Deviations from the spec's field list, both additive:
// - `runId` links a finding to the DetectorRun that produced it.
// - `updatedAt` supports last-write-wins sync when a user label changes;
//   everything else on a finding is immutable per detector version.

export type FindingSeverity = 'info' | 'low' | 'medium' | 'high';

export type UserLabel = 'unset' | 'confirmed' | 'false_positive';

export interface StepRange {
  start: number;
  end: number;
}

/** One suppression rule's outcome — recorded even when it didn't fire. */
export interface SuppressionOutcome {
  rule: string;
  fired: boolean;
  detail?: string;
}

export interface StoredFinding {
  id: string;
  conversationId: string;
  runId: string;
  /** Detector id from the registry (open set — detectors are pluggable). */
  detector: string;
  severity: FindingSeverity;
  stepRange: StepRange;
  summary: string;
  /** Detector-specific payload; must fully explain "why this fired". */
  evidence: unknown;
  suppressionsEvaluated: SuppressionOutcome[];
  detectorVersion: string;
  createdAt: Date;
  updatedAt: Date;
  userLabel: UserLabel;
}

export interface StoredDetectorRun {
  id: string;
  conversationId: string;
  /**
   * Deterministic key over (conversationId, detector versions, config).
   * Unique-indexed: re-running with unchanged inputs is a no-op (SPEC §4).
   */
  runKey: string;
  detectorVersions: Record<string, string>;
  config: Record<string, Record<string, unknown>>;
  startedAt: Date;
  finishedAt: Date;
  findingsCount: number;
}

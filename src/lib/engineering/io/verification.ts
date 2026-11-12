// Criterion status from imported runs (PLAN.md Decision 5). Uses the Change
// Workspace verification vocabulary (supported / contradicted / unverified).
// A passing test supports one criterion at one revision; it does not prove
// the design. Unpinned (dirty-tree) runs never count.

import type { VerificationStatus } from '../../../types/preparedChange';
import type { EngineeringEvidenceRun } from '../../../types/engineering';

export type CriterionOutcome = 'passed' | 'failed' | 'not_run';

export function criterionOutcome(run: EngineeringEvidenceRun | undefined, criterionId: string): CriterionOutcome {
  if (!run) return 'not_run';
  const tests = run.manifest.tests.filter((t) => t.id === criterionId);
  const ran = tests.filter((t) => t.status === 'passed' || t.status === 'failed');
  if (ran.length === 0) return 'not_run';
  return ran.some((t) => t.status === 'failed') ? 'failed' : 'passed';
}

export function verificationStatus(run: EngineeringEvidenceRun | undefined, criterionId: string): VerificationStatus {
  if (!run || !run.pinned) return 'unverified';
  const outcome = criterionOutcome(run, criterionId);
  if (outcome === 'passed') return 'supported';
  if (outcome === 'failed') return 'contradicted';
  return 'unverified';
}

export interface ComparisonRow {
  criterionId: string;
  /** Required by the approved change (vs. merely tracked). */
  required: boolean;
  before: CriterionOutcome;
  after: CriterionOutcome;
  status: VerificationStatus;
  /** Test names reporting this criterion in the implementation run. */
  tests: string[];
  failureMessage?: string;
}

export function compareRuns(
  criterionIds: string[],
  requiredIds: ReadonlySet<string>,
  baseline: EngineeringEvidenceRun | undefined,
  implementation: EngineeringEvidenceRun | undefined
): ComparisonRow[] {
  return criterionIds.map((criterionId) => {
    const tests = implementation?.manifest.tests.filter((t) => t.id === criterionId) ?? [];
    const failure = tests.find((t) => t.status === 'failed')?.failureMessage;
    return {
      criterionId,
      required: requiredIds.has(criterionId),
      before: criterionOutcome(baseline, criterionId),
      after: criterionOutcome(implementation, criterionId),
      status: verificationStatus(implementation, criterionId),
      tests: tests.map((t) => t.name),
      ...(failure ? { failureMessage: failure } : {}),
    };
  });
}

/** Tests in a run whose name carries no known criterion id. */
export function unmappedTests(run: EngineeringEvidenceRun, knownIds: ReadonlySet<string>) {
  return run.manifest.tests.filter((t) => !t.id || !knownIds.has(t.id));
}

// Binding status against an imported observation (PLAN.md Decision 6).
//
// A binding names a path + symbol. Manifests observe every symbol at their
// commit. A confirmation pins the binding to one observation; a newer
// revision makes it stale until the user re-confirms — even when the text is
// unchanged. Nothing refreshes automatically.

import type { EngineeringBinding, EngineeringEvidenceRun, ManifestSymbol } from '../../types/engineering';

export type BindingState =
  /** No pinned observation has been imported. Location unknown. */
  | 'unobserved'
  /** The symbol does not exist at the reference revision. */
  | 'missing'
  /** Observed at the reference revision but never confirmed by the user. */
  | 'observed'
  /** Confirmed at exactly the reference revision. */
  | 'current'
  /** Confirmed at an older revision; needs re-confirmation at the reference revision. */
  | 'stale';

export interface BindingStatus {
  state: BindingState;
  /** Reference revision the status was computed against. */
  sha?: string;
  observation?: ManifestSymbol;
  /** For 'stale': whether the symbol's text differs from the confirmed observation. */
  contentChanged?: boolean;
}

export function findSymbol(run: EngineeringEvidenceRun, path: string, symbol: string): ManifestSymbol | undefined {
  return run.manifest.symbols.find((s) => s.path === path && s.symbol === symbol);
}

/** Latest pinned run by capture time (import order breaks ties). */
export function referenceRun(runs: EngineeringEvidenceRun[]): EngineeringEvidenceRun | undefined {
  const pinned = runs.filter((r) => r.pinned);
  return pinned.reduce<EngineeringEvidenceRun | undefined>((best, run) => {
    if (!best) return run;
    const a = Date.parse(run.manifest.capturedAt);
    const b = Date.parse(best.manifest.capturedAt);
    if (a !== b) return a > b ? run : best;
    return run.importedAt > best.importedAt ? run : best;
  }, undefined);
}

export function bindingStatus(binding: EngineeringBinding, reference: EngineeringEvidenceRun | undefined): BindingStatus {
  if (!reference) return { state: 'unobserved' };
  const sha = reference.manifest.revision.sha;
  const observation = findSymbol(reference, binding.path, binding.symbol);
  if (!observation) return { state: 'missing', sha };
  if (!binding.confirmed) return { state: 'observed', sha, observation };
  if (binding.confirmed.sha === sha) return { state: 'current', sha, observation };
  return { state: 'stale', sha, observation, contentChanged: binding.confirmed.sha256 !== observation.sha256 };
}

export const BINDING_STATE_LABEL: Record<BindingState, string> = {
  unobserved: 'Location unknown — no evidence imported',
  missing: 'Not present at this revision',
  observed: 'Observed, not yet confirmed',
  current: 'Confirmed at this revision',
  stale: 'Stale — confirmed at an older revision',
};

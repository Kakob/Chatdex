// Basis and made-by chips (SPEC-decision-recovery §10.2). The unsupported
// autonomous state is the only accent treatment on the whole surface — the
// rest is neutral, because basis is a mechanical label, not a verdict.

import { AlertTriangle } from 'lucide-react';
import { BASIS_HELP, BASIS_LABEL, MADE_BY_LABEL } from '../../lib/understanding/decisions/decisionMatrix';
import type { DecisionBasis, DecisionMadeBy } from '../../types/decision';

const CHIP = 'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium';

const BASIS_CLASS: Record<DecisionBasis, string> = {
  specified: 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  inherited: 'bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300',
  inferred: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  invented: 'bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
  unknown: 'border border-dashed border-gray-300 text-gray-500 dark:border-gray-600 dark:text-gray-400',
};

export function BasisBadge({ basis, small }: { basis: DecisionBasis; small?: boolean }) {
  return (
    <span
      className={`${CHIP} ${BASIS_CLASS[basis]} ${small ? 'px-1.5 text-[11px]' : ''}`}
      title={BASIS_HELP[basis]}
      data-basis={basis}
    >
      {BASIS_LABEL[basis]}
    </span>
  );
}

export function MadeByChip({ madeBy }: { madeBy: DecisionMadeBy }) {
  return (
    <span className={`${CHIP} bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300`} title="Derived from who said it in the transcript">
      {MADE_BY_LABEL[madeBy]}
    </span>
  );
}

export function UnsupportedBadge() {
  return (
    <span
      className={`${CHIP} bg-rose-600 text-white dark:bg-rose-500`}
      title="The agent decided this with no user direction and no existing pattern — review it"
      data-testid="unsupported-badge"
    >
      <AlertTriangle size={11} /> Unsupported autonomous
    </span>
  );
}

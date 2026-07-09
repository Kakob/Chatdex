import type { FindingSeverity } from '../../types/detection';

export const SEVERITY_ORDER: FindingSeverity[] = ['high', 'medium', 'low', 'info'];

export const SEVERITY_LABEL: Record<FindingSeverity, string> = {
  info: 'Info',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};

/** Marker/badge color classes per severity. */
export const SEVERITY_BADGE: Record<FindingSeverity, string> = {
  info: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
  low: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300',
  medium: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
  high: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
};

/** Cosmetic display names; unknown detector ids fall back to the raw id. */
const DETECTOR_LABEL: Record<string, string> = {
  loop: 'Loop',
  verification_absence: 'Unverified change',
  silent_reversion: 'Silent reversion',
};

export function detectorLabel(detectorId: string): string {
  return DETECTOR_LABEL[detectorId] ?? detectorId;
}

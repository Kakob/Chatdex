import { useEffect, useState } from 'react';
import {
  getFindingChipSummaries,
  type FindingChipSummary,
} from '../lib/detection/stats';

const EMPTY = new Map<string, FindingChipSummary[]>();

export function useFindingSummaries(
  conversationIds: string[]
): Map<string, FindingChipSummary[]> {
  const [summaries, setSummaries] =
    useState<Map<string, FindingChipSummary[]>>(EMPTY);

  // Key on the joined ids so pagination re-fetches but re-renders with the
  // same list (new array identity) don't.
  const idsKey = conversationIds.join('\n');

  useEffect(() => {
    if (idsKey === '') {
      setSummaries(EMPTY);
      return;
    }
    let cancelled = false;
    getFindingChipSummaries(idsKey.split('\n')).then((result) => {
      if (!cancelled) setSummaries(result);
    });
    return () => {
      cancelled = true;
    };
  }, [idsKey]);

  return summaries;
}

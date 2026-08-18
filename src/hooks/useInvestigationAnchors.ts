// Data for the Investigate page (SPEC-decision-investigation §8.1, DI-2a).
// One-shot fetch + manual refresh, matching the app's existing non-reactive
// read pattern (no live queries anywhere).

import { useCallback, useEffect, useState } from 'react';
import { listInvestigationAnchors } from '../lib/db/investigationAnchors';
import { db } from '../lib/db/schema';
import {
  deriveAnchorsForAllAgentSessions,
  type BackfillProgress,
  type BackfillResult,
} from '../lib/investigation/anchors';
import type { InvestigationAnchor } from '../types/investigation';

export interface AnchorConversationInfo {
  name: string;
  projectPath?: string;
  sourceFilename?: string;
}

export interface UseInvestigationAnchorsResult {
  anchors: InvestigationAnchor[];
  conversationInfo: Map<string, AnchorConversationInfo>;
  isLoading: boolean;
  refresh: () => Promise<void>;
  runBackfill: () => Promise<void>;
  backfillProgress: BackfillProgress | null;
  backfillResult: BackfillResult | null;
}

export function useInvestigationAnchors(
  order: 'asc' | 'desc'
): UseInvestigationAnchorsResult {
  const [anchors, setAnchors] = useState<InvestigationAnchor[]>([]);
  const [conversationInfo, setConversationInfo] = useState<
    Map<string, AnchorConversationInfo>
  >(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [backfillProgress, setBackfillProgress] = useState<BackfillProgress | null>(null);
  const [backfillResult, setBackfillResult] = useState<BackfillResult | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const rows = await listInvestigationAnchors({ order });
      const convIds = [...new Set(rows.map((a) => a.conversationId))];
      const convs = await db.conversations.bulkGet(convIds);
      const info = new Map<string, AnchorConversationInfo>();
      convs.forEach((conv, i) => {
        if (!conv) return;
        info.set(convIds[i], {
          name: conv.name,
          projectPath: conv.projectPath,
          sourceFilename:
            typeof conv.providerMeta?.sourceFilename === 'string'
              ? conv.providerMeta.sourceFilename
              : undefined,
        });
      });
      setAnchors(rows);
      setConversationInfo(info);
    } finally {
      setIsLoading(false);
    }
  }, [order]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const runBackfill = useCallback(async () => {
    setBackfillResult(null);
    setBackfillProgress({ current: 0, total: 0 });
    try {
      const result = await deriveAnchorsForAllAgentSessions(setBackfillProgress);
      setBackfillResult(result);
    } finally {
      setBackfillProgress(null);
    }
    await refresh();
  }, [refresh]);

  return {
    anchors,
    conversationInfo,
    isLoading,
    refresh,
    runBackfill,
    backfillProgress,
    backfillResult,
  };
}

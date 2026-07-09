import { create } from 'zustand';
import {
  getFindingsForConversation,
  getDetectorRunsForConversation,
  setFindingLabel,
} from '../lib/db';
import { analyzeConversation } from '../lib/detection/autoAnalyze';
import type { PipelineStage } from '../lib/detection/pipeline';
import type { StoredFinding, UserLabel } from '../types/detection';

interface FindingsState {
  findingsByConversation: Record<string, StoredFinding[]>;
  runCountByConversation: Record<string, number>;
  analyzingStage: Record<string, PipelineStage | undefined>;
  selectedFindingId: string | null;

  loadFindings: (conversationId: string) => Promise<void>;
  analyze: (conversationId: string) => Promise<void>;
  selectFinding: (findingId: string | null) => void;
  labelFinding: (
    conversationId: string,
    findingId: string,
    label: UserLabel
  ) => Promise<void>;
}

export const useFindingsStore = create<FindingsState>((set, get) => ({
  findingsByConversation: {},
  runCountByConversation: {},
  analyzingStage: {},
  selectedFindingId: null,

  loadFindings: async (conversationId) => {
    const [findings, runs] = await Promise.all([
      getFindingsForConversation(conversationId),
      getDetectorRunsForConversation(conversationId),
    ]);
    // Findings are immutable per run; the CURRENT truth is the latest run's
    // findings only (issue #1 — older runs stay in storage for auditability).
    // Fallback to all findings when no run rows exist yet, e.g. synced
    // findings arriving before their run record.
    const latest = [...runs].sort(
      (a, b) => b.finishedAt.getTime() - a.finishedAt.getTime()
    )[0];
    const visible = latest ? findings.filter((f) => f.runId === latest.id) : findings;
    set({
      findingsByConversation: {
        ...get().findingsByConversation,
        [conversationId]: visible,
      },
      runCountByConversation: {
        ...get().runCountByConversation,
        [conversationId]: runs.length,
      },
    });
  },

  analyze: async (conversationId) => {
    if (get().analyzingStage[conversationId]) return;
    set({
      analyzingStage: { ...get().analyzingStage, [conversationId]: 'loading' },
    });
    try {
      await analyzeConversation(conversationId, ({ stage }) => {
        set({
          analyzingStage: { ...get().analyzingStage, [conversationId]: stage },
        });
      });
      await get().loadFindings(conversationId);
    } finally {
      set({
        analyzingStage: { ...get().analyzingStage, [conversationId]: undefined },
      });
    }
  },

  selectFinding: (findingId) => set({ selectedFindingId: findingId }),

  labelFinding: async (conversationId, findingId, label) => {
    await setFindingLabel(findingId, label);
    const findings = get().findingsByConversation[conversationId] ?? [];
    set({
      findingsByConversation: {
        ...get().findingsByConversation,
        [conversationId]: findings.map((f) =>
          f.id === findingId ? { ...f, userLabel: label, updatedAt: new Date() } : f
        ),
      },
    });
  },
}));

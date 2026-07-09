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
    set({
      findingsByConversation: {
        ...get().findingsByConversation,
        [conversationId]: findings,
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

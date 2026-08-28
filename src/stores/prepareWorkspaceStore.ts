// Cross-section intents inside one Change Workspace page (SPEC-change-workspace
// §13, CW-6): the Guided action menu on a symbol / file / node hands a search
// to the Evidence section, or a question draft to the Questions section,
// without the sections knowing about each other.

import { create } from 'zustand';

export type PendingSearchMode = 'grep' | 'symbol' | 'references';

export interface PendingSearch {
  mode: PendingSearchMode;
  query: string;
  pathGlob?: string;
  /** Monotonic so the same query can be re-requested. */
  nonce: number;
}

interface PrepareWorkspaceState {
  pendingSearch: PendingSearch | null;
  pendingQuestion: { title: string; nonce: number } | null;
  requestSearch: (mode: PendingSearchMode, query: string, pathGlob?: string) => void;
  consumeSearch: () => void;
  requestQuestion: (title: string) => void;
  consumeQuestion: () => void;
}

let nonce = 0;

export const usePrepareWorkspaceStore = create<PrepareWorkspaceState>((set) => ({
  pendingSearch: null,
  pendingQuestion: null,
  requestSearch: (mode, query, pathGlob) => set({ pendingSearch: { mode, query, pathGlob, nonce: ++nonce } }),
  consumeSearch: () => set({ pendingSearch: null }),
  requestQuestion: (title) => set({ pendingQuestion: { title, nonce: ++nonce } }),
  consumeQuestion: () => set({ pendingQuestion: null }),
}));

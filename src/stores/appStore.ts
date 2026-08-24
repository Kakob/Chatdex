import { create } from 'zustand';
import type { DataSource } from '../types';

export type Theme = 'light' | 'dark' | 'system';

interface AppState {
  // UI State
  theme: Theme;
  sidebarOpen: boolean;

  // Data State
  isLoading: boolean;
  conversationCount: number;
  messageCount: number;
  lastSync: Partial<Record<DataSource, Date>>;

  // License
  isPro: boolean;
  licenseKey: string | null;

  // Import State
  isImporting: boolean;
  importProgress: number;
  importStatus: string;

  // Actions
  setTheme: (theme: Theme) => void;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  setLoading: (loading: boolean) => void;
  setStats: (stats: { conversationCount: number; messageCount: number }) => void;
  setLastSync: (source: DataSource, date: Date) => void;
  setLicense: (key: string | null, isPro: boolean) => void;
  setImportState: (state: { isImporting: boolean; progress: number; status: string }) => void;
}

export const useAppStore = create<AppState>((set) => ({
  // Initial UI State
  theme: 'system',
  sidebarOpen: typeof window === 'undefined' ? true : window.innerWidth >= 768,

  // Initial Data State
  isLoading: true,
  conversationCount: 0,
  messageCount: 0,
  lastSync: {},

  // Initial License State
  isPro: import.meta.env.VITE_DEV_PRO === 'true',
  licenseKey: null,

  // Initial Import State
  isImporting: false,
  importProgress: 0,
  importStatus: '',

  // Actions
  setTheme: (theme) => set({ theme }),

  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),

  setSidebarOpen: (open) => set({ sidebarOpen: open }),

  setLoading: (loading) => set({ isLoading: loading }),

  setStats: (stats) =>
    set({
      conversationCount: stats.conversationCount,
      messageCount: stats.messageCount,
    }),

  setLastSync: (source, date) =>
    set((state) => ({ lastSync: { ...state.lastSync, [source]: date } })),

  setLicense: (key, isPro) => set({ licenseKey: key, isPro }),

  setImportState: (state) =>
    set({
      isImporting: state.isImporting,
      importProgress: state.progress,
      importStatus: state.status,
    }),
}));

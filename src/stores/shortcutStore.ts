import { create } from 'zustand';

export interface ShortcutEntry {
  id: string;
  key: string;
  label: string;
  description?: string;
  handler: () => void;
  meta?: boolean;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  /** Scope restricts when the shortcut is active (default: 'global') */
  scope?: string;
}

interface ShortcutState {
  shortcuts: Map<string, ShortcutEntry>;
  paletteOpen: boolean;

  register: (entry: ShortcutEntry) => void;
  unregister: (id: string) => void;
  togglePalette: () => void;
  setPaletteOpen: (open: boolean) => void;
  getAll: () => ShortcutEntry[];
}

export const useShortcutStore = create<ShortcutState>((set, get) => ({
  shortcuts: new Map(),
  paletteOpen: false,

  register: (entry) =>
    set((state) => {
      const next = new Map(state.shortcuts);
      next.set(entry.id, entry);
      return { shortcuts: next };
    }),

  unregister: (id) =>
    set((state) => {
      const next = new Map(state.shortcuts);
      next.delete(id);
      return { shortcuts: next };
    }),

  togglePalette: () => set((state) => ({ paletteOpen: !state.paletteOpen })),
  setPaletteOpen: (open) => set({ paletteOpen: open }),

  getAll: () => Array.from(get().shortcuts.values()),
}));

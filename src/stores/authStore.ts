// Auth + cloud-sync UI state. The actual key material lives in the
// keyManager; this store only tracks user-visible status.

import { create } from 'zustand';
import type { SessionUser } from '../lib/auth/session';
import { getCurrentUser, getAuthToken } from '../lib/auth/session';
import { isUnlocked } from '../lib/crypto';

export type AuthStatus = 'logged-out' | 'locked' | 'unlocked';

interface AuthState {
  status: AuthStatus;
  user: SessionUser | null;
  syncing: boolean;
  syncError: string | null;
  lastSyncAt: Date | null;
  /** Local changes waiting to upload. */
  pending: number;

  setStatus: (status: AuthStatus) => void;
  setUser: (user: SessionUser | null) => void;
  setSyncing: (syncing: boolean) => void;
  setSyncError: (err: string | null) => void;
  setLastSyncAt: (d: Date | null) => void;
  setPending: (pending: number) => void;
  hydrate: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  status: 'logged-out',
  user: null,
  syncing: false,
  syncError: null,
  lastSyncAt: null,
  pending: 0,

  setStatus: (status) => set({ status }),
  setUser: (user) => set({ user }),
  setSyncing: (syncing) => set({ syncing }),
  setSyncError: (syncError) => set({ syncError }),
  setLastSyncAt: (lastSyncAt) => set({ lastSyncAt }),
  setPending: (pending) => set({ pending }),

  hydrate: () => {
    const token = getAuthToken();
    const user = getCurrentUser();
    if (token && user) {
      // A remount (e.g. opening Settings) must not report an unlocked vault
      // as locked.
      set({ user, status: isUnlocked() ? 'unlocked' : 'locked' });
    } else {
      set({ user: null, status: 'logged-out' });
    }
  },
}));

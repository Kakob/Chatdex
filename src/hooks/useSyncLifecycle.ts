// App-level sync lifecycle (docs/changes/reliable-sync). Runs once at boot:
// records local changes from the first moment, resumes an unlocked vault from
// the device-remembered key, and keeps the engine running exactly while the
// vault is unlocked — no visit to Settings required.

import { useEffect } from 'react';
import { useAuthStore } from '../stores/authStore';
import { resumeFromDevice } from '../lib/auth/session';
import { syncEngine } from '../lib/sync/engine';

let booted = false;

async function bootSync(): Promise<void> {
  const auth = useAuthStore.getState();

  syncEngine.subscribe((s) => {
    const store = useAuthStore.getState();
    store.setSyncing(s.syncing);
    store.setSyncError(s.lastError);
    store.setLastSyncAt(s.lastSyncAt);
    store.setPending(s.pending);
  });

  useAuthStore.subscribe((state, prev) => {
    if (state.status === prev.status) return;
    if (state.status === 'unlocked') {
      void syncEngine.start().catch((err) => console.error('[sync] start failed', err));
    } else {
      syncEngine.stop();
    }
  });

  await syncEngine.attach();

  auth.hydrate();
  if (useAuthStore.getState().status === 'locked') {
    const user = await resumeFromDevice();
    if (user) {
      useAuthStore.getState().setUser(user);
      useAuthStore.getState().setStatus('unlocked');
    }
  } else if (useAuthStore.getState().status === 'unlocked') {
    void syncEngine.start().catch((err) => console.error('[sync] start failed', err));
  }
}

export function useSyncLifecycle(): void {
  useEffect(() => {
    if (booted) return;
    booted = true;
    void bootSync().catch((err) => console.error('[sync] boot failed', err));
  }, []);
}

// React bindings for "where is this saved?" labels. Recompute (debounced)
// whenever sync progress changes: during an import or a catch-up upload the
// pending count changes on every row, so a burst collapses into one query.

import { useEffect, useState } from 'react';
import { useAuthStore } from '../stores/authStore';
import {
  getConversationStorage,
  getMessageLocations,
  getStorageSummary,
  type ConversationStorage,
  type StorageLocation,
  type StorageSummary,
} from '../lib/sync/storageLocation';

const DEBOUNCE_MS = 400;

function useSyncRevision(): string {
  const { pending, lastSyncAt, status } = useAuthStore();
  return `${status}:${pending}:${lastSyncAt?.getTime() ?? 0}`;
}

function useDebouncedQuery<T>(query: () => Promise<T>, deps: unknown[], enabled = true): T | null {
  const [value, setValue] = useState<T | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const id = setTimeout(() => {
      query()
        .then((v) => {
          if (!cancelled) setValue(v);
        })
        .catch((err) => console.warn('[storage] location lookup failed', err));
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deps are passed explicitly
  }, [...deps, enabled]);
  return value;
}

export function useConversationStorage(
  conversationIds: string[]
): Map<string, ConversationStorage> | null {
  const revision = useSyncRevision();
  const idsKey = conversationIds.join(',');
  return useDebouncedQuery(() => getConversationStorage(conversationIds), [idsKey, revision]);
}

export function useMessageLocations(conversationId: string): Map<string, StorageLocation> | null {
  const revision = useSyncRevision();
  return useDebouncedQuery(() => getMessageLocations(conversationId), [conversationId, revision]);
}

export function useStorageSummary(enabled: boolean): StorageSummary | null {
  const revision = useSyncRevision();
  return useDebouncedQuery(() => getStorageSummary(), [revision], enabled);
}

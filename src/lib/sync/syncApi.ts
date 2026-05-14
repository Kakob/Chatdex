// Thin HTTP client for the encrypted sync endpoints. All payloads are
// already-encrypted; this module knows nothing about plaintext.

import { getAuthToken } from '../auth/session';

const BACKEND_URL =
  import.meta.env.VITE_API_URL?.replace(/\/api$/, '') || 'http://localhost:3003';

export interface WireSealed {
  iv: string; // base64
  ciphertext: string; // base64
}

export type SyncKind =
  | 'conversation'
  | 'message'
  | 'activity'
  | 'anchor'
  | 'tag'
  | 'entity_tag'
  | 'folder'
  | 'daily_stats'
  | 'metadata';

export interface PushRecord extends WireSealed {
  id: string;
  kind: SyncKind;
  parentId?: string | null;
  updatedAt: string;
  deleted?: boolean;
}

export interface PullRecord extends PushRecord {
  deleted: boolean;
}

export interface PullResult {
  records: PullRecord[];
  cursor: string | null;
  hasMore: boolean;
}

async function authedFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = getAuthToken();
  const headers = new Headers(init?.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (init?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  return fetch(`${BACKEND_URL}${path}`, { ...init, headers });
}

export async function pushRecords(records: PushRecord[]): Promise<{ accepted: number; serverTime: string }> {
  const res = await authedFetch('/api/sync/push', {
    method: 'POST',
    body: JSON.stringify({ records }),
  });
  if (!res.ok) {
    throw new Error(`Sync push failed: ${res.status}`);
  }
  return res.json();
}

export async function pullRecords(since: string | null, limit = 500): Promise<PullResult> {
  const params = new URLSearchParams();
  if (since) params.set('since', since);
  params.set('limit', String(limit));
  const res = await authedFetch(`/api/sync/pull?${params}`);
  if (!res.ok) {
    throw new Error(`Sync pull failed: ${res.status}`);
  }
  return res.json();
}

export async function wipeServerData(): Promise<void> {
  const res = await authedFetch('/api/sync/all', { method: 'DELETE' });
  if (!res.ok) {
    throw new Error(`Wipe failed: ${res.status}`);
  }
}

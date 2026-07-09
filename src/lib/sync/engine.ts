// Sync engine. IndexedDB stays the source of truth — this engine encrypts
// local writes and pushes them up, and pulls down encrypted records from the
// server and applies them locally.
//
// The engine is intentionally small: it polls in two directions on a fixed
// interval and serializes work through a single in-flight promise per
// direction. Last-write-wins by record `updatedAt`. Conflict-free merge for
// conversations is good enough at v1 (messages are append-only, anchors are
// rarely edited concurrently).

import { db, clearAllData } from '../db';
import { encryptJSON, decryptJSON, getMasterKey, isUnlocked } from '../crypto';
import { getMetadata, setMetadata } from '../db/metadata';
import {
  pushRecords,
  pullRecords,
  wipeServerData,
  type PushRecord,
  type PullRecord,
  type SyncKind,
} from './syncApi';
import {
  envelopeConversation,
  envelopeMessage,
  envelopeActivity,
  envelopeAnchor,
  envelopeTag,
  envelopeEntityTag,
  envelopeFolder,
  envelopeDailyStats,
  envelopeMetadata,
  envelopeFinding,
  envelopeDetectorRun,
  rehydrateConversation,
  rehydrateMessage,
  rehydrateActivity,
  rehydrateAnchor,
  rehydrateTag,
  rehydrateEntityTag,
  rehydrateFolder,
  rehydrateDailyStats,
  rehydrateMetadata,
  rehydrateFinding,
  rehydrateDetectorRun,
  type SyncEnvelope,
} from './serializer';

const PULL_CURSOR_KEY = 'sync.pullCursor';
const DIRTY_KEY = 'sync.dirty'; // queue of { id, kind, deleted? } pending push

// Metadata under the `sync.` prefix is per-device engine state (dirty queue,
// pull cursor). It must never enter the sync stream: pushing it leaks local
// state to the server, and because persisting the dirty queue is itself a
// metadata write, syncing it makes every markDirty re-dirty the queue — an
// infinite push loop.
function isDeviceLocalMetadata(key: string): boolean {
  return key.startsWith('sync.');
}

function isSyncableEntry(entry: DirtyEntry): boolean {
  return !(entry.kind === 'metadata' && isDeviceLocalMetadata(entry.id));
}

interface DirtyEntry {
  id: string;
  kind: SyncKind;
  deleted?: boolean;
}

// Apply an incoming record's payload to the right Dexie table.
async function applyIncomingRecord(rec: PullRecord, payload: unknown): Promise<void> {
  // Device-local sync state that older engine versions pushed to the server:
  // never apply it, or one device's queue/cursor clobbers another's.
  if (rec.kind === 'metadata' && isDeviceLocalMetadata(rec.id)) return;
  if (rec.deleted) {
    switch (rec.kind) {
      case 'conversation':
        await db.conversations.delete(rec.id);
        await db.messages.where('conversationId').equals(rec.id).delete();
        await db.anchors.where('conversationId').equals(rec.id).delete();
        await db.findings.where('conversationId').equals(rec.id).delete();
        await db.detectorRuns.where('conversationId').equals(rec.id).delete();
        return;
      case 'message':
        await db.messages.delete(rec.id);
        return;
      case 'activity':
        await db.activities.delete(rec.id);
        return;
      case 'anchor':
        await db.anchors.delete(rec.id);
        return;
      case 'tag':
        await db.tags.delete(rec.id);
        return;
      case 'entity_tag':
        await db.entityTags.delete(rec.id);
        return;
      case 'folder':
        await db.knowledgeFolders.delete(rec.id);
        return;
      case 'daily_stats':
        await db.dailyStats.delete(rec.id);
        return;
      case 'metadata':
        await db.metadata.delete(rec.id);
        return;
      case 'finding':
        await db.findings.delete(rec.id);
        return;
      case 'detector_run':
        await db.detectorRuns.delete(rec.id);
        return;
    }
  }
  switch (rec.kind) {
    case 'conversation':
      await db.conversations.put(rehydrateConversation(payload));
      return;
    case 'message':
      await db.messages.put(rehydrateMessage(payload));
      return;
    case 'activity':
      await db.activities.put(rehydrateActivity(payload));
      return;
    case 'anchor':
      await db.anchors.put(rehydrateAnchor(payload));
      return;
    case 'tag':
      await db.tags.put(rehydrateTag(payload));
      return;
    case 'entity_tag':
      await db.entityTags.put(rehydrateEntityTag(payload));
      return;
    case 'folder':
      await db.knowledgeFolders.put(rehydrateFolder(payload));
      return;
    case 'daily_stats':
      await db.dailyStats.put(rehydrateDailyStats(payload));
      return;
    case 'metadata':
      await db.metadata.put(rehydrateMetadata(payload));
      return;
    case 'finding':
      await db.findings.put(rehydrateFinding(payload));
      return;
    case 'detector_run':
      await db.detectorRuns.put(rehydrateDetectorRun(payload));
      return;
  }
}

// Read the current row from Dexie for a given dirty entry and produce its
// sync envelope. Returns null if the row is gone (in which case it's a delete).
async function buildEnvelope(entry: DirtyEntry): Promise<SyncEnvelope | null> {
  if (entry.deleted) {
    return {
      kind: entry.kind,
      parentId: null,
      updatedAt: new Date(),
      payload: { id: entry.id, deleted: true },
    };
  }
  switch (entry.kind) {
    case 'conversation': {
      const c = await db.conversations.get(entry.id);
      return c ? envelopeConversation(c) : null;
    }
    case 'message': {
      const m = await db.messages.get(entry.id);
      return m ? envelopeMessage(m) : null;
    }
    case 'activity': {
      const a = await db.activities.get(entry.id);
      return a ? envelopeActivity(a) : null;
    }
    case 'anchor': {
      const a = await db.anchors.get(entry.id);
      return a ? envelopeAnchor(a) : null;
    }
    case 'tag': {
      const t = await db.tags.get(entry.id);
      return t ? envelopeTag(t) : null;
    }
    case 'entity_tag': {
      const e = await db.entityTags.get(entry.id);
      return e ? envelopeEntityTag(e) : null;
    }
    case 'folder': {
      const f = await db.knowledgeFolders.get(entry.id);
      return f ? envelopeFolder(f) : null;
    }
    case 'daily_stats': {
      const d = await db.dailyStats.get(entry.id);
      return d ? envelopeDailyStats(d) : null;
    }
    case 'metadata': {
      const m = await db.metadata.get(entry.id);
      return m ? envelopeMetadata(m) : null;
    }
    case 'finding': {
      const f = await db.findings.get(entry.id);
      return f ? envelopeFinding(f) : null;
    }
    case 'detector_run': {
      const r = await db.detectorRuns.get(entry.id);
      return r ? envelopeDetectorRun(r) : null;
    }
  }
}

class SyncEngine {
  private timer: ReturnType<typeof setInterval> | null = null;
  private hookHandles: Array<() => void> = [];
  private inflight = false;
  private suspended = false;
  private dirty: DirtyEntry[] = [];

  async start(intervalMs = 10_000): Promise<void> {
    if (this.timer) return;
    if (!isUnlocked()) {
      throw new Error('Cannot start sync engine while vault is locked');
    }

    // Restore dirty queue from a previous session. Filter out device-local
    // metadata entries that older engine versions enqueued.
    const saved = (await getMetadata<DirtyEntry[]>(DIRTY_KEY)) ?? [];
    this.dirty = saved.filter(isSyncableEntry);

    this.installHooks();
    this.timer = setInterval(() => {
      void this.tick();
    }, intervalMs);
    // Fire one sync immediately.
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const off of this.hookHandles) off();
    this.hookHandles = [];
  }

  /** Force a flush + pull. Useful for tests and a manual "Sync now" button. */
  async tick(): Promise<void> {
    if (this.inflight || this.suspended || !isUnlocked()) return;
    this.inflight = true;
    try {
      await this.flushDirty();
      await this.pullDelta();
    } catch (err) {
      console.error('[sync] tick failed', err);
    } finally {
      this.inflight = false;
    }
  }

  async wipeLocalCursor(): Promise<void> {
    await setMetadata(PULL_CURSOR_KEY, null);
    this.dirty = [];
    await setMetadata(DIRTY_KEY, []);
  }

  /**
   * Suspend hooks/ticks, wait out any in-flight tick, run fn, resume.
   * Suspending BEFORE draining matters: doing it the other way around leaves
   * a window where the interval starts a new tick between the drain and the
   * suspend.
   */
  private async whilePaused<T>(fn: () => Promise<T>): Promise<T> {
    this.suspended = true;
    try {
      while (this.inflight) await new Promise((r) => setTimeout(r, 50));
      return await fn();
    } finally {
      this.suspended = false;
    }
  }

  /**
   * Clear all local data WITHOUT emitting sync tombstones — the server copy
   * is untouched (use wipeServer for that). Suspends hooks and ticks for the
   * duration: running Dexie's per-row deleting hooks inside clearAllData's
   * transaction would both spam tombstones and write to the metadata table
   * mid-clear, which is what used to hang the transaction. Resets
   * device-local sync state so a later pull starts from scratch.
   */
  async clearLocalData(): Promise<void> {
    await this.whilePaused(async () => {
      await clearAllData();
      this.dirty = [];
      await setMetadata(DIRTY_KEY, []);
      await setMetadata(PULL_CURSOR_KEY, null);
    });
  }

  /**
   * Delete every record on the server and reset local sync state, leaving
   * local data untouched. Pauses the engine first: without that, a push
   * batch already in flight lands after the wipe, and a failed push re-queues
   * its batch even though the queue was just cleared — both resurrect
   * records (typically tombstones) on a freshly wiped server.
   */
  async wipeServer(): Promise<void> {
    await this.whilePaused(async () => {
      this.dirty = [];
      await setMetadata(DIRTY_KEY, []);
      await wipeServerData();
      await setMetadata(PULL_CURSOR_KEY, null);
    });
  }

  /**
   * Mark every local row dirty and flush, re-pushing the full dataset.
   * Recovery path after a server wipe, and for rows created while the engine
   * was stopped (hooks never saw them, so they otherwise never upload).
   */
  async resyncAll(): Promise<void> {
    if (!isUnlocked()) throw new Error('Cannot re-upload while vault is locked');
    const tables: Array<[SyncKind, { toCollection(): { primaryKeys(): Promise<unknown[]> } }]> = [
      ['conversation', db.conversations],
      ['message', db.messages],
      ['activity', db.activities],
      ['anchor', db.anchors],
      ['tag', db.tags],
      ['entity_tag', db.entityTags],
      ['folder', db.knowledgeFolders],
      ['daily_stats', db.dailyStats],
      ['metadata', db.metadata],
      ['finding', db.findings],
      ['detector_run', db.detectorRuns],
    ];
    for (const [kind, table] of tables) {
      for (const key of await table.toCollection().primaryKeys()) {
        this.markDirty({ id: String(key), kind });
      }
    }
    // Flush everything now rather than waiting for interval ticks.
    while (this.dirty.length > 0) {
      const before = this.dirty.length;
      await this.tick();
      if (this.dirty.length >= before) break; // push failing; stop, interval will retry
    }
  }

  private installHooks(): void {
    const upsert = (kind: SyncKind) => (primKey: string) =>
      this.markDirty({ id: primKey, kind });
    const remove = (kind: SyncKind) => (primKey: string) =>
      this.markDirty({ id: primKey, kind, deleted: true });

    db.conversations.hook('creating', upsert('conversation'));
    db.conversations.hook('updating', (_m, k) => upsert('conversation')(k as string));
    db.conversations.hook('deleting', remove('conversation'));

    db.messages.hook('creating', upsert('message'));
    db.messages.hook('updating', (_m, k) => upsert('message')(k as string));
    db.messages.hook('deleting', remove('message'));

    db.activities.hook('creating', upsert('activity'));
    db.activities.hook('updating', (_m, k) => upsert('activity')(k as string));
    db.activities.hook('deleting', remove('activity'));

    db.anchors.hook('creating', upsert('anchor'));
    db.anchors.hook('updating', (_m, k) => upsert('anchor')(k as string));
    db.anchors.hook('deleting', remove('anchor'));

    db.tags.hook('creating', upsert('tag'));
    db.tags.hook('updating', (_m, k) => upsert('tag')(k as string));
    db.tags.hook('deleting', remove('tag'));

    db.entityTags.hook('creating', upsert('entity_tag'));
    db.entityTags.hook('updating', (_m, k) => upsert('entity_tag')(k as string));
    db.entityTags.hook('deleting', remove('entity_tag'));

    db.knowledgeFolders.hook('creating', upsert('folder'));
    db.knowledgeFolders.hook('updating', (_m, k) => upsert('folder')(k as string));
    db.knowledgeFolders.hook('deleting', remove('folder'));

    db.dailyStats.hook('creating', upsert('daily_stats'));
    db.dailyStats.hook('updating', (_m, k) => upsert('daily_stats')(k as string));
    db.dailyStats.hook('deleting', remove('daily_stats'));

    db.metadata.hook('creating', upsert('metadata'));
    db.metadata.hook('updating', (_m, k) => upsert('metadata')(k as string));
    db.metadata.hook('deleting', remove('metadata'));

    // Findings/runs are written in one batched transaction at DetectorRun
    // completion (pipeline.persistDetectorRun), so these hooks fire as one
    // burst per analysis — plus individual label updates from the UI.
    db.findings.hook('creating', upsert('finding'));
    db.findings.hook('updating', (_m, k) => upsert('finding')(k as string));
    db.findings.hook('deleting', remove('finding'));

    db.detectorRuns.hook('creating', upsert('detector_run'));
    db.detectorRuns.hook('updating', (_m, k) => upsert('detector_run')(k as string));
    db.detectorRuns.hook('deleting', remove('detector_run'));

    // Dexie hooks have no portable unsubscribe; stop() relies on the engine
    // being long-lived for the page lifetime. Tests should not call start().
  }

  private markDirty(entry: DirtyEntry): void {
    if (this.suspended || !isSyncableEntry(entry)) return;
    // Coalesce: keep latest state per (kind, id). If a delete arrives after an
    // upsert (or vice versa), the latter wins.
    this.dirty = this.dirty.filter((d) => !(d.id === entry.id && d.kind === entry.kind));
    this.dirty.push(entry);
    // Persist asynchronously; best-effort (flushDirty re-persists after every
    // push). setTimeout escapes the caller's Dexie transaction zone: hooks
    // fire inside transactions that usually don't include the metadata store,
    // and a put issued in-zone there throws NotFoundError.
    setTimeout(() => {
      setMetadata(DIRTY_KEY, this.dirty).catch(() => {});
    }, 0);
  }

  private async flushDirty(): Promise<void> {
    if (this.dirty.length === 0) return;
    const batch = this.dirty.splice(0, 200);
    const masterKey = getMasterKey();

    const wire: PushRecord[] = [];
    for (const entry of batch) {
      const env = await buildEnvelope(entry);
      if (!env) {
        // Row was created and deleted before we got to push it; emit a delete
        // tombstone so other devices learn about it.
        const sealed = await encryptJSON(masterKey, { id: entry.id, deleted: true });
        wire.push({
          id: entry.id,
          kind: entry.kind,
          parentId: null,
          iv: bufToB64(sealed.iv),
          ciphertext: bufToB64(sealed.ciphertext),
          updatedAt: new Date().toISOString(),
          deleted: true,
        });
        continue;
      }
      const sealed = await encryptJSON(masterKey, env.payload);
      wire.push({
        id: entry.id,
        kind: env.kind,
        parentId: env.parentId,
        iv: bufToB64(sealed.iv),
        ciphertext: bufToB64(sealed.ciphertext),
        updatedAt: env.updatedAt.toISOString(),
        deleted: entry.deleted ?? false,
      });
    }

    try {
      await pushRecords(wire);
      await setMetadata(DIRTY_KEY, this.dirty);
    } catch (err) {
      // Re-queue so we retry on the next tick.
      this.dirty = [...batch, ...this.dirty];
      await setMetadata(DIRTY_KEY, this.dirty);
      throw err;
    }
  }

  private async pullDelta(): Promise<void> {
    let cursor = (await getMetadata<string | null>(PULL_CURSOR_KEY)) ?? null;
    const masterKey = getMasterKey();
    let hasMore = true;
    let safety = 50; // cap pages per tick

    while (hasMore && safety-- > 0) {
      const result = await pullRecords(cursor, 500);
      for (const rec of result.records) {
        try {
          const payload = await decryptJSON(masterKey, {
            iv: b64ToBuf(rec.iv),
            ciphertext: b64ToBuf(rec.ciphertext),
          });
          await applyIncomingRecord(rec, payload);
        } catch (err) {
          console.error('[sync] failed to apply record', rec.id, err);
        }
      }
      if (result.cursor) {
        cursor = result.cursor;
        await setMetadata(PULL_CURSOR_KEY, cursor);
      }
      hasMore = result.hasMore;
    }
  }
}

function bufToB64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function b64ToBuf(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export const syncEngine = new SyncEngine();

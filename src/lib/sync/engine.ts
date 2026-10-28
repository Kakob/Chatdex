// Sync engine. IndexedDB stays the source of truth — this engine encrypts
// local writes and pushes them up, and pulls down encrypted records from the
// server and applies them locally.
//
// The engine is intentionally small. Uploads are change-driven: a local write
// schedules a push shortly after writes go quiet. Downloads poll on a slow
// interval (other devices are rare) and on returning to the tab; a hidden tab
// stops polling so the database can idle. All work is serialized through a
// single in-flight promise. Last-write-wins by record `updatedAt`. Conflict-free merge for
// conversations is good enough at v1 (messages are append-only, anchors are
// rarely edited concurrently).

import { db, clearAllData, removeEntityTagsFor } from '../db';
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
  envelopeUnderstandingProject,
  envelopeProjectAssociation,
  envelopeUnderstandingObject,
  envelopeUnderstandingEvent,
  envelopeInvestigationCase,
  envelopeCaseExhibit,
  envelopeReviewScope,
  envelopeVerdictRevision,
  envelopeInvestigationFinding,
  envelopePreparedChange,
  envelopeIntentTrace,
  envelopeDecisionTrace,
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
  rehydrateUnderstandingProject,
  rehydrateProjectAssociation,
  rehydrateUnderstandingObject,
  rehydrateUnderstandingEvent,
  rehydrateInvestigationCase,
  rehydrateCaseExhibit,
  rehydrateReviewScope,
  rehydrateVerdictRevision,
  rehydrateInvestigationFinding,
  rehydratePreparedChange,
  rehydrateIntentTrace,
  rehydrateDecisionTrace,
  type SyncEnvelope,
} from './serializer';

const PULL_CURSOR_KEY = 'sync.pullCursor';
const DIRTY_KEY = 'sync.dirty'; // queue of { id, kind, deleted? } pending push

/** Upload this long after local writes go quiet. */
export const PUSH_DELAY_MS = 2_000;
/** ...but never hold changes longer than this during a continuous burst (an import). */
export const PUSH_MAX_WAIT_MS = 10_000;
/** Check for changes from other devices this often while the tab is visible. */
export const PULL_INTERVAL_MS = 90_000;

// Metadata under the `sync.` prefix is per-device engine state (dirty queue,
// pull cursor). It must never enter the sync stream: pushing it leaks local
// state to the server, and because persisting the dirty queue is itself a
// metadata write, syncing it makes every markDirty re-dirty the queue — an
// infinite push loop. The `github.` prefix (Intent Trace token) is likewise
// device-local by design — SPEC-intent-trace §8.1, audit S1.
const DEVICE_LOCAL_METADATA_PREFIXES = ['sync.', 'github.'];
function isDeviceLocalMetadata(key: string): boolean {
  // Change Workspace local-directory handle (SPEC-change-workspace S11): a
  // FileSystemDirectoryHandle is neither serializable nor another device's.
  if (key.startsWith('repo.')) return true;
  return DEVICE_LOCAL_METADATA_PREFIXES.some((prefix) => key.startsWith(prefix));
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
      case 'conversation': {
        const anchorIds = (await db.anchors
          .where('conversationId')
          .equals(rec.id)
          .primaryKeys()) as string[];
        await db.conversations.delete(rec.id);
        await db.messages.where('conversationId').equals(rec.id).delete();
        await db.anchors.where('conversationId').equals(rec.id).delete();
        // Tag links go with their entity (mirrors deleteConversation).
        await removeEntityTagsFor('conversation', [rec.id]);
        await removeEntityTagsFor('anchor', anchorIds);
        await db.findings.where('conversationId').equals(rec.id).delete();
        await db.detectorRuns.where('conversationId').equals(rec.id).delete();
        // Associations dangle without their conversation; understanding
        // objects/events survive — synthesis outlives any single source.
        await db.projectAssociations.where('conversationId').equals(rec.id).delete();
        // Investigation records cannot outlive their primary source (spec
        // §14) — mirror the local deleteConversation cascade. Derived
        // investigationAnchors are local-only and cascade here too.
        const removedCaseIds = await db.investigationCases
          .where('conversationId')
          .equals(rec.id)
          .primaryKeys();
        await db.investigationAnchors.where('conversationId').equals(rec.id).delete();
        await db.investigationCases.where('conversationId').equals(rec.id).delete();
        await db.caseExhibits.where('conversationId').equals(rec.id).delete();
        await db.reviewScopes.where('conversationId').equals(rec.id).delete();
        await db.verdictRevisions.where('conversationId').equals(rec.id).delete();
        if (removedCaseIds.length > 0) {
          await db.investigationFindings.where('caseId').anyOf(removedCaseIds).delete();
        }
        return;
      }
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
      case 'understanding_project':
        await db.understandingProjects.delete(rec.id);
        return;
      case 'project_association':
        await db.projectAssociations.delete(rec.id);
        return;
      case 'understanding_object':
        await db.understandingObjects.delete(rec.id);
        await db.understandingEvents.where('objectId').equals(rec.id).delete();
        await db.intentTraces.where('intentObjectId').equals(rec.id).delete();
        await db.decisionTraces.where('decisionObjectId').equals(rec.id).delete();
        return;
      case 'understanding_event':
        await db.understandingEvents.delete(rec.id);
        return;
      case 'investigation_case':
        await db.investigationCases.delete(rec.id);
        await db.caseExhibits.where('caseId').equals(rec.id).delete();
        await db.reviewScopes.where('caseId').equals(rec.id).delete();
        await db.verdictRevisions.where('caseId').equals(rec.id).delete();
        await db.investigationFindings.where('caseId').equals(rec.id).delete();
        return;
      case 'case_exhibit':
        await db.caseExhibits.delete(rec.id);
        return;
      case 'review_scope':
        await db.reviewScopes.delete(rec.id);
        return;
      case 'verdict_revision':
        await db.verdictRevisions.delete(rec.id);
        return;
      case 'investigation_finding':
        await db.investigationFindings.delete(rec.id);
        return;
      case 'prepared_change':
        await db.preparedChanges.delete(rec.id);
        return;
      case 'intent_trace':
        await db.intentTraces.delete(rec.id);
        return;
      case 'decision_trace':
        await db.decisionTraces.delete(rec.id);
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
    case 'understanding_project':
      await db.understandingProjects.put(rehydrateUnderstandingProject(payload));
      return;
    case 'project_association':
      await db.projectAssociations.put(rehydrateProjectAssociation(payload));
      return;
    case 'understanding_object':
      await db.understandingObjects.put(rehydrateUnderstandingObject(payload));
      return;
    case 'understanding_event':
      await db.understandingEvents.put(rehydrateUnderstandingEvent(payload));
      return;
    case 'investigation_case':
      await db.investigationCases.put(rehydrateInvestigationCase(payload));
      return;
    case 'case_exhibit':
      await db.caseExhibits.put(rehydrateCaseExhibit(payload));
      return;
    case 'review_scope':
      await db.reviewScopes.put(rehydrateReviewScope(payload));
      return;
    case 'verdict_revision':
      await db.verdictRevisions.put(rehydrateVerdictRevision(payload));
      return;
    case 'investigation_finding':
      await db.investigationFindings.put(rehydrateInvestigationFinding(payload));
      return;
    case 'prepared_change':
      await db.preparedChanges.put(rehydratePreparedChange(payload));
      return;
    case 'intent_trace':
      await db.intentTraces.put(rehydrateIntentTrace(payload));
      return;
    case 'decision_trace':
      await db.decisionTraces.put(rehydrateDecisionTrace(payload));
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
    case 'understanding_project': {
      const p = await db.understandingProjects.get(entry.id);
      return p ? envelopeUnderstandingProject(p) : null;
    }
    case 'project_association': {
      const a = await db.projectAssociations.get(entry.id);
      return a ? envelopeProjectAssociation(a) : null;
    }
    case 'understanding_object': {
      const o = await db.understandingObjects.get(entry.id);
      return o ? envelopeUnderstandingObject(o) : null;
    }
    case 'understanding_event': {
      const e = await db.understandingEvents.get(entry.id);
      return e ? envelopeUnderstandingEvent(e) : null;
    }
    case 'investigation_case': {
      const c = await db.investigationCases.get(entry.id);
      return c ? envelopeInvestigationCase(c) : null;
    }
    case 'case_exhibit': {
      const e = await db.caseExhibits.get(entry.id);
      return e ? envelopeCaseExhibit(e) : null;
    }
    case 'review_scope': {
      const s = await db.reviewScopes.get(entry.id);
      return s ? envelopeReviewScope(s) : null;
    }
    case 'verdict_revision': {
      const v = await db.verdictRevisions.get(entry.id);
      return v ? envelopeVerdictRevision(v) : null;
    }
    case 'investigation_finding': {
      const finding = await db.investigationFindings.get(entry.id);
      return finding ? envelopeInvestigationFinding(finding) : null;
    }
    case 'prepared_change': {
      const change = await db.preparedChanges.get(entry.id);
      return change ? envelopePreparedChange(change) : null;
    }
    case 'intent_trace': {
      const trace = await db.intentTraces.get(entry.id);
      return trace ? envelopeIntentTrace(trace) : null;
    }
    case 'decision_trace': {
      const trace = await db.decisionTraces.get(entry.id);
      return trace ? envelopeDecisionTrace(trace) : null;
    }
  }
}

// Every table that syncs, with its wire kind. Local-only tables are
// deliberately absent (guarded by db/localOnly.test.ts); the sync ledger is
// the one local-only table the engine writes, and it holds only kinds/ids.
function syncedTables(): Array<[SyncKind, { toCollection(): { primaryKeys(): Promise<unknown[]> } }]> {
  return [
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
    ['understanding_project', db.understandingProjects],
    ['project_association', db.projectAssociations],
    ['understanding_object', db.understandingObjects],
    ['understanding_event', db.understandingEvents],
    ['investigation_case', db.investigationCases],
    ['case_exhibit', db.caseExhibits],
    ['review_scope', db.reviewScopes],
    ['verdict_revision', db.verdictRevisions],
    ['investigation_finding', db.investigationFindings],
    ['prepared_change', db.preparedChanges],
    ['intent_trace', db.intentTraces],
    ['decision_trace', db.decisionTraces],
  ];
}

export function storageKey(kind: string, id: string): string {
  return `${kind}\u0000${id}`;
}

export interface SyncStatus {
  /** Engine running (vault unlocked and start() called). */
  running: boolean;
  /** A push/pull is in flight. */
  syncing: boolean;
  /** Local changes waiting to upload. */
  pending: number;
  lastSyncAt: Date | null;
  lastError: string | null;
}

type StatusListener = (status: SyncStatus) => void;

class SyncEngine {
  private timer: ReturnType<typeof setInterval> | null = null;
  private pushTimer: ReturnType<typeof setTimeout> | null = null;
  private pushDueBy = 0;
  private pushDelayMs = PUSH_DELAY_MS;
  private pageListeners = false;
  private attached: Promise<void> | null = null;
  private inflight = false;
  private current: Promise<void> | null = null;
  private suspended = false;
  private dirty: DirtyEntry[] = [];
  private lastSyncAt: Date | null = null;
  private lastError: string | null = null;
  private listeners = new Set<StatusListener>();

  getStatus(): SyncStatus {
    return {
      running: this.timer !== null,
      syncing: this.inflight,
      pending: this.dirty.length,
      lastSyncAt: this.lastSyncAt,
      lastError: this.lastError,
    };
  }

  /** `${kind}\u0000${id}` for every change waiting to upload. */
  getPendingKeys(): Set<string> {
    return new Set(this.dirty.map((d) => storageKey(d.kind, d.id)));
  }

  subscribe(listener: StatusListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    const status = this.getStatus();
    for (const listener of this.listeners) listener(status);
  }

  /**
   * Start recording local changes. Call once at app boot, whether or not the
   * vault is unlocked: changes made while locked or signed out queue up (ids
   * and kinds only) and upload once sync starts. Idempotent.
   */
  attach(): Promise<void> {
    this.attached ??= (async () => {
      // Restore the dirty queue from a previous session. Filter out
      // device-local metadata entries that older engine versions enqueued.
      const saved = (await getMetadata<DirtyEntry[]>(DIRTY_KEY)) ?? [];
      const restored = saved.filter(isSyncableEntry);
      // Keep anything hooks queued while the metadata read was in flight.
      const queuedMeanwhile = this.dirty;
      this.dirty = restored.filter(
        (r) => !queuedMeanwhile.some((q) => q.id === r.id && q.kind === r.kind)
      );
      this.dirty.push(...queuedMeanwhile);
      this.installHooks();
      this.emit();
    })();
    return this.attached;
  }

  async start(pullIntervalMs = PULL_INTERVAL_MS, pushDelayMs = PUSH_DELAY_MS): Promise<void> {
    if (this.timer) return;
    if (!isUnlocked()) {
      throw new Error('Cannot start sync engine while vault is locked');
    }

    await this.attach();
    this.pushDelayMs = pushDelayMs;
    this.timer = setInterval(() => {
      // Hidden tab: skip the poll so the server (and Neon) can idle. Local
      // changes still upload via schedulePush.
      if (isPageHidden()) return;
      void this.tick();
    }, pullIntervalMs);
    this.installPageListeners();
    this.emit();
    // Catch up on rows the server has never seen, then sync immediately.
    await this.reconcile();
    void this.tick();
  }

  /** Stop syncing. Hooks stay attached, so changes keep queueing. */
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.cancelScheduledPush();
    this.emit();
  }

  /** Upload queued changes now, without pulling. Waits out a running tick. */
  async push(): Promise<void> {
    this.cancelScheduledPush();
    while (this.current) await this.current;
    if (this.dirty.length === 0) return;
    await this.run(false);
  }

  /**
   * Debounced upload after a local write: PUSH_DELAY_MS after writes go quiet,
   * capped at PUSH_MAX_WAIT_MS from the first write so a long import still
   * uploads as it goes.
   */
  private schedulePush(): void {
    if (!this.timer || this.suspended) return;
    const now = Date.now();
    if (!this.pushTimer) this.pushDueBy = now + PUSH_MAX_WAIT_MS;
    else clearTimeout(this.pushTimer);
    const delay = Math.max(0, Math.min(this.pushDelayMs, this.pushDueBy - now));
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null;
      void this.push();
    }, delay);
  }

  private cancelScheduledPush(): void {
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.pushTimer = null;
  }

  /**
   * Back on the tab: catch up on other devices right away. Leaving it (tab
   * switch, minimize, close): upload what's queued now. Best-effort on close —
   * the queue is persisted, so anything cut off uploads on the next open.
   */
  private installPageListeners(): void {
    if (this.pageListeners || typeof document === 'undefined') return;
    this.pageListeners = true;
    document.addEventListener('visibilitychange', () => {
      if (!this.timer) return;
      if (isPageHidden()) void this.push();
      else void this.tick();
    });
    window.addEventListener('pagehide', () => {
      if (this.timer) void this.push();
    });
  }

  /**
   * Force a flush + pull. Useful for tests and a manual "Sync now" button.
   * While a tick is already running, callers join it instead of returning
   * before anything has synced.
   */
  tick(): Promise<void> {
    if (this.current) return this.current;
    return this.run(true);
  }

  private run(pull: boolean): Promise<void> {
    if (this.current) return this.current;
    if (this.suspended || !isUnlocked()) return Promise.resolve();
    this.current = this.runTick(pull).finally(() => {
      this.current = null;
    });
    return this.current;
  }

  private async runTick(pull: boolean): Promise<void> {
    this.inflight = true;
    this.emit();
    try {
      // Drain the whole queue, not one batch per tick: catch-up after a long
      // locked period can be thousands of rows.
      let guard = 1_000;
      while (this.dirty.length > 0 && guard-- > 0) await this.flushDirty();
      if (pull) await this.pullDelta();
      this.lastSyncAt = new Date();
      this.lastError = null;
    } catch (err) {
      console.error('[sync] tick failed', err);
      this.lastError = err instanceof Error ? err.message : String(err);
    } finally {
      this.inflight = false;
      this.emit();
    }
  }

  /**
   * Queue every syncable row the ledger has no record of: rows written before
   * the hooks were attached (older builds, signed-out periods), or before
   * this device ever synced. Content-free: compares kinds and ids only.
   */
  async reconcile(): Promise<number> {
    const known = new Set(
      (await db.syncLedger.toArray()).map((row) => storageKey(row.kind, row.id))
    );
    const queued = this.getPendingKeys();
    let added = 0;
    for (const [kind, table] of syncedTables()) {
      for (const key of await table.toCollection().primaryKeys()) {
        const tag = storageKey(kind, String(key));
        if (known.has(tag) || queued.has(tag)) continue;
        const before = this.dirty.length;
        this.markDirty({ id: String(key), kind });
        if (this.dirty.length > before) added++;
      }
    }
    return added;
  }

  async wipeLocalCursor(): Promise<void> {
    await setMetadata(PULL_CURSOR_KEY, null);
    this.dirty = [];
    await setMetadata(DIRTY_KEY, []);
    this.emit();
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
    this.emit();
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
      // The server holds nothing now; the ledger must not claim otherwise.
      await db.syncLedger.clear();
    });
    this.emit();
  }

  /**
   * Mark every local row dirty and flush, re-pushing the full dataset.
   * Recovery path after a server wipe, and for rows created while the engine
   * was stopped (hooks never saw them, so they otherwise never upload).
   */
  async resyncAll(): Promise<void> {
    if (!isUnlocked()) throw new Error('Cannot re-upload while vault is locked');
    const tables = syncedTables();
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

    db.understandingProjects.hook('creating', upsert('understanding_project'));
    db.understandingProjects.hook('updating', (_m, k) => upsert('understanding_project')(k as string));
    db.understandingProjects.hook('deleting', remove('understanding_project'));

    db.projectAssociations.hook('creating', upsert('project_association'));
    db.projectAssociations.hook('updating', (_m, k) => upsert('project_association')(k as string));
    db.projectAssociations.hook('deleting', remove('project_association'));

    db.understandingObjects.hook('creating', upsert('understanding_object'));
    db.understandingObjects.hook('updating', (_m, k) => upsert('understanding_object')(k as string));
    db.understandingObjects.hook('deleting', remove('understanding_object'));

    db.understandingEvents.hook('creating', upsert('understanding_event'));
    db.understandingEvents.hook('updating', (_m, k) => upsert('understanding_event')(k as string));
    db.understandingEvents.hook('deleting', remove('understanding_event'));

    // Decision-investigation human records (DI-2c). rawSources and
    // investigationAnchors are deliberately NOT hooked — local-only by
    // design (SPEC-decision-investigation §21 decisions 3–4).
    db.investigationCases.hook('creating', upsert('investigation_case'));
    db.investigationCases.hook('updating', (_m, k) => upsert('investigation_case')(k as string));
    db.investigationCases.hook('deleting', remove('investigation_case'));

    db.caseExhibits.hook('creating', upsert('case_exhibit'));
    db.caseExhibits.hook('updating', (_m, k) => upsert('case_exhibit')(k as string));
    db.caseExhibits.hook('deleting', remove('case_exhibit'));

    db.reviewScopes.hook('creating', upsert('review_scope'));
    db.reviewScopes.hook('updating', (_m, k) => upsert('review_scope')(k as string));
    db.reviewScopes.hook('deleting', remove('review_scope'));

    db.verdictRevisions.hook('creating', upsert('verdict_revision'));
    db.verdictRevisions.hook('updating', (_m, k) => upsert('verdict_revision')(k as string));
    db.verdictRevisions.hook('deleting', remove('verdict_revision'));

    db.investigationFindings.hook('creating', upsert('investigation_finding'));
    db.investigationFindings.hook('updating', (_m, k) =>
      upsert('investigation_finding')(k as string)
    );
    db.investigationFindings.hook('deleting', remove('investigation_finding'));

    db.preparedChanges.hook('creating', upsert('prepared_change'));
    db.preparedChanges.hook('updating', (_m, k) => upsert('prepared_change')(k as string));
    db.preparedChanges.hook('deleting', remove('prepared_change'));

    db.intentTraces.hook('creating', upsert('intent_trace'));
    db.intentTraces.hook('updating', (_m, k) => upsert('intent_trace')(k as string));
    db.intentTraces.hook('deleting', remove('intent_trace'));

    db.decisionTraces.hook('creating', upsert('decision_trace'));
    db.decisionTraces.hook('updating', (_m, k) => upsert('decision_trace')(k as string));
    db.decisionTraces.hook('deleting', remove('decision_trace'));

    // Dexie hooks have no portable unsubscribe; attach() installs them once
    // for the page lifetime and stop() leaves them in place.
  }

  private markDirty(entry: DirtyEntry): void {
    if (this.suspended || !isSyncableEntry(entry)) return;
    // Coalesce: keep latest state per (kind, id). If a delete arrives after an
    // upsert (or vice versa), the latter wins.
    this.dirty = this.dirty.filter((d) => !(d.id === entry.id && d.kind === entry.kind));
    this.dirty.push(entry);
    this.emit();
    this.schedulePush();
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
        // The server rejects an empty-string parent (and the whole batch with
        // it); "no parent" is null on the wire.
        parentId: env.parentId || null,
        iv: bufToB64(sealed.iv),
        ciphertext: bufToB64(sealed.ciphertext),
        updatedAt: env.updatedAt.toISOString(),
        deleted: entry.deleted ?? false,
      });
    }

    try {
      await pushRecords(wire);
      await setMetadata(DIRTY_KEY, this.dirty);
      await recordInLedger(wire);
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
          const queuedBefore = new Set(this.dirty);
          await applyIncomingRecord(rec, payload);
          // Applying the record fires our own hooks; don't queue the server's
          // copy straight back up to the server.
          this.dirty = this.dirty.filter(
            (d) => queuedBefore.has(d) || d.id !== rec.id || d.kind !== rec.kind
          );
          if (!(rec.kind === 'metadata' && isDeviceLocalMetadata(rec.id))) {
            await recordInLedger([rec]);
          }
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
    await setMetadata(DIRTY_KEY, this.dirty);
    this.emit();
  }
}

// The server now holds these records (pushed or pulled): remember upserts,
// forget tombstones.
async function recordInLedger(
  records: Array<{ id: string; kind: SyncKind; deleted?: boolean }>
): Promise<void> {
  const syncedAt = new Date();
  const live = records.filter((r) => !r.deleted);
  const gone = records.filter((r) => r.deleted);
  if (live.length > 0) {
    await db.syncLedger.bulkPut(live.map((r) => ({ kind: r.kind, id: r.id, syncedAt })));
  }
  if (gone.length > 0) {
    await db.syncLedger.bulkDelete(gone.map((r) => [r.kind, r.id] as [string, string]));
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

function isPageHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

export const syncEngine = new SyncEngine();

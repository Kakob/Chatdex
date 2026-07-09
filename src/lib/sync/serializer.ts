// Bidirectional conversion between in-memory Dexie row objects and the
// JSON-friendly payloads we encrypt for sync. Date fields become ISO strings
// on the wire and get rehydrated on the way back.
//
// We intentionally serialize *only* the fields that vary by row content.
// Fields that the server already knows (id, parent ids, kind) stay outside the
// ciphertext.

import type { StoredConversation, StoredMessage, StoredActivity, Tag, EntityTag, DailyStats, AppMetadata } from '../../types';
import type { StoredFinding, StoredDetectorRun } from '../../types/detection';
import type { AnchoredItem } from '../aipkms/types';
import type { KnowledgeFolderRow } from '../db/schema';
import type { SyncKind } from './syncApi';

export interface SyncEnvelope<TKind extends SyncKind = SyncKind> {
  kind: TKind;
  parentId: string | null;
  updatedAt: Date;
  payload: unknown;
}

function dateToIso(d: Date): string {
  return d.toISOString();
}

function isoToDate(s: string): Date {
  return new Date(s);
}

// --- conversations ---

export function envelopeConversation(c: StoredConversation): SyncEnvelope<'conversation'> {
  return {
    kind: 'conversation',
    parentId: null,
    updatedAt: c.updatedAt,
    payload: { ...c, createdAt: dateToIso(c.createdAt), updatedAt: dateToIso(c.updatedAt), importedAt: dateToIso(c.importedAt) },
  };
}

export function rehydrateConversation(payload: unknown): StoredConversation {
  const p = payload as StoredConversation & { createdAt: string; updatedAt: string; importedAt: string };
  return { ...p, createdAt: isoToDate(p.createdAt), updatedAt: isoToDate(p.updatedAt), importedAt: isoToDate(p.importedAt) };
}

// --- messages ---

export function envelopeMessage(m: StoredMessage): SyncEnvelope<'message'> {
  return {
    kind: 'message',
    parentId: m.conversationId,
    updatedAt: m.createdAt,
    payload: { ...m, createdAt: dateToIso(m.createdAt) },
  };
}

export function rehydrateMessage(payload: unknown): StoredMessage {
  const p = payload as StoredMessage & { createdAt: string };
  return { ...p, createdAt: isoToDate(p.createdAt) };
}

// --- activities ---

export function envelopeActivity(a: StoredActivity): SyncEnvelope<'activity'> {
  return {
    kind: 'activity',
    parentId: a.conversationId,
    updatedAt: a.timestamp,
    payload: { ...a, timestamp: dateToIso(a.timestamp) },
  };
}

export function rehydrateActivity(payload: unknown): StoredActivity {
  const p = payload as StoredActivity & { timestamp: string };
  return { ...p, timestamp: isoToDate(p.timestamp) };
}

// --- anchors ---

export function envelopeAnchor(a: AnchoredItem): SyncEnvelope<'anchor'> {
  return {
    kind: 'anchor',
    parentId: a.conversationId,
    updatedAt: a.updatedAt,
    payload: { ...a, createdAt: dateToIso(a.createdAt), updatedAt: dateToIso(a.updatedAt) },
  };
}

export function rehydrateAnchor(payload: unknown): AnchoredItem {
  const p = payload as AnchoredItem & { createdAt: string; updatedAt: string };
  return { ...p, createdAt: isoToDate(p.createdAt), updatedAt: isoToDate(p.updatedAt) };
}

// --- tags / entity_tags / folders / daily_stats / metadata ---

export function envelopeTag(t: Tag): SyncEnvelope<'tag'> {
  return {
    kind: 'tag',
    parentId: null,
    updatedAt: t.createdAt,
    payload: { ...t, createdAt: dateToIso(t.createdAt) },
  };
}

export function rehydrateTag(payload: unknown): Tag {
  const p = payload as Tag & { createdAt: string };
  return { ...p, createdAt: isoToDate(p.createdAt) };
}

export function envelopeEntityTag(e: EntityTag): SyncEnvelope<'entity_tag'> {
  return {
    kind: 'entity_tag',
    parentId: e.tagId,
    updatedAt: e.createdAt,
    payload: { ...e, createdAt: dateToIso(e.createdAt) },
  };
}

export function rehydrateEntityTag(payload: unknown): EntityTag {
  const p = payload as EntityTag & { createdAt: string };
  return { ...p, createdAt: isoToDate(p.createdAt) };
}

export function envelopeFolder(f: KnowledgeFolderRow): SyncEnvelope<'folder'> {
  return {
    kind: 'folder',
    parentId: null,
    updatedAt: f.createdAt,
    payload: { ...f, createdAt: dateToIso(f.createdAt) },
  };
}

export function rehydrateFolder(payload: unknown): KnowledgeFolderRow {
  const p = payload as KnowledgeFolderRow & { createdAt: string };
  return { ...p, createdAt: isoToDate(p.createdAt) };
}

export function envelopeDailyStats(d: DailyStats): SyncEnvelope<'daily_stats'> {
  return {
    kind: 'daily_stats',
    parentId: null,
    updatedAt: new Date(),
    payload: d,
  };
}

export function rehydrateDailyStats(payload: unknown): DailyStats {
  return payload as DailyStats;
}

export function envelopeMetadata(m: AppMetadata): SyncEnvelope<'metadata'> {
  return {
    kind: 'metadata',
    parentId: null,
    updatedAt: new Date(),
    payload: m,
  };
}

export function rehydrateMetadata(payload: unknown): AppMetadata {
  return payload as AppMetadata;
}

// --- findings / detector runs (agent observability) ---

export function envelopeFinding(f: StoredFinding): SyncEnvelope<'finding'> {
  return {
    kind: 'finding',
    parentId: f.conversationId,
    updatedAt: f.updatedAt,
    payload: { ...f, createdAt: dateToIso(f.createdAt), updatedAt: dateToIso(f.updatedAt) },
  };
}

export function rehydrateFinding(payload: unknown): StoredFinding {
  const p = payload as StoredFinding & { createdAt: string; updatedAt: string };
  return { ...p, createdAt: isoToDate(p.createdAt), updatedAt: isoToDate(p.updatedAt) };
}

export function envelopeDetectorRun(r: StoredDetectorRun): SyncEnvelope<'detector_run'> {
  return {
    kind: 'detector_run',
    parentId: r.conversationId,
    updatedAt: r.finishedAt,
    payload: { ...r, startedAt: dateToIso(r.startedAt), finishedAt: dateToIso(r.finishedAt) },
  };
}

export function rehydrateDetectorRun(payload: unknown): StoredDetectorRun {
  const p = payload as StoredDetectorRun & { startedAt: string; finishedAt: string };
  return { ...p, startedAt: isoToDate(p.startedAt), finishedAt: isoToDate(p.finishedAt) };
}

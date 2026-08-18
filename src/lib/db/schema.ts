// Dexie (IndexedDB) schema for Chatdex local-first storage.
// Source of truth for all user data. Cloud sync (Phase 2) replicates this layer.

import Dexie, { type Table } from 'dexie';
import type {
  StoredConversation,
  StoredMessage,
  StoredActivity,
  Tag,
  EntityTag,
  AppMetadata,
  DailyStats,
} from '../../types';
import type { StoredFinding, StoredDetectorRun } from '../../types/detection';
import type {
  UnderstandingProject,
  ProjectAssociation,
  UnderstandingObject,
  UnderstandingEvent,
} from '../../types/understanding';
import type { AnchoredItem } from '../aipkms/types';
import type {
  RawSource,
  InvestigationAnchor,
  InvestigationCase,
  CaseExhibit,
  ReviewScope,
  VerdictRevision,
} from '../../types/investigation';

export interface KnowledgeFolderRow {
  id: string;
  name: string;
  createdAt: Date;
}

export class ChatdexDB extends Dexie {
  conversations!: Table<StoredConversation, string>;
  messages!: Table<StoredMessage, string>;
  activities!: Table<StoredActivity, string>;
  anchors!: Table<AnchoredItem, string>;
  tags!: Table<Tag, string>;
  entityTags!: Table<EntityTag, string>;
  knowledgeFolders!: Table<KnowledgeFolderRow, string>;
  dailyStats!: Table<DailyStats, string>;
  metadata!: Table<AppMetadata, string>;
  findings!: Table<StoredFinding, string>;
  detectorRuns!: Table<StoredDetectorRun, string>;
  understandingProjects!: Table<UnderstandingProject, string>;
  projectAssociations!: Table<ProjectAssociation, string>;
  understandingObjects!: Table<UnderstandingObject, string>;
  understandingEvents!: Table<UnderstandingEvent, string>;
  rawSources!: Table<RawSource, string>;
  investigationAnchors!: Table<InvestigationAnchor, string>;
  investigationCases!: Table<InvestigationCase, string>;
  caseExhibits!: Table<CaseExhibit, string>;
  reviewScopes!: Table<ReviewScope, string>;
  verdictRevisions!: Table<VerdictRevision, string>;

  constructor() {
    super('chatdex');
    this.version(1).stores({
      conversations: '&id, source, updatedAt, importedAt, [source+updatedAt]',
      messages: '&id, conversationId, [conversationId+createdAt], createdAt',
      activities: '&id, timestamp, source, conversationId, [source+timestamp]',
      anchors:
        '&id, conversationId, messageId, priority, folder, workspaceId, createdAt, updatedAt',
      tags: '&id, &name, category',
      entityTags:
        '&id, &[tagId+entityId+entityType], [entityType+entityId], tagId',
      knowledgeFolders: '&id, &name',
      dailyStats: '&date',
      metadata: '&key',
    });
    // v2: agent-observability entities (SPEC-agent-observability.md §3).
    this.version(2).stores({
      findings:
        '&id, conversationId, runId, detector, severity, userLabel, createdAt, [conversationId+createdAt]',
      detectorRuns: '&id, &runKey, conversationId, finishedAt',
    });
    // v3: shared-understanding entities (PRD-shared-understanding-workspace.md §6-§11).
    this.version(3).stores({
      understandingProjects: '&id, name, reviewState, updatedAt',
      projectAssociations:
        '&id, projectId, conversationId, reviewState, &[projectId+conversationId]',
      understandingObjects:
        '&id, projectId, type, status, reviewState, updatedAt, [projectId+status]',
      understandingEvents: '&id, objectId, op, occurredAt, [objectId+occurredAt]',
    });
    // v4: events become reviewable (U3.1). Pre-existing events were all
    // AI-introduced and already applied to their objects, so they backfill
    // as accepted — review gating only affects events created from here on.
    this.version(4)
      .stores({})
      .upgrade(async (tx) => {
        await tx
          .table('understandingEvents')
          .toCollection()
          .modify((e: Partial<UnderstandingEvent>) => {
            e.origin = e.origin ?? 'ai';
            e.reviewState = e.reviewState ?? 'accepted';
          });
      });
    // v5: immutable raw-source retention (SPEC-decision-investigation §7.1,
    // phase DI-1a). LOCAL-ONLY — deliberately never hooked into the sync
    // engine (spec §21 decision 3): raw payloads must not enter the
    // ciphertext sync path; only hash/provenance metadata may ever sync.
    this.version(5).stores({
      rawSources: '&id, &contentHash, importedAt, *conversationIds',
    });
    // v6: derived investigation anchors (SPEC-decision-investigation §7.3,
    // DI-1b). LOCAL-ONLY, rebuilt deterministically from stored messages —
    // never synced (spec §21 decision 3). Named investigationAnchors because
    // `anchors` is the AIPKMS bookmark table (§21 decision 8).
    this.version(6).stores({
      investigationAnchors: '&id, conversationId, occurredAt, *filePaths',
    });
    // v7: investigation cases, exhibits, review scopes (spec §8.3–§8.7,
    // DI-2c) — human-authored records that SYNC (encrypted) like findings.
    this.version(7).stores({
      investigationCases:
        '&id, conversationId, primaryAnchorStableKey, state, updatedAt',
      caseExhibits: '&id, caseId, conversationId',
      reviewScopes: '&id, caseId, conversationId',
    });
    // v8: verdict revisions (spec §8.9, DI-3) — append-only adjudication
    // snapshots, synced encrypted like the other human records.
    this.version(8).stores({
      verdictRevisions: '&id, caseId, conversationId, &[caseId+revisionNumber]',
    });
  }
}

export const db = new ChatdexDB();

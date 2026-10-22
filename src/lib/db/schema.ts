// Dexie (IndexedDB) schema for Chatdex local-first storage.
// Source of truth for all user data. Cloud sync (Phase 2) replicates this layer.

import type { ResearchSource, ResearchSnapshot, ResearchExhibit, QuestionRelation } from '../../types/research';
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
  InvestigationFinding,
} from '../../types/investigation';
import type { PreparedChange } from '../../types/preparedChange';
import type { IntentTrace } from '../../types/intentTrace';
import type { RepoFileRow, InspectionRow } from '../../types/repo';
import type { DecisionTrace, AgentInspection, DecisionDiff } from '../../types/decision';

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
  preparedChanges!: Table<PreparedChange, string>;
  investigationFindings!: Table<InvestigationFinding, string>;
  intentTraces!: Table<IntentTrace, string>;
  repoFiles!: Table<RepoFileRow, [string, string, string]>;
  inspections!: Table<InspectionRow, string>;
  decisionTraces!: Table<DecisionTrace, string>;
  agentInspections!: Table<AgentInspection, string>;
  decisionDiffs!: Table<DecisionDiff, string>;

  researchSources!: Table<ResearchSource, string>;
  researchSnapshots!: Table<ResearchSnapshot, string>;
  researchExhibits!: Table<ResearchExhibit, string>;
  questionRelations!: Table<QuestionRelation, string>;

  constructor(name = 'chatdex') {
    super(name);
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
    // v2: agent-observability entities (docs/capabilities/agent-observability/SPEC.md §3).
    this.version(2).stores({
      findings:
        '&id, conversationId, runId, detector, severity, userLabel, createdAt, [conversationId+createdAt]',
      detectorRuns: '&id, &runKey, conversationId, finishedAt',
    });
    // v3: shared-understanding entities (docs/capabilities/understanding-workspace/PRD.md §6-§11).
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
    // v9: project-scoped implementation handoffs. These are human-authored
    // records; source material remains canonical in conversations/messages.
    this.version(9).stores({
      preparedChanges: '&id, projectId, state, updatedAt, [projectId+updatedAt]',
    });
    // v10: question-first project investigations and their human findings.
    // Existing anchor cases remain intact and backfill their discriminator.
    this.version(10)
      .stores({
        investigationCases:
          '&id, projectId, conversationId, primaryAnchorStableKey, kind, state, updatedAt, [projectId+updatedAt]',
        investigationFindings: '&id, caseId, projectId, state, updatedAt',
      })
      .upgrade(async (tx) => {
        await tx
          .table('investigationCases')
          .toCollection()
          .modify((row: Partial<InvestigationCase>) => {
            row.kind = row.kind ?? 'anchor';
          });
      });
    // v11: intent traces (SPEC-intent-trace §11.3) — append-only synthesis
    // output, one row per (intent, commit); synced as ciphertext. The intent
    // objects themselves are understandingObjects rows (type 'intent') whose
    // new optional `meta` field needs no schema change (unindexed).
    this.version(11).stores({
      intentTraces:
        '&id, projectId, intentObjectId, createdAt, [projectId+createdAt], [intentObjectId+createdAt]',
    });
    // v12: Change Workspace local caches (SPEC-change-workspace §7.2).
    // BOTH LOCAL-ONLY — never hooked into the sync engine (law §2.5, D3, D9):
    // `repoFiles` holds whole repository files for client-side search (the
    // synced workspace keeps only capped quotes); `inspections` is the
    // human view log behind PRD §17 counts.
    this.version(12).stores({
      repoFiles: '&[repoKey+sha+path], repoKey, sha, [repoKey+sha]',
      inspections: '&id, workspaceId, projectId, [projectId+targetKey], at',
    });
    // v13: Decision Recovery (SPEC-decision-recovery §7.5). `decisionTraces`
    // is append-only synthesis output, one row per (decision, run), synced
    // as ciphertext (kind 'decision_trace'). `agentInspections` (what the
    // agent read) and `decisionDiffs` (Semantic Decision Diff) are BOTH
    // LOCAL-ONLY derived rows — never hooked into the sync engine (law 2.9).
    this.version(13).stores({
      decisionTraces:
        '&id, projectId, decisionObjectId, runId, createdAt, [projectId+createdAt], [decisionObjectId+createdAt], [projectId+runId]',
      agentInspections: '&id, conversationId, path, [conversationId+stepIndex]',
      decisionDiffs: '&id, projectId, toRunId, createdAt',
    });
    // Additive only. Private source inventory, text and locators never sync.
    this.version(14).stores({
      researchSources: '&id, projectId, [projectId+registryId]',
      researchSnapshots: '&id, sourceId, &[sourceId+contentHash]',
      researchExhibits: '&id, caseId, sourceId',
      questionRelations: '&id, projectId',
    });
  }
}

export const db = new ChatdexDB();

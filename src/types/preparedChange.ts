import type { EvidenceRef } from './understanding';
import type { EvidenceItem } from './evidence';

/**
 * Lifecycle (SPEC-change-workspace §7.1):
 * draft → ready → implementing → verified → closed; superseded from anywhere.
 * Intent/criteria freeze at `ready`; the open hypothesis freezes on attach.
 */
export type PreparedChangeState =
  | 'draft'
  | 'ready'
  | 'implementing'
  | 'verified'
  | 'closed'
  | 'superseded';

export interface PreparedChangeEvidenceRef extends EvidenceRef {
  understandingPointId: string;
}

export interface PreparedChangeRepositoryRef {
  remoteUrl?: string;
  baseCommit?: string;
  implicatedPaths?: string[];
}

// --- Change Workspace sections (§7.1). Nested timestamps are ISO strings (D11). ---

export interface WorkspaceIntent {
  currentBehavior: string;
  desiredBehavior: string;
  whyItMatters: string;
}

export interface Criterion {
  id: string;
  text: string;
  createdAt: string;
}

export type TraceNodeKind =
  | 'behavior'
  | 'component'
  | 'function'
  | 'route'
  | 'endpoint'
  | 'service'
  | 'db'
  | 'event'
  | 'state'
  | 'external'
  | 'test'
  | 'unknown'
  | 'other';

export interface TraceNode {
  id: string;
  label: string;
  kind: TraceNodeKind;
  evidenceIds: string[];
  order: number;
  /** Node this one branches from, for non-linear traces. */
  branchOf?: string;
}

export interface TraceEdge {
  id: string;
  from: string;
  to: string;
  claim?: string;
  evidenceIds: string[];
  /** The one human-set override (D4); every other state is derived from evidence. */
  override?: { verification: 'contradicted'; note: string };
  origin: 'user' | 'ai';
}

export interface WorkspaceTrace {
  nodes: TraceNode[];
  edges: TraceEdge[];
}

export interface Hypothesis {
  id: string;
  text: string;
  createdAt: string;
  /** Set when an implementation is attached (law §2.4). Frozen text is immutable. */
  frozenAt?: string;
  origin: 'user' | 'ai';
}

export type ImplementationSource =
  | 'github_compare'
  | 'github_pr'
  | 'claude_code_session'
  | 'pasted_diff';

export type ImplementationProvenance = 'human' | 'ai' | 'human_ai' | 'imported';

export interface ImplementationFile {
  path: string;
  additions: number;
  deletions: number;
  /** ≤ 20 KB, secret-scrubbed; optional (stats-only allowed). */
  patch?: string;
}

export interface Implementation {
  source: ImplementationSource;
  provenance: ImplementationProvenance;
  provenanceNote?: string;
  baseSha?: string;
  headSha?: string;
  prNumber?: number;
  conversationId?: string;
  files: ImplementationFile[];
  attachedAt: string;
}

export type VerificationStatus = 'supported' | 'contradicted' | 'partial' | 'unverified';

export interface VerificationRow {
  criterionId: string;
  evidenceIds: string[];
  status: VerificationStatus;
  /** Required when a criterion is accepted as unverified at `markVerified`. */
  note?: string;
  updatedAt: string;
}

export interface WorkspaceLearned {
  text: string;
  createdAt: string;
  updatedAt: string;
  /** AI draft (Assisted mode) — never copied into `text` without a human accept (law §2.3). */
  aiSuggested?: string;
}

export interface WorkspacePromotion {
  evidenceIds: string[];
  understandingObjectId: string;
  promotedAt: string;
}

export type WorkspaceMode = 'guided' | 'assisted';

export type WorkspaceOriginKind =
  | 'question'
  | 'conversation'
  | 'understanding'
  | 'finding'
  | 'issue'
  | 'commit'
  | 'manual';

export interface WorkspaceOriginRef {
  kind: WorkspaceOriginKind;
  id?: string;
  url?: string;
}

/**
 * Human-authored implementation intent compiled from accepted understanding —
 * and, since SPEC-change-workspace, the persistent Change Workspace around it.
 * All workspace sections are optional so pre-existing rows stay valid.
 */
export interface PreparedChange {
  id: string;
  projectId: string;
  title: string;
  state: PreparedChangeState;
  desiredOutcome: string;
  rationale: string;
  nonGoals: string[];
  constraints: string[];
  acceptanceCriteria: string[];
  openImplementationChoices: string[];
  understandingPointIds: string[];
  investigationFindingIds: string[];
  /** Frozen when the record becomes ready; primary sources remain authoritative. */
  evidenceRefs: PreparedChangeEvidenceRef[];
  repositoryRef?: PreparedChangeRepositoryRef;

  // Change Workspace sections (§7.1)
  intent?: WorkspaceIntent;
  /** Structured criteria; `acceptanceCriteria` mirrors their text for the export. */
  criteria?: Criterion[];
  evidence?: EvidenceItem[];
  trace?: WorkspaceTrace;
  hypotheses?: Hypothesis[];
  implementation?: Implementation;
  /** Earlier attachments, newest last, when an implementation is replaced. */
  implementationHistory?: Implementation[];
  verification?: VerificationRow[];
  learned?: WorkspaceLearned;
  promotions?: WorkspacePromotion[];
  /** UnderstandingObject ids of type 'question'. */
  questionIds?: string[];
  mode?: WorkspaceMode;
  modeHistory?: { mode: WorkspaceMode; at: string }[];
  originRef?: WorkspaceOriginRef;

  createdAt: Date;
  updatedAt: Date;
  readyAt?: Date;
  implementingAt?: Date;
  verifiedAt?: Date;
  closedAt?: Date;
}

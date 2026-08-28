import type { EvidenceItem } from './evidence';

// Shared-understanding-workspace entities (PRD-shared-understanding-workspace.md §6-§11).
// Stored plaintext in IndexedDB, ciphertext in Postgres via the sync layer —
// same privacy posture as findings/detector runs.
//
// Naming: "UnderstandingProject" (not "Project") to avoid collision with
// StoredConversation.projectPath (a Claude Code cwd) and the aipkms Workspace.
//
// Deliberately minimal ontology (PRD §7): object `type` is an open string so
// early usage can discover which types earn first-class treatment. Temporal
// history (PRD §8) and provenance (PRD §9) live on UnderstandingEvent rows:
// evidence arrives as events, so an object's derived-from list is the union of
// its events' evidence and its lifecycle is replayable from its event stream.

/** PRD §11: AI inferred → pending → accepted / edited / rejected. */
export type ReviewState = 'pending' | 'accepted' | 'edited' | 'rejected';

/** Who asserted this row. AI-origin rows require evidence; user-origin may not have any. */
export type UnderstandingOrigin = 'ai' | 'user';

/** PRD §9 navigation chain: object → evidence → conversation → messages. */
export interface EvidenceRef {
  conversationId: string;
  /** Exact relevant messages, when the extractor can anchor that precisely. */
  messageIds?: string[];
  /** Short quote or rationale for why this source supports the object. */
  note?: string;
}

/**
 * GitHub repository a project is bound to for Intent Trace
 * (SPEC-intent-trace §8.3). Read-only; traces pin to a resolved commit sha.
 */
export interface ProjectRepository {
  owner: string;
  repo: string;
  defaultBranch?: string;
  /** Branch, tag, or sha to trace against instead of the default branch head. */
  pinnedRef?: string;
}

/** A project reconstructed from conversation history (PRD §6). */
export interface UnderstandingProject {
  id: string;
  name: string;
  description?: string;
  origin: UnderstandingOrigin;
  reviewState: ReviewState;
  /** Intent Trace repository binding (SPEC-intent-trace §8.3). Unindexed. */
  repository?: ProjectRepository;
  /**
   * Intent-extraction cursor (SPEC-intent-trace §7.4): the latest conversation
   * `updatedAt` an extraction run has processed. Same caveat as
   * lastReconciledAt — a conversation associated later with an older
   * updatedAt is skipped until a full re-run.
   */
  lastIntentExtractedAt?: Date;
  /**
   * Reconciliation cursor (U3.2): the latest conversation `updatedAt` a
   * reconcile run has processed. Runs only consider conversations newer than
   * this. Known limitation: a conversation imported or associated later with
   * an older updatedAt is skipped until a full re-run.
   */
  lastReconciledAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Conversation ↔ project link. Non-exclusive (PRD §6): a conversation may
 * have zero, one, or many associations.
 */
export interface ProjectAssociation {
  id: string;
  projectId: string;
  conversationId: string;
  /** AI-proposed likelihood in [0, 1]; 1 for user-asserted associations. */
  confidence: number;
  /** Human-readable rationale, e.g. "primarily discusses living documents". */
  reason?: string;
  origin: UnderstandingOrigin;
  reviewState: ReviewState;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Lifecycle status derivable from the event stream but denormalized for
 * indexed "what is current" queries (PRD §8: current vs. previous directions).
 * 'reopened' maps back to 'current'.
 */
export type UnderstandingStatus = 'current' | 'superseded' | 'resolved';

/** One synthesized unit of understanding (PRD §7). */
export interface UnderstandingObject {
  id: string;
  /** null = relates to the user generally / no known project (PRD §6). */
  projectId: string | null;
  /** Open ontology: 'idea', 'decision', 'question', 'direction', … (PRD §7). */
  type: string;
  /** Concise statement of the understanding. */
  title: string;
  /** Optional longer body. */
  body?: string;
  status: UnderstandingStatus;
  origin: UnderstandingOrigin;
  reviewState: ReviewState;
  /**
   * Type-specific scalar attributes, unindexed. Intents (SPEC-intent-trace
   * §11.1) carry polarity, origin, promptedByQuestion, statedAt (ISO), and
   * confidence here rather than overloading `type` or `body`.
   */
  meta?: Record<string, string | number | boolean>;
  createdAt: Date;
  updatedAt: Date;
}

/** PRD §8 temporal relations; also the reconciliation ops of PRD §10. */
export type UnderstandingOp =
  | 'introduced'
  | 'supported'
  | 'refined'
  | 'superseded'
  | 'contradicted'
  | 'reopened'
  | 'resolved';

/**
 * One change to an object's understanding, anchored to source evidence.
 * Events are append-only: reconciliation (PRD §10) emits new events rather
 * than rewriting history, mirroring the findings-immutability invariant.
 * The only mutable part is review (PRD §11): AI-proposed events land
 * 'pending' and change the object's status only once accepted.
 */
export interface UnderstandingEvent {
  id: string;
  objectId: string;
  op: UnderstandingOp;
  /** What changed, e.g. the refined wording or the contradiction found. */
  detail?: string;
  /** For 'superseded': the object that replaces this one, when known. */
  supersededByObjectId?: string;
  evidence: EvidenceRef[];
  /**
   * Code / test evidence promoted from a Change Workspace
   * (SPEC-change-workspace §8, §12). Unindexed; optional.
   */
  codeEvidence?: EvidenceItem[];
  origin: UnderstandingOrigin;
  /** 'pending' events are proposals: recorded, visible, but not yet applied. */
  reviewState: ReviewState;
  /** When the change happened in the source timeline (conversation time). */
  occurredAt: Date;
  /** When Chatdex recorded the event (analysis time). */
  createdAt: Date;
  /** Set when review changes the event; sync LWW uses it over createdAt. */
  updatedAt?: Date;
}

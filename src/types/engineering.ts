// Engineering abstraction prototype (docs/changes/engineering-abstraction-prototype/PLAN.md).
//
// EXPERIMENTAL. Everything here lives in the prototype's own LOCAL-ONLY
// IndexedDB database (`chatdex-engineering-prototype`) and is never synced.
//
// Concepts and statements deliberately reuse the existing shapes verbatim:
// a concept is a LandscapeRegion (identity + containment) and a statement is
// an UnderstandingObject (what is intended / believed / observed), with
// UnderstandingEvent rows for history. Only what the landscape has no notion
// of is new here: typed relationships, source bindings, contract change
// proposals, and imported verification evidence.

import type { LandscapeRegion } from './landscape';
import type { ReviewState, UnderstandingEvent, UnderstandingObject } from './understanding';

export type EngineeringConcept = LandscapeRegion;
export type EngineeringStatement = UnderstandingObject;
export type EngineeringStatementEvent = UnderstandingEvent;

/** Statement `type` values the prototype writes (open ontology, like the landscape). */
export type EngineeringStatementType =
  | 'guarantee'
  | 'behavior'
  | 'constraint'
  | 'limitation'
  | 'question'
  | 'decision';

/** Who authored a modeled record. 'fixture' = shipped synthetic demo data, labeled as such. */
export type EngineeringAuthor = 'fixture' | 'user';

// ---------------------------------------------------------------------------
// Relationships

export type RelationKind =
  | 'depends_on'
  | 'implements'
  | 'constrains'
  | 'requires'
  | 'enables'
  | 'supports'
  | 'verified_by';

/** A typed, directional edge between two concept ids: `from <kind> to`. */
export interface EngineeringRelationship {
  id: string;
  projectId: string;
  from: string;
  to: string;
  kind: RelationKind;
  /** Why this relationship holds, in engineering terms. */
  explanation: string;
  author: EngineeringAuthor;
  reviewState: ReviewState;
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// Contracts: a guarantee statement with structured parameters.
// Values live on the statement's `meta` as `p.<key>` entries.

export interface ContractParameterOption {
  value: string;
  label: string;
  description: string;
}

export interface ContractParameterDef {
  key: string;
  label: string;
  options: ContractParameterOption[];
}

export interface ContractDefinition {
  /** Stable contract key stored as `meta.contract` on the statement. */
  key: string;
  title: string;
  parameters: ContractParameterDef[];
  /** Returns a reason when a combination of values is not a coherent contract. */
  validate(values: ContractValues): string | null;
  /** Human statement of the contract for given values (statement title). */
  describe(values: ContractValues): string;
}

export type ContractValues = Record<string, string>;

// ---------------------------------------------------------------------------
// Rules and derived impact

export type ObligationKind =
  | 'state'
  | 'protocol'
  | 'mechanism'
  | 'storage'
  | 'documentation'
  | 'verification';

/** A condition on proposed contract values. All entries must match. */
export type RuleCondition = Record<string, string>;

export interface ObligationRule {
  id: string;
  /** Fires when `when` holds for the proposed values and did not hold before. */
  when: RuleCondition;
  /** Concept the obligation lands on. */
  conceptId: string;
  kind: ObligationKind;
  title: string;
  /** The engineering reason, stated as domain knowledge. */
  because: string;
  /** For verification obligations: the criterion that must be shown. */
  criterionId?: string;
}

export interface RulePack {
  id: string;
  version: string;
  contractKey: string;
  rules: ObligationRule[];
}

export interface ContractChange {
  statementId: string;
  contractKey: string;
  from: ContractValues;
  to: ContractValues;
}

/** One step of propagation: `relationshipId` carried the change from `fromConceptId` to `toConceptId`. */
export interface PropagationStep {
  relationshipId: string;
  kind: RelationKind;
  fromConceptId: string;
  toConceptId: string;
  /** 'forward' when the edge is from→to as stored; 'reverse' when it carried the change against its direction. */
  direction: 'forward' | 'reverse';
}

export interface Obligation {
  /** `${ruleId}` — stable across derivations of the same change. */
  id: string;
  ruleId: string;
  conceptId: string;
  kind: ObligationKind;
  title: string;
  because: string;
  /** Parameter changes that triggered the rule, e.g. "semantics: remove_on_dispatch → ack_after_processing". */
  trigger: string[];
  /** Shortest propagation path from the contract's concept; [] when on the same concept; null = model gap. */
  path: PropagationStep[] | null;
  criterionId?: string;
}

export interface AffectedConcept {
  conceptId: string;
  /** Shortest propagation path from the contract concept. */
  path: PropagationStep[];
  obligationIds: string[];
  /** 'unknown' = reachable through modeled relationships but no rule covers it — never "no impact". */
  status: 'covered' | 'unknown';
}

export interface ChangeImpact {
  change: ContractChange;
  rulePack: { id: string; version: string };
  contractConceptId: string;
  obligations: Obligation[];
  affectedConcepts: AffectedConcept[];
  /** Obligations whose concept no modeled relationship reaches. */
  modelGaps: string[];
  /** Criteria the change requires, in rule order. */
  criterionIds: string[];
}

// ---------------------------------------------------------------------------
// Source bindings

export type BindingRole = 'implementation' | 'test';

/** A confirmed, revision-pinned observation of a bound symbol. */
export interface BindingConfirmation {
  sha: string;
  startLine: number;
  endLine: number;
  sha256: string;
  confirmedAt: Date;
}

/** Concept/statement → a named symbol in a file of the bound repository. */
export interface EngineeringBinding {
  id: string;
  projectId: string;
  /** Concept or statement id. */
  targetId: string;
  path: string;
  symbol: string;
  role: BindingRole;
  author: EngineeringAuthor;
  /** Set only by an explicit user confirmation against an imported observation. */
  confirmed?: BindingConfirmation;
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// Evidence manifest (chatdex.engineering.evidence/v1), produced outside Chatdex
// by examples/event-queue/scripts/capture-evidence.mjs.

export const EVIDENCE_SCHEMA = 'chatdex.engineering.evidence/v1';

export type ManifestTestStatus = 'passed' | 'failed' | 'skipped' | 'todo';

export interface ManifestTest {
  id: string | null;
  name: string;
  file: string;
  status: ManifestTestStatus;
  durationMs: number;
  failureMessage?: string;
}

export interface ManifestSymbol {
  path: string;
  symbol: string;
  startLine: number;
  endLine: number;
  sha256: string;
}

export interface EvidenceManifest {
  schema: typeof EVIDENCE_SCHEMA;
  repository: { remote: string; root: string };
  revision: {
    sha: string;
    dirty: boolean;
    dirtyScope?: string;
    branch?: string;
    baseSha?: string;
  };
  changedPaths: string[];
  uncommittedPaths: string[];
  command: string;
  environment: Record<string, string>;
  capturedAt: string;
  tests: ManifestTest[];
  symbols: ManifestSymbol[];
  notes: { text: string; source: 'agent-reported' }[];
}

/** One imported manifest. Immutable once stored. */
export interface EngineeringEvidenceRun {
  id: string;
  projectId: string;
  /** SHA-256 of the imported file text; duplicates are refused. */
  digest: string;
  fileName: string;
  manifest: EvidenceManifest;
  /** Unpinned runs (dirty tree) are shown but never count as verification. */
  pinned: boolean;
  /**
   * 'observation' = a plain look at a revision (e.g. the baseline before any
   * change). 'implementation' = imported against an approved proposal; its
   * baseSha must equal the proposal's.
   */
  role: 'observation' | 'implementation';
  /** Set for 'implementation' runs. */
  proposalId?: string;
  importedAt: Date;
}

// ---------------------------------------------------------------------------
// Proposals

export type ProposalState = 'draft' | 'approved' | 'accepted' | 'withdrawn';

export interface ContractChangeProposal {
  id: string;
  projectId: string;
  statementId: string;
  contractKey: string;
  from: ContractValues;
  to: ContractValues;
  rationale: string;
  state: ProposalState;
  /** Revision the implementer must start from; required to approve. */
  baseSha?: string;
  /** Frozen at approval so the handoff stays reproducible if the model later changes. */
  approvedImpact?: ChangeImpact;
  approvedAt?: Date;
  /** Statement id of the contract version created on acceptance. */
  acceptedStatementId?: string;
  acceptedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface EngineeringProjectRecord {
  id: string;
  name: string;
  description: string;
  repository: { remote: string; root: string };
  /** Shipped synthetic fixture version, so a reset reseeds deterministically. */
  fixtureVersion: string;
  createdAt: Date;
}

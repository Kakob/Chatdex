import type { EvidenceRef } from './understanding';

export type PreparedChangeState = 'draft' | 'ready' | 'superseded';

export interface PreparedChangeEvidenceRef extends EvidenceRef {
  understandingPointId: string;
}

export interface PreparedChangeRepositoryRef {
  remoteUrl?: string;
  baseCommit?: string;
  implicatedPaths?: string[];
}

/** Human-authored implementation intent compiled from accepted understanding. */
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
  createdAt: Date;
  updatedAt: Date;
  readyAt?: Date;
}

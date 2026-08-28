// Intent Trace entities (docs/SPEC-intent-trace.md §11).
//
// Intents themselves are UnderstandingObjects of type 'intent' (spec D1) —
// their polarity / origin / statedAt live in UnderstandingObject.meta. This
// file holds the trace: one append-only judgement of one intent against one
// repository commit. A new commit produces a new row; old rows are kept
// (DetectorRun / VerdictRevision precedent). Stored plaintext in IndexedDB,
// ciphertext in sync (kind 'intent_trace').

/** What the user asked for, as stated. */
export type IntentPolarity = 'want' | 'dont_want' | 'constraint' | 'preference';

/**
 * Spec §2.2 origin law: 'unprompted' when the user raised the intent
 * themselves (an opening message, or a new want mid-conversation);
 * 'response_to_ai' when it answers or reacts to something the assistant asked
 * or proposed. Forced to 'unprompted' mechanically when no assistant text
 * precedes the message — the model may not override that.
 */
export type IntentOrigin = 'unprompted' | 'response_to_ai';

/** Spec leg outcome. 'no_spec' is model-free: no spec-like docs in the tree. */
export type SpecStatus = 'no_spec' | 'specified' | 'contradicted' | 'unspecified';

/** Implementation leg outcome. Any status without verified evidence downgrades to 'unknown'. */
export type ImplStatus = 'implemented' | 'partial' | 'not_implemented' | 'diverged' | 'unknown';

/** Traces bind to an immutable commit, never a branch. */
export interface RepoRef {
  owner: string;
  repo: string;
  commitSha: string;
  /** The ref that resolved to commitSha at trace time (branch/tag), if any. */
  ref?: string;
}

/** A verbatim excerpt of a spec document at repoRef.commitSha. */
export interface SpecEvidence {
  path: string;
  startLine?: number;
  endLine?: number;
  quote: string;
}

/**
 * A verbatim excerpt of a source file at repoRef.commitSha. Lines are
 * recomputed from the quote's position in the fetched text (spec §9.4) —
 * the model's own line numbers are never stored.
 */
export interface CodeEvidence {
  path: string;
  startLine: number;
  endLine: number;
  quote: string;
}

/** A commit touching an evidence path after the intent was stated (deterministic, no LLM). */
export interface CommitEvidence {
  sha: string;
  path: string;
  message: string;
  authoredAt: Date;
  url: string;
}

/** One append-only judgement of one intent against one repository commit. */
export interface IntentTrace {
  id: string;
  projectId: string;
  /** The UnderstandingObject (type 'intent') this trace judges. */
  intentObjectId: string;
  repoRef: RepoRef;
  specStatus: SpecStatus;
  specEvidence: SpecEvidence[];
  specRationale?: string;
  implStatus: ImplStatus;
  implEvidence: CodeEvidence[];
  implRationale?: string;
  /** Model's "look here next" hints, intersected with the tree; never fetched by this trace. */
  suggestedPaths?: string[];
  commitEvidence?: CommitEvidence[];
  /** Exactly which files/docs were sent to the provider (audit; shown as "checked"). */
  fetchedPaths: string[];
  provider: 'anthropic' | 'openai';
  model: string;
  warnings: string[];
  createdAt: Date;
}

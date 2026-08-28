// Trace run orchestration (SPEC-intent-trace §9.5). `planTrace` resolves the
// commit, tree, spec docs, and candidate files per intent BEFORE any LLM call
// (it feeds the disclosure); `runTrace` fetches through the gate, judges,
// verifies, and persists one append-only trace per intent. Each intent is
// independent: a failure records an `unknown` trace with the error and the
// run continues; only a GitHub rate limit aborts.

import { complete } from '../../providers';
import type { LLMProviderId } from '../../providers';
import { getUnderstandingProject, getObjectsForProject, getEventsForObject } from '../../db/understanding';
import { getMessagesForConversation } from '../../db/messages';
import { db } from '../../db/schema';
import { listInvestigationAnchors } from '../../db/investigationAnchors';
import { putIntentTrace, getLatestTraceByIntent } from '../../db/intentTraces';
import { getGitHubToken } from '../../github/credentials';
import {
  getRepo,
  resolveRef,
  getTree,
  getFileContent,
  listCommits,
  getLastRateLimit,
  GitHubRateLimitError,
  type GitHubClientOptions,
  type RateLimitInfo,
} from '../../github/client';
import { generateId } from '../../utils/ids';
import { findSpecPaths, retrieveSpecExcerpts, tokenize, DEFAULT_SPEC_PATTERNS } from './specDocs';
import {
  selectCandidateFiles,
  excerptFile,
  toRepoRelative,
  type CandidateFile,
  DEFAULT_MAX_FILES,
  DEFAULT_MAX_CHARS_PER_FILE,
} from './candidateFiles';
import { isFetchAllowed, scrubSecrets, assertNoSecrets } from './fetchPolicy';
import { buildTraceMessages, parseTraceResponse, DEFAULT_TREE_SAMPLE } from './judge';
import type { StoredConversation, StoredMessage } from '../../../types';
import type { UnderstandingObject } from '../../../types/understanding';
import type { IntentTrace, RepoRef, CommitEvidence } from '../../../types/intentTrace';

export interface TraceConfig {
  provider: LLMProviderId;
  model?: string;
  /** Branch, tag, or sha; defaults to the project's pinnedRef, then default branch. */
  ref?: string;
  maxFiles?: number;
  maxCharsPerFile?: number;
  maxSpecChars?: number;
  specPatterns?: readonly string[];
  /** Trace only these intents (else: every non-rejected intent lacking a trace at this sha). */
  intentObjectIds?: string[];
  /** Extra paths per intent (a previous trace's suggestions, or user-typed). */
  extraPaths?: Record<string, Array<{ path: string; reason: 'suggested' | 'manual' }>>;
  includeCommits?: boolean;
  maxIntentsPerRun?: number;
  maxTreeEntries?: number;
  maxSpecDocs?: number;
  /** Defaults to the stored device-local token. */
  token?: string;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
}

export const DEFAULT_MAX_INTENTS_PER_RUN = 50;
export const DEFAULT_MAX_TREE_ENTRIES = 50_000;
export const DEFAULT_MAX_SPEC_DOCS = 20;
export const DEFAULT_MAX_COMMIT_PATHS = 3;
/** Cited evidence messages ± this many neighbours feed candidate-path extraction. */
export const EVIDENCE_CONTEXT_MESSAGES = 3;

export interface TracePlanIntent {
  intent: UnderstandingObject;
  candidates: CandidateFile[];
  skipped: Array<{ path: string; reason: 'sensitive' | 'excluded' }>;
  conversationIds: string[];
  statedAt?: Date;
}

export interface TracePlan {
  projectId: string;
  repoRef: RepoRef;
  treeTruncated: boolean;
  treeEntryCount: number;
  keywordDisabled: boolean;
  specPaths: string[];
  intents: TracePlanIntent[];
  /** Unique candidate paths across intents (what the disclosure counts). */
  filePaths: string[];
  /** Union of evidence conversations (for cross-provider disclosure). */
  conversationIds: string[];
  warnings: string[];
}

function clientOptions(config: TraceConfig, token: string | undefined): GitHubClientOptions {
  return { token, fetchImpl: config.fetchImpl };
}

function isIntent(o: UnderstandingObject): boolean {
  return o.type === 'intent' && o.reviewState !== 'rejected';
}

async function evidenceContext(
  intent: UnderstandingObject
): Promise<{ conversationIds: string[]; texts: string[]; roots: string[] }> {
  const events = await getEventsForObject(intent.id);
  const byConv = new Map<string, Set<string>>();
  for (const e of events) {
    if (e.reviewState === 'rejected') continue;
    for (const ref of e.evidence) {
      const set = byConv.get(ref.conversationId) ?? new Set<string>();
      for (const id of ref.messageIds ?? []) set.add(id);
      byConv.set(ref.conversationId, set);
    }
  }
  const texts: string[] = [];
  const roots: string[] = [];
  for (const [conversationId, messageIds] of byConv) {
    const conv = (await db.conversations.get(conversationId)) as StoredConversation | undefined;
    for (const root of [conv?.projectPath, conv?.workingDirectory]) if (root) roots.push(root);
    const messages: StoredMessage[] = await getMessagesForConversation(conversationId);
    if (messageIds.size === 0) {
      texts.push(...messages.slice(-EVIDENCE_CONTEXT_MESSAGES * 2).map((m) => m.text));
      continue;
    }
    const indexes = messages.map((m, i) => (messageIds.has(m.id) ? i : -1)).filter((i) => i >= 0);
    const wanted = new Set<number>();
    for (const i of indexes) {
      for (let j = i - EVIDENCE_CONTEXT_MESSAGES; j <= i + EVIDENCE_CONTEXT_MESSAGES; j++) {
        if (j >= 0 && j < messages.length) wanted.add(j);
      }
    }
    for (const j of [...wanted].sort((a, b) => a - b)) texts.push(messages[j].text);
  }
  return { conversationIds: [...byConv.keys()], texts, roots: [...new Set(roots)] };
}

export async function planTrace(projectId: string, config: TraceConfig): Promise<TracePlan> {
  const project = await getUnderstandingProject(projectId);
  if (!project) throw new Error(`Cannot trace: project ${projectId} not found`);
  const repository = project.repository;
  if (!repository) throw new Error('Bind a GitHub repository to this project before tracing');
  const token = config.token ?? (await getGitHubToken());
  const gh = clientOptions(config, token);
  const warnings: string[] = [];

  let ref = config.ref ?? repository.pinnedRef ?? repository.defaultBranch;
  if (!ref) ref = (await getRepo(repository.owner, repository.repo, gh)).defaultBranch;
  const { sha } = await resolveRef(repository.owner, repository.repo, ref, gh);
  const repoRef: RepoRef = { owner: repository.owner, repo: repository.repo, commitSha: sha, ref };

  const tree = await getTree(repository.owner, repository.repo, sha, gh);
  if (tree.truncated) warnings.push('Repository tree was truncated by GitHub; some files are invisible to keyword matching');
  const maxTreeEntries = config.maxTreeEntries ?? DEFAULT_MAX_TREE_ENTRIES;
  const keywordDisabled = tree.entries.length > maxTreeEntries;
  if (keywordDisabled) warnings.push(`Tree has ${tree.entries.length} entries (> ${maxTreeEntries}); keyword matching disabled`);
  const treePaths = tree.entries.filter((e) => e.type === 'blob').map((e) => e.path);

  const specPaths = findSpecPaths(treePaths, config.specPatterns ?? DEFAULT_SPEC_PATTERNS)
    .filter((p) => isFetchAllowed(p).allowed)
    .slice(0, config.maxSpecDocs ?? DEFAULT_MAX_SPEC_DOCS);

  let intents = (await getObjectsForProject(projectId)).filter(isIntent);
  if (config.intentObjectIds) {
    const wanted = new Set(config.intentObjectIds);
    intents = intents.filter((o) => wanted.has(o.id));
  } else {
    const latest = await getLatestTraceByIntent(projectId);
    intents = intents.filter((o) => latest.get(o.id)?.repoRef.commitSha !== sha);
  }
  intents.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const maxIntents = config.maxIntentsPerRun ?? DEFAULT_MAX_INTENTS_PER_RUN;
  if (intents.length > maxIntents) {
    warnings.push(`${intents.length} intents to trace; capped at ${maxIntents} for this run`);
    intents = intents.slice(0, maxIntents);
  }

  const planned: TracePlanIntent[] = [];
  const allFiles = new Set<string>();
  const allConvs = new Set<string>();
  for (const intent of intents) {
    const ctx = await evidenceContext(intent);
    const anchors = ctx.conversationIds.length
      ? await listInvestigationAnchors({ conversationIds: ctx.conversationIds })
      : [];
    const anchorPaths = [...new Set(anchors.flatMap((a) => a.filePaths))]
      .map((p) => toRepoRelative(p, ctx.roots))
      .filter((p): p is string => p !== null);
    const selection = selectCandidateFiles(
      { title: intent.title, statement: intent.body ?? intent.title },
      {
        conversationTexts: ctx.texts,
        anchorPaths,
        treePaths,
        extraPaths: config.extraPaths?.[intent.id],
        maxFiles: config.maxFiles ?? DEFAULT_MAX_FILES,
        keywordDisabled,
      }
    );
    for (const c of selection.candidates) allFiles.add(c.path);
    for (const id of ctx.conversationIds) allConvs.add(id);
    const statedAtRaw = intent.meta?.statedAt;
    planned.push({
      intent,
      candidates: selection.candidates,
      skipped: selection.skipped,
      conversationIds: ctx.conversationIds,
      ...(typeof statedAtRaw === 'string' ? { statedAt: new Date(statedAtRaw) } : {}),
    });
  }

  return {
    projectId,
    repoRef,
    treeTruncated: tree.truncated,
    treeEntryCount: tree.entries.length,
    keywordDisabled,
    specPaths,
    intents: planned,
    filePaths: [...allFiles].sort(),
    conversationIds: [...allConvs],
    warnings,
  };
}

export interface TraceRunOptions {
  onProgress?: (done: number, total: number) => void;
}

export interface TraceRunOutcome {
  traced: number;
  /** Intents whose trace recorded an error (still persisted as unknown). */
  errored: number;
  aborted: boolean;
  warnings: string[];
  rateLimit: RateLimitInfo;
}

export async function runTrace(
  projectId: string,
  plan: TracePlan,
  config: TraceConfig,
  options: TraceRunOptions = {}
): Promise<TraceRunOutcome> {
  const token = config.token ?? (await getGitHubToken());
  const gh = clientOptions(config, token);
  const { owner, repo, commitSha } = plan.repoRef;
  const outcome: TraceRunOutcome = { traced: 0, errored: 0, aborted: false, warnings: [...plan.warnings], rateLimit: {} };
  const treePathSet = new Set<string>();
  // The plan already filtered to blobs; rebuild the set from candidates + spec paths + a tree fetch (cached).
  const tree = await getTree(owner, repo, commitSha, gh);
  for (const e of tree.entries) if (e.type === 'blob') treePathSet.add(e.path);
  const treeSample = [...treePathSet].filter((p) => isFetchAllowed(p).allowed).slice(0, DEFAULT_TREE_SAMPLE);

  // Spec docs are fetched once per run.
  const specFetched = new Map<string, string>();
  for (const path of plan.specPaths) {
    try {
      const file = await getFileContent(owner, repo, path, commitSha, gh);
      specFetched.set(path, scrubSecrets(file.text).text);
    } catch (err) {
      if (err instanceof GitHubRateLimitError) throw err;
      outcome.warnings.push(`Could not fetch spec doc ${path}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const hasSpec = specFetched.size > 0;

  options.onProgress?.(0, plan.intents.length);
  for (const planned of plan.intents) {
    const { intent } = planned;
    const warnings: string[] = planned.skipped.map((s) => `Skipped ${s.path} (${s.reason})`);
    const fetched = new Map<string, string>();
    const fetchedPaths: string[] = [];
    const trace: IntentTrace = {
      id: generateId(),
      projectId,
      intentObjectId: intent.id,
      repoRef: plan.repoRef,
      specStatus: hasSpec ? 'unspecified' : 'no_spec',
      specEvidence: [],
      implStatus: 'unknown',
      implEvidence: [],
      fetchedPaths,
      provider: config.provider,
      model: config.model ?? 'unknown',
      warnings,
      createdAt: new Date(),
    };

    try {
      const statement = intent.body ?? intent.title;
      const keywords = tokenize(`${intent.title} ${statement}`);
      const codeExcerpts: Array<{ path: string; excerpt: string }> = [];
      for (const candidate of planned.candidates) {
        // The gate, again, at the moment of fetching (extra/suggested/manual paths included).
        const decision = isFetchAllowed(candidate.path);
        if (!decision.allowed) {
          warnings.push(`Skipped ${candidate.path} (${decision.reason})`);
          continue;
        }
        try {
          const file = await getFileContent(owner, repo, candidate.path, commitSha, gh);
          const scrubbed = scrubSecrets(file.text);
          if (scrubbed.redactions > 0) warnings.push(`Redacted ${scrubbed.redactions} secret-shaped string(s) in ${candidate.path}`);
          fetched.set(candidate.path, scrubbed.text);
          fetchedPaths.push(candidate.path);
          codeExcerpts.push({
            path: candidate.path,
            excerpt: excerptFile(scrubbed.text, keywords, { maxChars: config.maxCharsPerFile ?? DEFAULT_MAX_CHARS_PER_FILE }).excerpt,
          });
        } catch (err) {
          if (err instanceof GitHubRateLimitError) throw err;
          warnings.push(`Could not fetch ${candidate.path}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      const specExcerpts = hasSpec
        ? retrieveSpecExcerpts(
            { title: intent.title, statement },
            [...specFetched].map(([path, text]) => ({ path, text })),
            { maxChars: config.maxSpecChars }
          ).map((s) => ({ path: s.path, text: s.text }))
        : [];
      for (const s of specExcerpts) if (!fetchedPaths.includes(s.path)) fetchedPaths.push(s.path);

      const messages = buildTraceMessages({
        intent: {
          title: intent.title,
          statement,
          polarity: String(intent.meta?.polarity ?? 'preference'),
          origin: String(intent.meta?.origin ?? 'unprompted'),
        },
        specExcerpts,
        codeExcerpts,
        treeSample,
      });
      assertNoSecrets(messages, [token]);

      const response = await complete(config.provider, { model: config.model, messages });
      trace.model = response.model;
      const parsed = parseTraceResponse(response.text, fetched, specFetched, treePathSet, specExcerpts.length > 0);
      trace.specStatus = hasSpec ? parsed.specStatus : 'no_spec';
      trace.specEvidence = parsed.specEvidence;
      trace.specRationale = parsed.specRationale;
      trace.implStatus = parsed.implStatus;
      trace.implEvidence = parsed.implEvidence;
      trace.implRationale = parsed.implRationale;
      trace.suggestedPaths = parsed.suggestedPaths;
      warnings.push(...parsed.warnings);

      if (config.includeCommits !== false && planned.statedAt && parsed.implEvidence.length > 0) {
        const commitEvidence: CommitEvidence[] = [];
        const paths = [...new Set(parsed.implEvidence.map((e) => e.path))].slice(0, DEFAULT_MAX_COMMIT_PATHS);
        for (const path of paths) {
          try {
            const commits = await listCommits(owner, repo, { path, since: planned.statedAt, sha: commitSha }, gh);
            for (const c of commits) {
              commitEvidence.push({ sha: c.sha, path, message: c.message.split('\n')[0], authoredAt: c.authoredAt, url: c.htmlUrl });
            }
          } catch (err) {
            if (err instanceof GitHubRateLimitError) throw err;
            warnings.push(`Could not list commits for ${path}`);
          }
        }
        if (commitEvidence.length > 0) trace.commitEvidence = commitEvidence;
      }
      outcome.traced++;
    } catch (err) {
      if (err instanceof GitHubRateLimitError) {
        outcome.aborted = true;
        outcome.warnings.push(
          `GitHub rate limit reached${err.resetAt ? ` (resets ${err.resetAt.toISOString()})` : ''}; stopped before ${intent.title}`
        );
        break;
      }
      warnings.push(`Trace failed: ${err instanceof Error ? err.message : String(err)}`);
      trace.implStatus = 'unknown';
      trace.implEvidence = [];
      outcome.errored++;
      await putIntentTrace(trace);
      options.onProgress?.(outcome.traced + outcome.errored, plan.intents.length);
      continue;
    }

    await putIntentTrace(trace);
    options.onProgress?.(outcome.traced + outcome.errored, plan.intents.length);
  }

  outcome.rateLimit = getLastRateLimit();
  return outcome;
}

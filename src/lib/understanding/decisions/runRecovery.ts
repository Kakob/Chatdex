// Recovery run orchestration (SPEC-decision-recovery §9.2, §9.5).
//
// `planRecovery` assembles everything BEFORE any provider call — which
// conversations, how many steps and hunks, which repository excerpts — so the
// disclosure (law 2.6) describes exactly what will leave the client.
// `runRecovery` makes one `complete()` call per conversation (step indexes
// are per conversation), pushes the answer through the firewall, and persists
// pending decision objects plus one DecisionTrace per decision (law 2.3).
// Conversations are independent: a failure is recorded and the run continues.

import { complete } from '../../providers';
import type { LLMProviderId } from '../../providers';
import { db } from '../../db/schema';
import {
  getUnderstandingProject,
  putUnderstandingProject,
  getObjectsForProject,
  createUnderstandingObject,
  recordUnderstandingEvent,
} from '../../db/understanding';
import { getMessagesForConversation } from '../../db/messages';
import { listInvestigationAnchors } from '../../db/investigationAnchors';
import { listAgentInspections } from '../../db/agentInspections';
import { putDecisionTrace, getLatestTraceByDecision } from '../../db/decisionTraces';
import { latestCachedSnapshot, listRepoFiles, countRepoFiles } from '../../db/repoFiles';
import { getGitHubToken } from '../../github/credentials';
import { resolveRef } from '../../github/client';
import { getRememberedLocalDirectoryName } from '../../repo/localDir';
import { localRepoKey } from '../../repo/localDirSource';
import { githubRepoKey, parseRepoKey } from '../../repo/sources';
import { normalizeSession, type Step } from '../../detection/normalize';
import { generateId } from '../../utils/ids';
import { getAssociatedConversations } from '../reconcile';
import { toRepoRelative, excerptFile, DEFAULT_MAX_CHARS_PER_FILE } from '../trace/candidateFiles';
import { tokenize } from '../trace/specDocs';
import { scrubSecrets, assertNoSecrets } from '../trace/fetchPolicy';
import {
  buildTranscriptExcerpts,
  selectRecoveryFiles,
  dependencyNames,
  type StepExcerpt,
  type RecoveryCandidateFile,
  type TranscriptExcerptOptions,
} from './candidates';
import { buildRecoveryMessages, type ExistingDecisionSummary } from './prompt';
import { parseRecoveryResponse, type FirewallContext, type VerifiedDecision } from './firewall';
import { extractDeclaredSymbols, matchTestPaths } from './symbols';
import { isDecision, readDecisionMeta, toMetaRecord, type DecisionMeta } from './meta';
import type { StoredConversation, StoredMessage } from '../../../types';
import type { EvidenceRef, UnderstandingObject } from '../../../types/understanding';
import type { DecisionTrace, DecisionInvalidation } from '../../../types/decision';
import type { InvestigationAnchor } from '../../../types/investigation';

export interface RecoveryConfig {
  provider: LLMProviderId;
  model?: string;
  /** Restrict the run to these conversations; scoped runs never advance the cursor. */
  conversationIds?: string[];
  /** Process every associated Claude Code conversation regardless of the cursor. */
  ignoreCursor?: boolean;
  /** Override the snapshot (defaults: the project's GitHub binding, else the remembered local directory). */
  repoKey?: string;
  sha?: string;
  maxFiles?: number;
  maxCharsPerFile?: number;
  excerpts?: TranscriptExcerptOptions;
  maxDecisionsPerCall?: number;
  /** Defaults to the stored device-local GitHub token (asserted absent from prompts). */
  token?: string;
  /** Injectable for tests; used only to resolve the bound ref to a sha. */
  fetchImpl?: typeof fetch;
}

export interface RecoveryPlanConversation {
  conversationId: string;
  name: string;
  source: string;
  stepCount: number;
  anchorCount: number;
  inspectionCount: number;
  excerptChars: number;
  droppedAnchors: number;
  /** Prepared inputs, kept on the plan so the run sends exactly what was disclosed. */
  excerpts: StepExcerpt[];
  anchorsByStep: Map<number, { stableKey: string; paths: string[] }>;
  candidates: RecoveryCandidateFile[];
  inspectedPaths: string[];
  warnings: string[];
}

export interface RecoveryPlan {
  projectId: string;
  runId: string;
  repoKey?: string;
  sha?: string;
  /** The ref the snapshot sha came from, when the binding named one. */
  ref?: string;
  conversations: RecoveryPlanConversation[];
  /** Unique repository paths across conversations (what the disclosure counts). */
  filePaths: string[];
  preExistingPaths: string[];
  hunkCount: number;
  skipped: Array<{ path: string; reason: 'sensitive' | 'excluded' }>;
  existingDecisions: ExistingDecisionSummary[];
  conversationIds: string[];
  /** The scoped/cursor policy this plan was built with; the run honours it. */
  advancesCursor: boolean;
  warnings: string[];
}

function isAgentSession(c: StoredConversation): boolean {
  return c.source === 'claude-code';
}

// Which snapshot a recovery run reads. The bound ref decides it: falling back
// to whatever was indexed last is branch-blind, and the snapshot is what the
// `inherited` basis label is computed against (SPEC-decision-recovery §2.2),
// so recovering against another branch's code silently changes labels.
async function resolveSnapshot(
  project: { repository?: { owner: string; repo: string; pinnedRef?: string; defaultBranch?: string } },
  config: RecoveryConfig
): Promise<{ repoKey?: string; sha?: string; ref?: string; warning?: string }> {
  let repoKey = config.repoKey;
  if (!repoKey) {
    if (project.repository) repoKey = githubRepoKey(project.repository.owner, project.repository.repo);
    else {
      const local = await getRememberedLocalDirectoryName();
      if (local) repoKey = localRepoKey(local);
    }
  }
  if (!repoKey) return { warning: 'No repository bound; decisions will carry transcript evidence and hunks only' };
  if (config.sha) return { repoKey, sha: config.sha };

  const parsed = parseRepoKey(repoKey);
  if (parsed?.kind === 'gh') {
    const ref = project.repository?.pinnedRef ?? project.repository?.defaultBranch ?? 'HEAD';
    try {
      const { sha } = await resolveRef(parsed.owner, parsed.repo, ref, {
        token: config.token ?? (await getGitHubToken()),
        ...(config.fetchImpl ? { fetchImpl: config.fetchImpl } : {}),
      });
      // Never substitute another branch's cache for the one that was asked for.
      if ((await countRepoFiles(repoKey, sha)) === 0) {
        return {
          repoKey,
          sha,
          ref,
          warning: `${ref} resolves to ${sha.slice(0, 7)} but no snapshot is indexed; index it in Prepare → Evidence to add code links`,
        };
      }
      return { repoKey, sha, ref };
    } catch {
      const cached = (await latestCachedSnapshot(repoKey)) ?? undefined;
      if (!cached) return { repoKey, ref, warning: `No cached snapshot for ${repoKey}; index the repository to add code links` };
      return {
        repoKey,
        sha: cached,
        warning: `Could not resolve ${ref}; using the most recently indexed snapshot ${cached.slice(0, 7)}, which may be from a different branch`,
      };
    }
  }

  // Local directories have no branch to resolve.
  const sha = (await latestCachedSnapshot(repoKey)) ?? undefined;
  if (!sha) return { repoKey, warning: `No cached snapshot for ${repoKey}; index the repository to add code links` };
  return { repoKey, sha };
}

export function summarizeExistingDecisions(objects: UnderstandingObject[]): ExistingDecisionSummary[] {
  return objects
    .filter((o) => isDecision(o) && o.reviewState !== 'rejected')
    .map((o) => ({ id: o.id, title: o.title, basis: readDecisionMeta(o).basis }));
}

export async function planRecovery(projectId: string, config: RecoveryConfig): Promise<RecoveryPlan> {
  const project = await getUnderstandingProject(projectId);
  if (!project) throw new Error(`Cannot recover decisions: project ${projectId} not found`);
  const warnings: string[] = [];

  const snapshot = await resolveSnapshot(project, config);
  if (snapshot.warning) warnings.push(snapshot.warning);
  const treePaths =
    snapshot.repoKey && snapshot.sha
      ? (await listRepoFiles(snapshot.repoKey, snapshot.sha)).map((r) => r.path)
      : [];

  let conversations = (await getAssociatedConversations(projectId, config.conversationIds)).filter(isAgentSession);
  const scoped = Boolean(config.conversationIds);
  if (!scoped && !config.ignoreCursor && project.lastDecisionRecoveredAt) {
    const cursor = project.lastDecisionRecoveredAt.getTime();
    conversations = conversations.filter((c) => c.updatedAt.getTime() > cursor);
  }
  conversations.sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime());

  const existingDecisions = summarizeExistingDecisions(await getObjectsForProject(projectId));
  const planned: RecoveryPlanConversation[] = [];
  const allFiles = new Set<string>();
  const preExisting = new Set<string>();
  const skipped: RecoveryPlan['skipped'] = [];
  let hunkCount = 0;

  for (const conv of conversations) {
    const messages = await getMessagesForConversation(conv.id);
    const { steps } = normalizeSession(conv.id, messages);
    const anchors = await listInvestigationAnchors({ conversationId: conv.id });
    const inspections = await listAgentInspections(conv.id);
    const roots = [conv.projectPath, conv.workingDirectory].filter((r): r is string => Boolean(r));

    const relative = (p: string) => toRepoRelative(p, roots);
    // Hunk paths are stored as the agent wrote them (often absolute); the
    // model, the trace, and blast radius all speak repo-relative.
    const relativeOrRaw = (p: string) => relative(p) ?? p;
    const excerptSet = buildTranscriptExcerpts(conv.id, steps, anchors, config.excerpts);
    const anchorsByStep = new Map<number, { stableKey: string; paths: string[] }>();
    for (const e of excerptSet.excerpts) {
      if (!e.anchorStableKey) continue;
      e.hunkPaths = (e.hunkPaths ?? []).map(relativeOrRaw);
      anchorsByStep.set(e.stepIndex, { stableKey: e.anchorStableKey, paths: e.hunkPaths });
    }
    hunkCount += anchorsByStep.size;
    const anchorPaths = [...new Set(anchors.flatMap((a) => a.filePaths))].map(relative).filter((p): p is string => p !== null);
    const createdPaths = new Set(
      anchors.filter((a) => a.kind === 'write').flatMap((a) => a.filePaths).map(relative).filter((p): p is string => p !== null)
    );
    const inspectedPaths = [...new Set(inspections.map((i) => i.path).filter((p): p is string => Boolean(p)))];
    const selection = treePaths.length
      ? selectRecoveryFiles({
          anchorPaths,
          inspectedPaths,
          mentionedTexts: excerptSet.excerpts.filter((e) => e.role === 'user_msg').map((e) => e.text),
          treePaths,
          createdPaths,
          maxFiles: config.maxFiles,
        })
      : { candidates: [], skipped: [] };
    for (const c of selection.candidates) {
      allFiles.add(c.path);
      if (c.preExisting) preExisting.add(c.path);
    }
    skipped.push(...selection.skipped);

    planned.push({
      conversationId: conv.id,
      name: conv.name,
      source: conv.source,
      stepCount: steps.length,
      anchorCount: anchors.length,
      inspectionCount: inspections.length,
      excerptChars: excerptSet.totalChars,
      droppedAnchors: excerptSet.droppedAnchors,
      excerpts: excerptSet.excerpts,
      anchorsByStep,
      candidates: selection.candidates,
      inspectedPaths,
      warnings: excerptSet.warnings,
    });
  }

  return {
    projectId,
    runId: generateId(),
    repoKey: snapshot.repoKey,
    sha: snapshot.sha,
    ...(snapshot.ref ? { ref: snapshot.ref } : {}),
    conversations: planned,
    filePaths: [...allFiles].sort(),
    preExistingPaths: [...preExisting].sort(),
    hunkCount,
    skipped,
    existingDecisions,
    conversationIds: planned.map((p) => p.conversationId),
    advancesCursor: !scoped,
    warnings,
  };
}

export interface RecoveryRunOptions {
  onProgress?: (done: number, total: number) => void;
}

export interface RecoveryRunOutcome {
  runId: string;
  conversationsProcessed: number;
  decisionsCreated: number;
  decisionsSupported: number;
  tracesWritten: number;
  errored: number;
  warnings: string[];
}

function evidenceRefsFor(decision: VerifiedDecision): EvidenceRef[] {
  const byConv = new Map<string, Set<string>>();
  const spans = [
    ...decision.transcriptEvidence,
    ...decision.assumptions.flatMap((a) => a.transcriptEvidence),
    ...decision.alternatives.flatMap((a) => a.transcriptEvidence),
  ];
  for (const s of spans) {
    const set = byConv.get(s.conversationId) ?? new Set<string>();
    set.add(s.messageId);
    byConv.set(s.conversationId, set);
  }
  return [...byConv].map(([conversationId, ids]) => ({
    conversationId,
    messageIds: [...ids],
    note: decision.statement,
  }));
}

/** Resolve `statement:` placeholders from the firewall against the target's latest trace assumptions. */
async function resolveInvalidations(
  projectId: string,
  invalidates: DecisionInvalidation[]
): Promise<DecisionInvalidation[]> {
  if (invalidates.length === 0) return [];
  const latest = await getLatestTraceByDecision(projectId);
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
  return invalidates.map((inv) => {
    if (!inv.assumptionId?.startsWith('statement:')) return inv;
    const wanted = norm(inv.assumptionId.slice('statement:'.length));
    const match = latest.get(inv.decisionObjectId)?.assumptions.find((a) => norm(a.statement) === wanted);
    return { ...inv, assumptionId: match?.id };
  });
}

export async function runRecovery(
  projectId: string,
  plan: RecoveryPlan,
  config: RecoveryConfig,
  options: RecoveryRunOptions = {}
): Promise<RecoveryRunOutcome> {
  const project = await getUnderstandingProject(projectId);
  if (!project) throw new Error(`Cannot recover decisions: project ${projectId} not found`);
  const token = config.token ?? (await getGitHubToken());
  const outcome: RecoveryRunOutcome = {
    runId: plan.runId,
    conversationsProcessed: 0,
    decisionsCreated: 0,
    decisionsSupported: 0,
    tracesWritten: 0,
    errored: 0,
    warnings: [...plan.warnings],
  };

  // Repository excerpts: read once from the LOCAL-ONLY cache, scrubbed.
  const fetched = new Map<string, string>();
  const rowsByPath = new Map<string, string>();
  let treePaths: string[] = [];
  if (plan.repoKey && plan.sha) {
    const rows = await listRepoFiles(plan.repoKey, plan.sha);
    treePaths = rows.map((r) => r.path);
    for (const r of rows) rowsByPath.set(r.path, r.content);
  }
  const dependencies = dependencyNames(rowsByPath.get('package.json'));
  const preExistingPaths = new Set(plan.preExistingPaths);

  options.onProgress?.(0, plan.conversations.length);
  let latestUpdatedAt: Date | undefined;
  for (const planned of plan.conversations) {
    const warnings: string[] = [...planned.warnings];
    try {
      const conv = (await db.conversations.get(planned.conversationId)) as StoredConversation | undefined;
      const messages: StoredMessage[] = await getMessagesForConversation(planned.conversationId);
      const messageById = new Map(messages.map((m) => [m.id, m]));

      const codeExcerpts: Array<{ path: string; excerpt: string; preExisting: boolean }> = [];
      const keywords = tokenize(planned.excerpts.filter((e) => e.role === 'user_msg').map((e) => e.text).join(' '));
      for (const candidate of planned.candidates) {
        const content = rowsByPath.get(candidate.path);
        if (content === undefined) {
          warnings.push(`${candidate.path} left the cache before the run; skipped`);
          continue;
        }
        const scrubbed = scrubSecrets(content);
        if (scrubbed.redactions > 0) warnings.push(`Redacted ${scrubbed.redactions} secret-shaped string(s) in ${candidate.path}`);
        fetched.set(candidate.path, scrubbed.text);
        codeExcerpts.push({
          path: candidate.path,
          excerpt: excerptFile(scrubbed.text, keywords, { maxChars: config.maxCharsPerFile ?? DEFAULT_MAX_CHARS_PER_FILE }).excerpt,
          preExisting: candidate.preExisting,
        });
      }

      // Existing decisions reloaded per conversation so earlier creations can be re-recognized.
      const existingObjects = (await getObjectsForProject(projectId)).filter(isDecision);
      const existing = summarizeExistingDecisions(existingObjects);
      const existingById = new Map(existingObjects.map((o) => [o.id, o]));

      const messagesForModel = buildRecoveryMessages({
        project: { name: project.name, description: project.description },
        conversation: { id: planned.conversationId, name: planned.name, source: planned.source },
        excerpts: planned.excerpts,
        codeExcerpts,
        existingDecisions: existing,
        maxDecisions: config.maxDecisionsPerCall,
      });
      assertNoSecrets(messagesForModel, [token]);

      const response = await complete(config.provider, { model: config.model, messages: messagesForModel });

      const ctx: FirewallContext = {
        conversationId: planned.conversationId,
        steps: new Map(planned.excerpts.map((e) => [e.stepIndex, { messageId: e.messageId, role: e.role, text: e.text }])),
        anchorsByStep: planned.anchorsByStep,
        fetched,
        preExistingPaths,
        inspectedPaths: new Set(planned.inspectedPaths),
        dependencies,
        existingDecisionIds: new Set(existing.map((e) => e.id)),
        maxDecisions: config.maxDecisionsPerCall,
      };
      const parsed = parseRecoveryResponse(response.text, ctx);
      warnings.push(...parsed.warnings);
      const invalidates = await resolveInvalidations(projectId, parsed.invalidates);

      for (const decision of parsed.decisions) {
        const firstSpan = [...decision.transcriptEvidence].sort((a, b) => a.stepIndex - b.stepIndex)[0];
        const decidedAt = messageById.get(firstSpan.messageId)?.createdAt ?? conv?.updatedAt ?? new Date();
        const traceId = generateId();
        const evidence = evidenceRefsFor(decision);
        const meta: DecisionMeta = {
          madeBy: decision.madeBy,
          basis: decision.basis,
          unsupportedAutonomous: decision.unsupportedAutonomous,
          conflictsWithUserDirection: false,
          decidedAt: decidedAt.toISOString(),
          firstStepIndex: decision.firstStepIndex,
          primaryPath: decision.primaryPath,
          conversationId: planned.conversationId,
          source: 'recovery',
          latestTraceId: traceId,
          confidence: decision.confidence,
        };

        let objectId: string;
        if (decision.existingObjectId && existingById.has(decision.existingObjectId)) {
          objectId = decision.existingObjectId;
          const previous = readDecisionMeta(existingById.get(objectId)!);
          const basisChanged = previous.basis !== decision.basis;
          await recordUnderstandingEvent({
            objectId,
            op: basisChanged ? 'refined' : 'supported',
            detail: basisChanged
              ? `Basis ${previous.basis} → ${decision.basis}: ${decision.statement}`
              : decision.statement,
            evidence,
            origin: 'ai',
            occurredAt: decidedAt,
          });
          // Keep the human-reviewed basis/madeBy; only point at the newest trace.
          await db.understandingObjects.update(objectId, {
            meta: toMetaRecord({ ...previous, latestTraceId: traceId }),
            updatedAt: new Date(),
          });
          outcome.decisionsSupported++;
        } else {
          const created = await createUnderstandingObject({
            projectId,
            type: 'decision',
            title: decision.statement,
            body: decision.why,
            origin: 'ai',
            evidence,
            occurredAt: decidedAt,
            meta: toMetaRecord(meta),
          });
          objectId = created.id;
          existingById.set(objectId, created);
          outcome.decisionsCreated++;
        }

        const hunkTexts = planned.excerpts
          .filter((e) => e.anchorStableKey && decision.anchorStableKeys.includes(e.anchorStableKey))
          .map((e) => e.text);
        const implPaths = [...new Set([...decision.implEvidence.map((c) => c.path), decision.primaryPath].filter(Boolean))];
        const trace: DecisionTrace = {
          id: traceId,
          projectId,
          decisionObjectId: objectId,
          runId: plan.runId,
          repoKey: plan.repoKey,
          sha: plan.sha,
          why: decision.why,
          alternatives: decision.alternatives,
          assumptions: decision.assumptions,
          transcriptEvidence: decision.transcriptEvidence,
          anchorStableKeys: decision.anchorStableKeys,
          implEvidence: decision.implEvidence,
          symbols: extractDeclaredSymbols(hunkTexts),
          testPaths: matchTestPaths(implPaths, treePaths),
          invalidates: invalidates.filter((inv) => inv.decisionObjectId !== objectId),
          fetchedPaths: codeExcerpts.map((c) => c.path),
          provider: config.provider,
          model: response.model,
          warnings,
          createdAt: new Date(),
        };
        await putDecisionTrace(trace);
        outcome.tracesWritten++;
      }

      if (parsed.decisions.length === 0 && invalidates.length > 0) {
        warnings.push(`${invalidates.length} invalidation(s) had no decision to attach to in this conversation and were not stored`);
      }
      if (conv && (!latestUpdatedAt || conv.updatedAt > latestUpdatedAt)) latestUpdatedAt = conv.updatedAt;
      outcome.conversationsProcessed++;
    } catch (err) {
      outcome.errored++;
      warnings.push(`Recovery failed for ${planned.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
    outcome.warnings.push(...warnings.map((w) => `${planned.name}: ${w}`));
    options.onProgress?.(outcome.conversationsProcessed + outcome.errored, plan.conversations.length);
  }

  if (plan.advancesCursor && latestUpdatedAt && outcome.errored === 0) {
    const fresh = await getUnderstandingProject(projectId);
    if (fresh) {
      await putUnderstandingProject({ ...fresh, lastDecisionRecoveredAt: latestUpdatedAt, updatedAt: new Date() });
    }
  }
  return outcome;
}

/** Exposed for the planner UI: how many steps a conversation would contribute. */
export function stepCount(steps: Step[]): number {
  return steps.length;
}

export type { InvestigationAnchor };

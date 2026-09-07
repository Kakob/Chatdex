// Recovery candidates (SPEC-decision-recovery §9.1). Deterministic, no model.
//
// Transcript side: every user message in full (the `specified` oracle), plus
// — for each code-changing anchor — the agent text that preceded it and the
// hunk itself. Each excerpt is tagged with its step index so the model can
// only point at steps it was shown (law 2.1). Repository side: the paths the
// agent edited or inspected, resolved against the cached snapshot and marked
// pre-existing when this session did not create them (the `inherited`
// oracle, law 2.2).

import type { Step, StepKind } from '../../detection/normalize';
import { scrubSecrets, isFetchAllowed } from '../trace/fetchPolicy';
import { extractMentionedPaths, resolveInTree } from '../trace/candidateFiles';
import type { InvestigationAnchor } from '../../../types/investigation';

export const DEFAULT_MAX_USER_CHARS = 4000;
export const DEFAULT_MAX_AGENT_CHARS = 2000;
export const DEFAULT_MAX_HUNK_CHARS = 1500;
export const DEFAULT_ANCHOR_WINDOW = 6;
export const DEFAULT_MAX_TOTAL_CHARS = 60_000;
/** Agent text steps after the last edit (the closing summary) that are always included. */
export const DEFAULT_CLOSING_AGENT_TEXTS = 2;
export const DEFAULT_MAX_CLOSING_CHARS = 4000;
export const DEFAULT_MAX_RECOVERY_FILES = 8;

export interface StepExcerpt {
  stepIndex: number;
  role: StepKind;
  messageId: string;
  /** Scrubbed, capped text the model sees — and the only text quotes are verified against. */
  text: string;
  anchorStableKey?: string;
  hunkPaths?: string[];
}

export interface TranscriptExcerptSet {
  conversationId: string;
  excerpts: StepExcerpt[];
  totalChars: number;
  /** Anchors (oldest first) dropped to fit the total cap. */
  droppedAnchors: number;
  warnings: string[];
}

export interface TranscriptExcerptOptions {
  maxUserChars?: number;
  maxAgentChars?: number;
  maxHunkChars?: number;
  window?: number;
  maxTotalChars?: number;
  /** How many agent-text steps after the final edit to include (agents state decisions in their wrap-up). */
  closingAgentTexts?: number;
  maxClosingChars?: number;
}

function cap(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}\n…[truncated]` : text;
}

/** Render a hunk the way a reviewer would read it; quotes can target either side. */
export function renderHunk(
  toolName: string,
  changes: Array<{ path: string; oldString?: string; newString: string }>,
  maxHunkChars: number
): string {
  return changes
    .map((c) => {
      const parts = [`${toolName} ${c.path}`];
      if (c.oldString !== undefined) parts.push(`--- old\n${cap(c.oldString, maxHunkChars)}`);
      parts.push(`+++ new\n${cap(c.newString, maxHunkChars)}`);
      return parts.join('\n');
    })
    .join('\n\n');
}

export function buildTranscriptExcerpts(
  conversationId: string,
  steps: Step[],
  anchors: InvestigationAnchor[],
  opts: TranscriptExcerptOptions = {}
): TranscriptExcerptSet {
  const maxUser = opts.maxUserChars ?? DEFAULT_MAX_USER_CHARS;
  const maxAgent = opts.maxAgentChars ?? DEFAULT_MAX_AGENT_CHARS;
  const maxHunk = opts.maxHunkChars ?? DEFAULT_MAX_HUNK_CHARS;
  const window = opts.window ?? DEFAULT_ANCHOR_WINDOW;
  const maxTotal = opts.maxTotalChars ?? DEFAULT_MAX_TOTAL_CHARS;
  const closingCount = opts.closingAgentTexts ?? DEFAULT_CLOSING_AGENT_TEXTS;
  const maxClosing = opts.maxClosingChars ?? DEFAULT_MAX_CLOSING_CHARS;
  const warnings: string[] = [];
  const byIndex = new Map(steps.map((s) => [s.index, s]));

  const scrub = (text: string, max: number) => scrubSecrets(cap(text, max)).text;

  // User messages: always in, in full (capped per message).
  const userExcerpts: StepExcerpt[] = steps
    .filter((s) => s.kind === 'user_msg' && (s.text ?? '').trim())
    .map((s) => ({ stepIndex: s.index, role: s.kind, messageId: s.messageId, text: scrub(s.text ?? '', maxUser) }));

  // Per anchor: preceding agent text within the window + the hunk.
  const anchorGroups: StepExcerpt[][] = [];
  const claimed = new Set<number>(userExcerpts.map((e) => e.stepIndex));
  const sorted = [...anchors].sort((a, b) => a.stepIndex - b.stepIndex);
  for (const anchor of sorted) {
    const group: StepExcerpt[] = [];
    for (let i = Math.max(0, anchor.stepIndex - window); i < anchor.stepIndex; i++) {
      const s = byIndex.get(i);
      if (!s || s.kind !== 'agent_text' || claimed.has(i) || !(s.text ?? '').trim()) continue;
      claimed.add(i);
      group.push({ stepIndex: i, role: s.kind, messageId: s.messageId, text: scrub(s.text ?? '', maxAgent) });
    }
    const callStep = byIndex.get(anchor.stepIndex);
    if (callStep && !claimed.has(anchor.stepIndex)) {
      claimed.add(anchor.stepIndex);
      group.push({
        stepIndex: anchor.stepIndex,
        role: callStep.kind,
        messageId: callStep.messageId,
        text: scrubSecrets(renderHunk(anchor.toolName, anchor.fileChanges, maxHunk)).text,
        anchorStableKey: anchor.stableKey,
        hunkPaths: anchor.filePaths,
      });
    }
    anchorGroups.push(group);
  }

  // Closing statements: the last agent texts after the final edit. Agents
  // summarize what they built there — permanence, cascades, what they did not
  // do — so these are kept like user messages (never dropped for the cap).
  const lastAnchorIndex = sorted.length ? sorted[sorted.length - 1].stepIndex : -1;
  const closing: StepExcerpt[] = steps
    .filter((s) => s.kind === 'agent_text' && s.index > lastAnchorIndex && !claimed.has(s.index) && (s.text ?? '').trim())
    .slice(-closingCount)
    .map((s) => {
      claimed.add(s.index);
      return { stepIndex: s.index, role: s.kind, messageId: s.messageId, text: scrub(s.text ?? '', maxClosing) };
    });

  const size = (list: StepExcerpt[]) => list.reduce((n, e) => n + e.text.length, 0);
  let total = size(userExcerpts) + size(closing) + anchorGroups.reduce((n, g) => n + size(g), 0);
  let dropped = 0;
  while (total > maxTotal && anchorGroups.length > 0) {
    total -= size(anchorGroups.shift()!);
    dropped++;
  }
  if (dropped > 0) {
    warnings.push(`Dropped the ${dropped} oldest edit(s) and their context to fit ${maxTotal} characters; decisions there were not recoverable in this run`);
  }
  if (total > maxTotal) {
    warnings.push('User messages alone exceed the excerpt cap; later messages were truncated');
    let budget = maxTotal;
    for (const e of userExcerpts) {
      if (e.text.length > budget) e.text = cap(e.text, Math.max(0, budget));
      budget = Math.max(0, budget - e.text.length);
    }
    total = size(userExcerpts);
  }

  const excerpts = [...userExcerpts, ...closing, ...anchorGroups.flat()].sort((a, b) => a.stepIndex - b.stepIndex);
  return { conversationId, excerpts, totalChars: total, droppedAnchors: dropped, warnings };
}

export interface RecoveryCandidateFile {
  path: string;
  reason: 'anchor' | 'inspected' | 'mentioned';
  /** In the snapshot and not created by this session — the `inherited` oracle. */
  preExisting: boolean;
}

export interface RecoveryFileSelection {
  candidates: RecoveryCandidateFile[];
  skipped: Array<{ path: string; reason: 'sensitive' | 'excluded' }>;
}

export interface RecoveryFileContext {
  /** Repo-relative paths from this session's anchors. */
  anchorPaths: string[];
  /** Repo-relative paths from this session's Read/Grep/Glob/LS calls. */
  inspectedPaths: string[];
  /** Texts to mine for mentioned paths (user messages). */
  mentionedTexts: string[];
  /** Paths in the cached snapshot. */
  treePaths: string[];
  /** Paths this session created with a whole-file Write. */
  createdPaths: Set<string>;
  maxFiles?: number;
}

export function selectRecoveryFiles(ctx: RecoveryFileContext): RecoveryFileSelection {
  const maxFiles = ctx.maxFiles ?? DEFAULT_MAX_RECOVERY_FILES;
  const treeSet = new Set(ctx.treePaths);
  const candidates: RecoveryCandidateFile[] = [];
  const skipped: RecoveryFileSelection['skipped'] = [];
  const seen = new Set<string>();
  const add = (path: string, reason: RecoveryCandidateFile['reason']) => {
    if (seen.has(path) || candidates.length >= maxFiles) return;
    seen.add(path);
    const decision = isFetchAllowed(path);
    if (!decision.allowed) {
      skipped.push({ path, reason: decision.reason });
      return;
    }
    candidates.push({ path, reason, preExisting: treeSet.has(path) && !ctx.createdPaths.has(path) });
  };
  for (const p of ctx.anchorPaths) for (const r of resolveInTree(p, ctx.treePaths, treeSet)) add(r, 'anchor');
  for (const p of ctx.inspectedPaths) for (const r of resolveInTree(p, ctx.treePaths, treeSet)) add(r, 'inspected');
  for (const p of extractMentionedPaths(ctx.mentionedTexts)) for (const r of resolveInTree(p, ctx.treePaths, treeSet)) add(r, 'mentioned');
  return { candidates, skipped };
}

/** Dependency names from a snapshot's package.json, for the `inherited` pointer check. */
export function dependencyNames(packageJsonText: string | undefined): Set<string> {
  const out = new Set<string>();
  if (!packageJsonText) return out;
  try {
    const pkg = JSON.parse(packageJsonText) as Record<string, unknown>;
    for (const key of ['dependencies', 'devDependencies', 'peerDependencies']) {
      const deps = pkg[key];
      if (deps && typeof deps === 'object') for (const name of Object.keys(deps)) out.add(name);
    }
  } catch {
    // Not JSON; no dependencies known.
  }
  return out;
}

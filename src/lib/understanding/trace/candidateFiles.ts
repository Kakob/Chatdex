// Candidate file selection for the implementation leg (SPEC-intent-trace
// §9.2). Three channels, in precedence order: paths the source conversation
// mentions, paths the agent edited in that conversation (investigation
// anchors — Claude Code only, blind to Codex-cloud/manual edits), and
// keyword overlap between the intent and tree paths. Pure; the fetch gate is
// applied here so a disallowed path never becomes a candidate.

import { isFetchAllowed } from './fetchPolicy';
import { tokenize } from './specDocs';

export const DEFAULT_MAX_FILES = 8;
export const DEFAULT_MAX_CHARS_PER_FILE = 6000;
export const DEFAULT_WINDOW_LINES = 40;

// Path-like tokens: `src/a/b.ts`, `backend/x.ts`, `./docs/spec.md`, or a bare
// `Sidebar.tsx`-style filename with a code/doc extension.
const PATH_RE = /(?:^|[\s"'`([<])((?:\.{0,2}\/)?(?:[\w.@-]+\/)+[\w.@-]+\.[A-Za-z0-9]{1,8})(?=$|[\s"'`)\]>:,;])/g;
const BARE_FILE_RE = /(?<![\w/.-])([A-Za-z_][\w-]*\.(?:tsx?|jsx?|mjs|cjs|md|json|ya?ml|css|scss|html|py|go|rs|rb|java|kt|swift|sql|toml|sh))\b/g;

export function extractMentionedPaths(texts: string[]): string[] {
  const out = new Set<string>();
  for (const text of texts) {
    for (const m of text.matchAll(PATH_RE)) {
      out.add(m[1].replace(/^\.?\//, '').replace(/[.,;:]+$/, ''));
    }
    for (const m of text.matchAll(BARE_FILE_RE)) out.add(m[1]);
  }
  return [...out];
}

/** Strip a conversation's working-directory prefix; keep already-relative paths. */
export function toRepoRelative(absPath: string, roots: string[]): string | null {
  if (!absPath.startsWith('/')) return absPath.replace(/^\.\//, '');
  for (const root of roots) {
    const r = root.replace(/\/+$/, '');
    if (r && absPath.startsWith(`${r}/`)) return absPath.slice(r.length + 1);
  }
  return null;
}

/** Resolve a mentioned/anchored path to tree paths: exact, or a unique suffix match. */
export function resolveInTree(path: string, treePaths: string[], treeSet: Set<string>): string[] {
  if (treeSet.has(path)) return [path];
  const suffix = `/${path}`;
  const matches = treePaths.filter((p) => p.endsWith(suffix));
  return matches.length === 1 ? matches : path.includes('/') ? matches.slice(0, 2) : [];
}

export function rankTreePathsByKeywords(
  intent: { title: string; statement: string },
  treePaths: string[],
  max: number
): string[] {
  const keywords = tokenize(`${intent.title} ${intent.statement}`);
  if (keywords.length === 0) return [];
  // Test files can match well by name but rarely hold the implementation;
  // they rank at half weight so source files lead the keyword channel.
  const isTest = (p: string) => /(\.test\.|\.spec\.|(^|\/)__tests__\/|(^|\/)tests?\/)/.test(p);
  const scored: Array<{ path: string; score: number }> = [];
  for (const path of treePaths) {
    const pathTokens = new Set(tokenize(path.replace(/\.[A-Za-z0-9]+$/, '')));
    let score = 0;
    for (const k of keywords) if (pathTokens.has(k)) score++;
    if (score > 0) scored.push({ path, score: isTest(path) ? score / 2 : score });
  }
  return scored
    .sort(
      (a, b) =>
        b.score - a.score ||
        Number(isTest(a.path)) - Number(isTest(b.path)) ||
        a.path.length - b.path.length ||
        a.path.localeCompare(b.path)
    )
    .slice(0, max)
    .map((s) => s.path);
}

export interface CandidateFile {
  path: string;
  reason: 'mentioned' | 'anchor' | 'keyword' | 'suggested' | 'manual';
}

export interface CandidateContext {
  conversationTexts: string[];
  /** Repo-relative paths from investigation anchors. */
  anchorPaths: string[];
  treePaths: string[];
  /** Paths carried over from a previous trace's suggestions or typed by the user. */
  extraPaths?: Array<{ path: string; reason: 'suggested' | 'manual' }>;
  maxFiles?: number;
  /** Disable the keyword channel (huge trees). */
  keywordDisabled?: boolean;
}

export interface CandidateSelection {
  candidates: CandidateFile[];
  /** Paths that a channel proposed but the fetch gate refused. */
  skipped: Array<{ path: string; reason: 'sensitive' | 'excluded' }>;
}

export function selectCandidateFiles(
  intent: { title: string; statement: string },
  ctx: CandidateContext
): CandidateSelection {
  const maxFiles = ctx.maxFiles ?? DEFAULT_MAX_FILES;
  const treeSet = new Set(ctx.treePaths);
  const candidates: CandidateFile[] = [];
  const skipped: CandidateSelection['skipped'] = [];
  const seen = new Set<string>();

  const add = (path: string, reason: CandidateFile['reason']) => {
    if (seen.has(path) || candidates.length >= maxFiles) return;
    seen.add(path);
    const decision = isFetchAllowed(path);
    if (!decision.allowed) {
      skipped.push({ path, reason: decision.reason });
      return;
    }
    candidates.push({ path, reason });
  };

  for (const extra of ctx.extraPaths ?? []) {
    for (const p of resolveInTree(extra.path, ctx.treePaths, treeSet)) add(p, extra.reason);
  }
  for (const mentioned of extractMentionedPaths(ctx.conversationTexts)) {
    for (const p of resolveInTree(mentioned, ctx.treePaths, treeSet)) add(p, 'mentioned');
  }
  for (const anchor of ctx.anchorPaths) {
    for (const p of resolveInTree(anchor, ctx.treePaths, treeSet)) add(p, 'anchor');
  }
  if (!ctx.keywordDisabled && candidates.length < maxFiles) {
    for (const p of rankTreePathsByKeywords(intent, ctx.treePaths, maxFiles * 2)) add(p, 'keyword');
  }
  return { candidates, skipped };
}

export interface FileExcerpt {
  /** Numbered lines (`N: text`), windows joined by an ellipsis line. */
  excerpt: string;
  /** 1-based inclusive line ranges included. */
  ranges: Array<[number, number]>;
}

/**
 * Keyword-centred windows over a file, numbered so the model can point at
 * lines; falls back to the head of the file when nothing matches. The
 * verifier never trusts these numbers — it recomputes from the quote.
 */
export function excerptFile(
  text: string,
  keywords: string[],
  opts: { maxChars?: number; windowLines?: number } = {}
): FileExcerpt {
  const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS_PER_FILE;
  const windowLines = opts.windowLines ?? DEFAULT_WINDOW_LINES;
  const lines = text.split('\n');
  const lower = keywords.map((k) => k.toLowerCase());

  const hitLines: number[] = [];
  if (lower.length > 0) {
    lines.forEach((line, i) => {
      const l = line.toLowerCase();
      if (lower.some((k) => l.includes(k))) hitLines.push(i);
    });
  }

  const ranges: Array<[number, number]> = [];
  if (hitLines.length === 0) {
    ranges.push([0, Math.min(lines.length, windowLines) - 1]);
  } else {
    for (const i of hitLines) {
      const start = Math.max(0, i - Math.floor(windowLines / 2));
      const end = Math.min(lines.length - 1, start + windowLines - 1);
      const last = ranges[ranges.length - 1];
      if (last && start <= last[1] + 1) last[1] = Math.max(last[1], end);
      else ranges.push([start, end]);
    }
  }

  const parts: string[] = [];
  const kept: Array<[number, number]> = [];
  let used = 0;
  for (const [start, end] of ranges) {
    const block = lines.slice(start, end + 1).map((l, j) => `${start + 1 + j}: ${l}`).join('\n');
    if (used + block.length > maxChars) {
      const room = maxChars - used;
      if (room > 200) {
        const cut = block.slice(0, room);
        const keptLines = cut.split('\n').length;
        parts.push(cut);
        kept.push([start + 1, start + keptLines]);
      }
      break;
    }
    parts.push(block);
    kept.push([start + 1, end + 1]);
    used += block.length;
  }
  return { excerpt: parts.join('\n…\n'), ranges: kept };
}

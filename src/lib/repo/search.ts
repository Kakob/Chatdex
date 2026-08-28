// Client-side repository search over the LOCAL-ONLY file cache
// (SPEC-change-workspace §9, audit S8). Pure functions: no network, no LLM —
// this is the deterministic half of Guided mode (§13). Regex mode is guarded
// against catastrophic backtracking by a pattern pre-check plus a per-file
// time budget.

import { scrubSecrets } from '../understanding/trace/fetchPolicy';
import { sha256Hex } from '../utils/hash';
import { MAX_QUOTE_CHARS, type CodeEvidence, type EvidenceAddedVia } from '../../types/evidence';
import type { RepoFileRow } from '../../types/repo';

/** Hits returned per search (audit S8 / UI sanity). */
export const MAX_SEARCH_HITS = 500;
/** Regex pattern length cap (audit S8). */
export const MAX_PATTERN_LENGTH = 200;
/** Context lines shown around a hit. */
export const DEFAULT_CONTEXT_LINES = 2;
/** Per-file scan budget in ms before the file is reported as skipped (audit S8). */
export const PER_FILE_TIME_BUDGET_MS = 50;

export interface SearchHit {
  repoKey: string;
  sha: string;
  path: string;
  /** 1-based. */
  line: number;
  text: string;
  before: string[];
  after: string[];
  /** Set by findSymbol when the line looks like a declaration. */
  declaration?: boolean;
}

export interface SearchResult {
  hits: SearchHit[];
  /** True when MAX_SEARCH_HITS (or `maxHits`) was reached. */
  capped: boolean;
  /** Files whose scan exceeded the time budget. */
  timedOut: string[];
  filesScanned: number;
}

export interface GrepOptions {
  regex?: boolean;
  caseSensitive?: boolean;
  /** Simple glob: `*` within a segment, `**` across segments, `?` one char. */
  pathGlob?: string;
  maxHits?: number;
  contextLines?: number;
}

// --- pattern safety (S8) ---

/** Rejects patterns likely to backtrack catastrophically: nested quantifiers and backreferences. */
export function isSafePattern(pattern: string): { ok: true } | { ok: false; reason: string } {
  if (pattern.length === 0) return { ok: false, reason: 'empty pattern' };
  if (pattern.length > MAX_PATTERN_LENGTH) {
    return { ok: false, reason: `pattern longer than ${MAX_PATTERN_LENGTH} characters` };
  }
  if (/\\[1-9]/.test(pattern)) return { ok: false, reason: 'backreferences are not allowed' };
  // A quantified group that contains a quantifier or an alternation:
  // (a+)+, (a*)*, (\w+\s?)*, (a|aa)+ — the classic catastrophic shapes.
  if (/\((?:[^()\\]|\\.)*[*+|](?:[^()\\]|\\.)*\)\s*[*+{]/.test(pattern)) {
    return { ok: false, reason: 'nested quantifiers are not allowed' };
  }
  // Adjacent quantifiers like a++ or .*+ (possessive-looking; also backtrack-heavy in JS)
  if (/[*+?}][*+]/.test(pattern)) return { ok: false, reason: 'stacked quantifiers are not allowed' };
  try {
    new RegExp(pattern);
  } catch {
    return { ok: false, reason: 'invalid regular expression' };
  }
  return { ok: true };
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function globToRegExp(glob: string): RegExp {
  let out = '^';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        out += '.*';
        i += 1;
        if (glob[i + 1] === '/') i += 1;
      } else {
        out += '[^/]*';
      }
    } else if (c === '?') {
      out += '[^/]';
    } else {
      out += escapeRegExp(c);
    }
  }
  return new RegExp(out + '$');
}

// --- core scan ---

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function scan(
  rows: RepoFileRow[],
  matcher: RegExp,
  opts: { pathGlob?: string; maxHits?: number; contextLines?: number; classify?: (line: string) => boolean | undefined }
): SearchResult {
  const maxHits = opts.maxHits ?? MAX_SEARCH_HITS;
  const context = opts.contextLines ?? DEFAULT_CONTEXT_LINES;
  const pathFilter = opts.pathGlob ? globToRegExp(opts.pathGlob) : null;
  const hits: SearchHit[] = [];
  const timedOut: string[] = [];
  let filesScanned = 0;
  let capped = false;

  outer: for (const row of rows) {
    if (pathFilter && !pathFilter.test(row.path)) continue;
    filesScanned += 1;
    const lines = row.content.split('\n');
    const started = now();
    for (let i = 0; i < lines.length; i++) {
      if ((i & 63) === 0 && now() - started > PER_FILE_TIME_BUDGET_MS) {
        timedOut.push(row.path);
        continue outer;
      }
      matcher.lastIndex = 0;
      if (!matcher.test(lines[i])) continue;
      const hit: SearchHit = {
        repoKey: row.repoKey,
        sha: row.sha,
        path: row.path,
        line: i + 1,
        text: lines[i],
        before: lines.slice(Math.max(0, i - context), i),
        after: lines.slice(i + 1, i + 1 + context),
      };
      const declaration = opts.classify?.(lines[i]);
      if (declaration !== undefined) hit.declaration = declaration;
      hits.push(hit);
      if (hits.length >= maxHits) {
        capped = true;
        break outer;
      }
    }
  }
  return { hits, capped, timedOut, filesScanned };
}

export function grep(rows: RepoFileRow[], query: string, opts: GrepOptions = {}): SearchResult {
  const flags = opts.caseSensitive ? '' : 'i';
  let matcher: RegExp;
  if (opts.regex) {
    const safety = isSafePattern(query);
    if (!safety.ok) throw new Error(`Unsafe pattern: ${safety.reason}`);
    matcher = new RegExp(query, flags);
  } else {
    if (!query.trim()) return { hits: [], capped: false, timedOut: [], filesScanned: 0 };
    matcher = new RegExp(escapeRegExp(query), flags);
  }
  return scan(rows, matcher, opts);
}

const IDENT_RE = /^[A-Za-z_$][\w$]*$/;

function assertIdentifier(name: string): void {
  if (!IDENT_RE.test(name)) throw new Error('Symbol must be an identifier');
}

/** Declaration heuristic (§9): keyword declarations, property/arrow assignments, methods, default exports. */
export function looksLikeDeclaration(line: string, name: string): boolean {
  const n = escapeRegExp(name);
  return (
    new RegExp(`\\b(?:function\\*?|const|let|var|class|interface|type|enum|namespace)\\s+${n}\\b`).test(line) ||
    new RegExp(`\\bexport\\s+default\\s+${n}\\b`).test(line) ||
    new RegExp(`(?:^|[\\s,{])${n}\\s*[:=]\\s*(?:async\\s*)?(?:\\(|function\\b|[\\w$]+\\s*=>)`).test(line) ||
    new RegExp(`^\\s*(?:(?:public|private|protected|static|async|readonly)\\s+)*${n}\\s*\\([^)]*\\)\\s*(?::[^{;]+)?\\{?\\s*$`).test(line)
  );
}

/** Word-boundary occurrences classified as declaration / not. */
export function findSymbol(rows: RepoFileRow[], name: string, opts: Omit<GrepOptions, 'regex' | 'caseSensitive'> = {}): SearchResult {
  assertIdentifier(name);
  const matcher = new RegExp(`(?<![\\w$])${escapeRegExp(name)}(?![\\w$])`);
  const result = scan(rows, matcher, { ...opts, classify: (line) => looksLikeDeclaration(line, name) });
  // Declarations first, then references, stable within each group.
  result.hits.sort((a, b) => Number(Boolean(b.declaration)) - Number(Boolean(a.declaration)));
  return result;
}

/** Word-boundary occurrences that are not declarations. */
export function findReferences(rows: RepoFileRow[], name: string, opts: Omit<GrepOptions, 'regex' | 'caseSensitive'> = {}): SearchResult {
  const all = findSymbol(rows, name, { ...opts, maxHits: undefined });
  const hits = all.hits.filter((h) => !h.declaration);
  const maxHits = opts.maxHits ?? MAX_SEARCH_HITS;
  return {
    hits: hits.slice(0, maxHits),
    capped: all.capped || hits.length > maxHits,
    timedOut: all.timedOut,
    filesScanned: all.filesScanned,
  };
}

// --- evidence ---

/** The exact cached lines for a range (1-based inclusive), clipped to the file. */
export function excerpt(row: RepoFileRow, startLine: number, endLine: number): { startLine: number; endLine: number; text: string } {
  const lines = row.content.split('\n');
  const start = Math.max(1, Math.min(startLine, lines.length));
  const end = Math.max(start, Math.min(endLine, lines.length));
  return { startLine: start, endLine: end, text: lines.slice(start - 1, end).join('\n') };
}

/**
 * Build a `code` evidence item from cached lines: secret-scrubbed, capped at
 * MAX_QUOTE_CHARS, hashed after scrubbing/capping so re-fetch can detect
 * drift (§8). Returns the redaction count so the UI can warn.
 */
export async function buildCodeEvidence(
  row: RepoFileRow,
  startLine: number,
  endLine: number,
  options: { id: string; addedVia: EvidenceAddedVia; note?: string; createdAt?: string }
): Promise<{ item: CodeEvidence; redactions: number; truncated: boolean }> {
  const ex = excerpt(row, startLine, endLine);
  const scrubbed = scrubSecrets(ex.text);
  const truncated = scrubbed.text.length > MAX_QUOTE_CHARS;
  const quote = truncated ? scrubbed.text.slice(0, MAX_QUOTE_CHARS) : scrubbed.text;
  const item: CodeEvidence = {
    id: options.id,
    kind: 'code',
    createdAt: options.createdAt ?? new Date().toISOString(),
    origin: 'user',
    addedVia: options.addedVia,
    ...(options.note ? { note: options.note } : {}),
    repoKey: row.repoKey,
    sha: row.sha,
    path: row.path,
    startLine: ex.startLine,
    endLine: ex.endLine,
    quote,
    quoteHash: await sha256Hex(quote),
  };
  return { item, redactions: scrubbed.redactions, truncated };
}

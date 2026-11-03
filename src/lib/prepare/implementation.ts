// Implementation attach (SPEC-change-workspace §11, CW-3). Chatdex never
// produces or reads a local diff (D6): an implementation arrives from a
// GitHub compare, a pull request, an ingested Claude Code session's derived
// file changes, or a pasted unified diff. Patches are secret-scrubbed and
// capped before they can enter the synced workspace (audit S4, S7).

import { compareCommits, getPullFiles, type DiffFile, type GitHubClientOptions } from '../github/client';
import { listInvestigationAnchors } from '../db/investigationAnchors';
import { scrubSecrets } from '../understanding/trace/fetchPolicy';
import type { Implementation, ImplementationFile, ImplementationProvenance } from '../../types/preparedChange';

/** Per-file patch cap (audit S7). */
export const MAX_PATCH_BYTES = 20 * 1024;
/** Per-workspace patch cap; beyond it, remaining files keep stats only (audit S7). */
export const MAX_TOTAL_PATCH_BYTES = 200 * 1024;

export type AttachInput = Omit<Implementation, 'attachedAt'>;

export interface CapReport {
  /** Files whose patch was dropped for size (per-file or total cap). */
  patchesDropped: string[];
  /** Secret-shaped strings redacted across all patches. */
  redactions: number;
}

/** Scrub + cap patches; files beyond the caps keep additions/deletions only. */
export function capPatches(
  files: ImplementationFile[],
  options: { keepPatches?: boolean } = {}
): { files: ImplementationFile[]; report: CapReport } {
  const report: CapReport = { patchesDropped: [], redactions: 0 };
  let total = 0;
  const out = files.map((file) => {
    if (!file.patch || options.keepPatches === false) {
      const { patch: _drop, ...rest } = file;
      void _drop;
      return rest;
    }
    const scrubbed = scrubSecrets(file.patch);
    report.redactions += scrubbed.redactions;
    const bytes = new TextEncoder().encode(scrubbed.text).length;
    if (bytes > MAX_PATCH_BYTES || total + bytes > MAX_TOTAL_PATCH_BYTES) {
      report.patchesDropped.push(file.path);
      const { patch: _drop, ...rest } = file;
      void _drop;
      return rest;
    }
    total += bytes;
    return { ...file, patch: scrubbed.text };
  });
  return { files: out, report };
}

function fromDiffFiles(files: DiffFile[]): ImplementationFile[] {
  return files.map((f) => ({
    path: f.path,
    additions: f.additions,
    deletions: f.deletions,
    ...(f.patch ? { patch: f.patch } : {}),
  }));
}

export interface GitHubAttachOptions {
  provenance: ImplementationProvenance;
  provenanceNote?: string;
  keepPatches?: boolean;
  client?: GitHubClientOptions;
}

export async function implementationFromCompare(
  owner: string,
  repo: string,
  base: string,
  head: string,
  options: GitHubAttachOptions
): Promise<{ input: AttachInput; report: CapReport }> {
  const compare = await compareCommits(owner, repo, base, head, options.client);
  const { files, report } = capPatches(fromDiffFiles(compare.files), { keepPatches: options.keepPatches });
  return {
    input: {
      source: 'github_compare',
      provenance: options.provenance,
      ...(options.provenanceNote ? { provenanceNote: options.provenanceNote } : {}),
      baseSha: compare.baseSha,
      headSha: compare.headSha,
      files,
    },
    report,
  };
}

export async function implementationFromPull(
  owner: string,
  repo: string,
  pullNumber: number,
  options: GitHubAttachOptions
): Promise<{ input: AttachInput; report: CapReport; title: string }> {
  const pr = await getPullFiles(owner, repo, pullNumber, options.client);
  const { files, report } = capPatches(fromDiffFiles(pr.files), { keepPatches: options.keepPatches });
  return {
    input: {
      source: 'github_pr',
      provenance: options.provenance,
      ...(options.provenanceNote ? { provenanceNote: options.provenanceNote } : {}),
      baseSha: pr.baseSha,
      headSha: pr.headSha,
      prNumber: pr.number,
      files,
    },
    report,
    title: pr.title,
  };
}

function countLines(text: string | undefined): number {
  if (!text) return 0;
  return text.split('\n').length;
}

/**
 * Aggregate an ingested Claude Code session's derived file changes into
 * per-file stats. Provenance defaults to `ai` — the session *is* the agent's
 * work — and the user may relabel it `human_ai`. No patch text is stored:
 * the exact edits stay in the session (open via the anchor deep link).
 */
export async function implementationFromClaudeCodeSession(
  conversationId: string,
  options: { provenance?: ImplementationProvenance; provenanceNote?: string } = {}
): Promise<{ input: AttachInput; anchorCount: number }> {
  const anchors = await listInvestigationAnchors({ conversationId, order: 'asc' });
  const byPath = new Map<string, ImplementationFile>();
  for (const anchor of anchors) {
    for (const change of anchor.fileChanges) {
      const entry = byPath.get(change.path) ?? { path: change.path, additions: 0, deletions: 0 };
      entry.additions += countLines(change.newString);
      entry.deletions += countLines(change.oldString);
      byPath.set(change.path, entry);
    }
  }
  if (byPath.size === 0) {
    throw new Error('That session has no derived file changes to attach');
  }
  return {
    input: {
      source: 'claude_code_session',
      provenance: options.provenance ?? 'ai',
      ...(options.provenanceNote ? { provenanceNote: options.provenanceNote } : {}),
      conversationId,
      files: [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path)),
    },
    anchorCount: anchors.length,
  };
}

const HEADER_RE = /^diff --git a\/(.+?) b\/(.+)$/;
const PLUS_FILE_RE = /^\+\+\+ (?:b\/)?(.+)$/;
const MINUS_FILE_RE = /^--- (?:a\/)?(.+)$/;

/** Parse a unified diff into per-file stats + patch text. Tolerates `git diff` and plain `diff -u` output. */
export function parseUnifiedDiff(text: string): ImplementationFile[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const files: ImplementationFile[] = [];
  let current: (ImplementationFile & { lines: string[] }) | null = null;
  let pendingMinus: string | null = null;

  const flush = () => {
    if (!current) return;
    const { lines: body, ...file } = current;
    files.push({ ...file, patch: body.join('\n').trim() });
    current = null;
  };

  const inHunks = () => Boolean(current && current.lines.some((l) => l.startsWith('@@')));

  for (const line of lines) {
    const header = HEADER_RE.exec(line);
    if (header) {
      flush();
      current = { path: header[2], additions: 0, deletions: 0, lines: [line] };
      pendingMinus = null;
      continue;
    }
    const minus = MINUS_FILE_RE.exec(line);
    if (minus && !inHunks()) {
      // `--- old` starts a new file block in plain `diff -u` output; inside a
      // git block it just names the "a/" side.
      if (current && !HEADER_RE.test(current.lines[0] ?? '')) flush();
      pendingMinus = minus[1] === '/dev/null' ? null : minus[1];
      if (current) current.lines.push(line);
      continue;
    }
    if (minus && inHunks()) {
      // A second `---` after hunks: plain-diff boundary.
      flush();
      pendingMinus = minus[1] === '/dev/null' ? null : minus[1];
      continue;
    }
    const plus = PLUS_FILE_RE.exec(line);
    if (plus && !inHunks()) {
      const path = plus[1] === '/dev/null' ? pendingMinus : plus[1];
      if (!current) {
        current = { path: path ?? 'unknown', additions: 0, deletions: 0, lines: [] };
      } else if (!HEADER_RE.test(current.lines[0] ?? '')) {
        current.path = path ?? current.path;
      }
      current.lines.push(line);
      continue;
    }
    if (!current) continue;
    current.lines.push(line);
    if (line.startsWith('+') && !line.startsWith('+++')) current.additions += 1;
    else if (line.startsWith('-') && !line.startsWith('---')) current.deletions += 1;
  }
  flush();
  return files.filter((f) => f.path && f.path !== 'unknown');
}

export function implementationFromPastedDiff(
  text: string,
  options: { provenance: ImplementationProvenance; provenanceNote?: string; keepPatches?: boolean }
): { input: AttachInput; report: CapReport } {
  const parsed = parseUnifiedDiff(text);
  if (parsed.length === 0) throw new Error('No files found in the pasted diff (expected unified diff output)');
  const { files, report } = capPatches(parsed, { keepPatches: options.keepPatches });
  return {
    input: {
      source: 'pasted_diff',
      provenance: options.provenance,
      ...(options.provenanceNote ? { provenanceNote: options.provenanceNote } : {}),
      files,
    },
    report,
  };
}

export function implementationStats(files: ImplementationFile[]): { files: number; additions: number; deletions: number } {
  return files.reduce(
    (acc, f) => ({ files: acc.files + 1, additions: acc.additions + f.additions, deletions: acc.deletions + f.deletions }),
    { files: 0, additions: 0, deletions: 0 }
  );
}

export const PROVENANCE_LABEL: Record<ImplementationProvenance, string> = {
  human: 'Human',
  ai: 'AI agent',
  human_ai: 'Human + AI',
  imported: 'Imported / unknown',
};

// Blast radius v1 (SPEC-decision-recovery §11.2). Text-level, deterministic,
// never stored, zero network: symbol references over the LOCAL-ONLY repo
// cache, other sessions that touched the same files (anchor reverse index),
// other decisions sharing paths, and tests matched by basename. Every leg is
// labelled `heuristic` — this is where to look, not what is affected. The
// Flow Map (deferred) replaces the symbol / file / test legs with reverse link
// traversal.

import { db } from '../../db/schema';
import { listRepoFiles } from '../../db/repoFiles';
import { getInvestigationAnchor } from '../../db/investigationAnchors';
import { getLatestTraceByDecision } from '../../db/decisionTraces';
import { findReferences, findSymbol, grep, type SearchHit } from '../../repo/search';
import { matchTestPaths } from './symbols';
import type { DecisionTrace } from '../../../types/decision';
import type { RepoFileRow } from '../../../types/repo';

export const DEFAULT_MAX_HITS_PER_SYMBOL = 40;
export const MAX_SYMBOLS = 12;

export interface BlastRadiusSymbol {
  name: string;
  declaredIn: string[];
  /** References outside the decision's own paths. */
  references: SearchHit[];
  capped: boolean;
}

export interface BlastRadius {
  /** Repo-relative paths the decision implemented (own paths). */
  paths: string[];
  symbols: BlastRadiusSymbol[];
  referencingFiles: string[];
  relatedSessions: Array<{ conversationId: string; name: string | null; paths: string[]; anchorCount: number }>;
  relatedDecisions: Array<{ objectId: string; title: string | null; sharedPaths: string[] }>;
  tests: string[];
  verification: 'heuristic';
  truncated: boolean;
  /** Set when no snapshot rows exist for the trace's repoKey/sha. */
  snapshotMissing: boolean;
}

export interface BlastRadiusOptions {
  maxHitsPerSymbol?: number;
}

/** Match an absolute (or otherwise-rooted) path to a tree path by suffix. */
export function matchTreePath(path: string, treePaths: string[], treeSet: Set<string>): string | null {
  if (treeSet.has(path)) return path;
  const trimmed = path.replace(/^\.\//, '');
  if (treeSet.has(trimmed)) return trimmed;
  const matches = treePaths.filter((p) => path.endsWith(`/${p}`));
  return matches.length === 1 ? matches[0] : null;
}

/** Paths a trace implemented: verified code evidence plus its anchors' edited files. Exposed for tests. */
export async function ownPathsOf(trace: DecisionTrace, treePaths: string[]): Promise<{ tree: string[]; raw: string[] }> {
  const treeSet = new Set(treePaths);
  const tree = new Set<string>(trace.implEvidence.map((e) => e.path).filter((p) => treeSet.has(p)));
  const raw = new Set<string>(trace.implEvidence.map((e) => e.path));
  for (const key of trace.anchorStableKeys) {
    const anchor = await getInvestigationAnchor(key);
    if (!anchor) continue;
    for (const p of anchor.filePaths) {
      raw.add(p);
      const matched = matchTreePath(p, treePaths, treeSet);
      if (matched) tree.add(matched);
    }
  }
  return { tree: [...tree].sort(), raw: [...raw] };
}

export async function computeBlastRadius(
  trace: DecisionTrace,
  projectId: string,
  options: BlastRadiusOptions = {}
): Promise<BlastRadius> {
  const maxHits = options.maxHitsPerSymbol ?? DEFAULT_MAX_HITS_PER_SYMBOL;
  const rows: RepoFileRow[] = trace.repoKey && trace.sha ? await listRepoFiles(trace.repoKey, trace.sha) : [];
  const treePaths = rows.map((r) => r.path);
  const own = await ownPathsOf(trace, treePaths);
  const ownSet = new Set(own.tree);
  const foreignRows = rows.filter((r) => !ownSet.has(r.path));
  let truncated = false;

  // Symbols → references outside the decision's own files.
  const symbols: BlastRadiusSymbol[] = [];
  for (const name of trace.symbols.slice(0, MAX_SYMBOLS)) {
    const refs = findReferences(foreignRows, name, { maxHits, contextLines: 0 });
    const decls = findSymbol(rows, name, { maxHits: 20, contextLines: 0 });
    if (refs.capped) truncated = true;
    symbols.push({
      name,
      declaredIn: [...new Set(decls.hits.filter((h) => h.declaration).map((h) => h.path))].sort(),
      references: refs.hits,
      capped: refs.capped,
    });
  }
  if (trace.symbols.length > MAX_SYMBOLS) truncated = true;
  const referencingFiles = [...new Set(symbols.flatMap((s) => s.references.map((h) => h.path)))].sort();

  // Other sessions that edited the same files (anchor reverse index), by raw and tree path.
  const sourceConversations = new Set(trace.transcriptEvidence.map((s) => s.conversationId));
  const lookup = [...new Set([...own.raw, ...own.tree])];
  const anchors = lookup.length ? await db.investigationAnchors.where('filePaths').anyOf(lookup).toArray() : [];
  const bySession = new Map<string, { paths: Set<string>; anchorCount: number }>();
  for (const a of anchors) {
    if (sourceConversations.has(a.conversationId)) continue;
    const entry = bySession.get(a.conversationId) ?? { paths: new Set<string>(), anchorCount: 0 };
    entry.anchorCount++;
    for (const p of a.filePaths) if (lookup.includes(p)) entry.paths.add(p);
    bySession.set(a.conversationId, entry);
  }
  const sessionIds = [...bySession.keys()];
  const convs = sessionIds.length ? await db.conversations.where('id').anyOf(sessionIds).toArray() : [];
  const names = new Map(convs.map((c) => [c.id, c.name]));
  const relatedSessions = sessionIds
    .map((id) => ({ conversationId: id, name: names.get(id) ?? null, paths: [...bySession.get(id)!.paths].sort(), anchorCount: bySession.get(id)!.anchorCount }))
    .sort((a, b) => b.anchorCount - a.anchorCount);

  // Other decisions whose latest trace shares a path.
  const latest = await getLatestTraceByDecision(projectId);
  const relatedDecisions: BlastRadius['relatedDecisions'] = [];
  for (const [objectId, other] of latest) {
    if (objectId === trace.decisionObjectId) continue;
    const otherOwn = await ownPathsOf(other, treePaths);
    const shared = [...new Set([...otherOwn.tree, ...otherOwn.raw])].filter((p) => ownSet.has(p) || own.raw.includes(p));
    if (shared.length === 0) continue;
    const object = await db.understandingObjects.get(objectId);
    relatedDecisions.push({ objectId, title: object?.title ?? null, sharedPaths: shared.sort() });
  }

  // Tests: basename heuristic plus symbol mentions inside test files.
  const tests = new Set(matchTestPaths(own.tree, treePaths));
  const testRows = rows.filter((r) => /(\.test\.|\.spec\.|(^|\/)__tests__\/)/.test(r.path));
  for (const s of symbols) {
    const hits = grep(testRows, s.name, { maxHits: 50, contextLines: 0 });
    for (const h of hits.hits) tests.add(h.path);
  }

  return {
    paths: own.tree,
    symbols,
    referencingFiles,
    relatedSessions,
    relatedDecisions,
    tests: [...tests].sort(),
    verification: 'heuristic',
    truncated,
    snapshotMissing: rows.length === 0,
  };
}

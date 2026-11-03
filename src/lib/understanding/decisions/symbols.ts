// Symbols and tests (SPEC-decision-recovery §11.1). Deterministic regex over
// cited hunks — the same class of heuristic as `looksLikeDeclaration` in the
// repo search; never presented as verified.

import { basename } from '../../prepare/guided';

const DECLARATION_RE =
  /\b(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\*?|const|let|var|class|type|interface|enum|namespace)\s+([A-Za-z_$][\w$]*)/g;
const METHOD_RE = /^\s*(?:public|private|protected|static|async|\s)*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?::\s*[^{]+)?\{/gm;

const RESERVED = new Set([
  'function', 'const', 'let', 'var', 'class', 'type', 'interface', 'enum', 'namespace', 'export', 'default',
  'async', 'if', 'for', 'while', 'switch', 'return', 'catch', 'constructor',
]);

/** Identifiers declared in the given code texts, in first-seen order. */
export function extractDeclaredSymbols(texts: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (name: string) => {
    if (!name || RESERVED.has(name) || seen.has(name)) return;
    seen.add(name);
    out.push(name);
  };
  for (const text of texts) {
    for (const m of text.matchAll(DECLARATION_RE)) add(m[1]);
    for (const m of text.matchAll(METHOD_RE)) add(m[1]);
  }
  return out;
}

const TEST_PATH_RE = /(\.test\.|\.spec\.|(^|\/)__tests__\/)/;

/**
 * Test files that plausibly cover the given source paths: same basename with a
 * .test/.spec infix, or a file under __tests__ sharing the basename.
 */
export function matchTestPaths(sourcePaths: string[], treePaths: string[]): string[] {
  const bases = new Set(
    sourcePaths.filter((p) => !TEST_PATH_RE.test(p)).map((p) => basename(p).toLowerCase())
  );
  if (bases.size === 0) return [];
  const out: string[] = [];
  for (const path of treePaths) {
    if (!TEST_PATH_RE.test(path)) continue;
    const file = path.split('/').pop() ?? path;
    const base = file.replace(/\.(test|spec)\.[^.]+$/, '').replace(/\.[^.]+$/, '').toLowerCase();
    if (bases.has(base)) out.push(path);
  }
  return out.sort();
}

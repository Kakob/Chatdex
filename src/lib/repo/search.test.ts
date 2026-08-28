// SPEC-change-workspace §9 search + §16 CW-1 tests (audit S8, S4).
import { describe, expect, it } from 'vitest';
import {
  MAX_PATTERN_LENGTH,
  buildCodeEvidence,
  excerpt,
  findReferences,
  findSymbol,
  globToRegExp,
  grep,
  isSafePattern,
  looksLikeDeclaration,
} from './search';
import { MAX_QUOTE_CHARS } from '../../types/evidence';
import type { RepoFileRow } from '../../types/repo';

const sha = 'a'.repeat(40);
const row = (path: string, content: string): RepoFileRow => ({
  repoKey: 'gh:Kakob/Chatdex',
  sha,
  path,
  size: content.length,
  content,
  fetchedAt: new Date('2026-08-28T10:00:00Z'),
});

const fixture: RepoFileRow[] = [
  row(
    'src/pages/SearchPage.tsx',
    [
      "import { useNavigate } from 'react-router-dom';",
      '',
      'export function SearchPage() {',
      '  const navigate = useNavigate();',
      '  const handleResultClick = (id: string, messageId: string) => {',
      '    navigate(`/conversations/${id}?scrollTo=${messageId}`);',
      '  };',
      '  return <Results onClick={handleResultClick} />;',
      '}',
    ].join('\n')
  ),
  row(
    'src/pages/ConversationsPage.tsx',
    [
      'function scrollToMessage(messageId: string) {',
      "  document.getElementById(messageId)?.scrollIntoView({ block: 'center' });",
      '}',
      'export function ConversationsPage() {',
      "  const scrollTo = params.get('scrollTo');",
      '  useEffect(() => { if (scrollTo) scrollToMessage(scrollTo); }, [scrollTo]);',
      '}',
    ].join('\n')
  ),
  row('docs/notes.md', 'handleResultClick is documented here.\nToken: ghp_' + 'A'.repeat(30) + ' oops'),
];

describe('grep', () => {
  it('finds literal matches case-insensitively with context lines', () => {
    const result = grep(fixture, 'scrollto');
    expect(result.hits.map((h) => `${h.path}:${h.line}`)).toEqual([
      'src/pages/SearchPage.tsx:6',
      'src/pages/ConversationsPage.tsx:1',
      'src/pages/ConversationsPage.tsx:5',
      'src/pages/ConversationsPage.tsx:6',
    ]);
    expect(result.hits[0].before).toEqual([
      '  const navigate = useNavigate();',
      '  const handleResultClick = (id: string, messageId: string) => {',
    ]);
    expect(result.hits[0].after).toEqual(['  };', '  return <Results onClick={handleResultClick} />;']);
    expect(result.filesScanned).toBe(3);
  });

  it('respects case sensitivity, path globs, and the hit cap', () => {
    expect(grep(fixture, 'scrollto', { caseSensitive: true }).hits).toHaveLength(0);
    expect(grep(fixture, 'handleResultClick', { pathGlob: 'src/**/*.tsx' }).hits.every((h) => h.path.startsWith('src/'))).toBe(true);
    expect(grep(fixture, 'handleResultClick', { pathGlob: 'docs/*' }).hits.map((h) => h.path)).toEqual(['docs/notes.md']);
    const capped = grep(fixture, 'e', { maxHits: 2 });
    expect(capped.hits).toHaveLength(2);
    expect(capped.capped).toBe(true);
  });

  it('treats the query literally unless regex mode is on', () => {
    expect(grep(fixture, 'scrollTo=${messageId}').hits).toHaveLength(1);
    expect(grep(fixture, 'scroll(To|Into)', { regex: true }).hits.length).toBeGreaterThan(1);
  });

  it('rejects unsafe regex patterns (S8)', () => {
    expect(isSafePattern('(a+)+$')).toMatchObject({ ok: false });
    expect(isSafePattern('(\\w+\\s?)*x')).toMatchObject({ ok: false });
    expect(isSafePattern('(a|aa)+')).toMatchObject({ ok: false });
    expect(isSafePattern('a++')).toMatchObject({ ok: false });
    expect(isSafePattern('(x)\\1')).toMatchObject({ ok: false });
    expect(isSafePattern('a'.repeat(MAX_PATTERN_LENGTH + 1))).toMatchObject({ ok: false });
    expect(isSafePattern('[')).toMatchObject({ ok: false });
    expect(isSafePattern('scroll(To|Into)View')).toEqual({ ok: true });
    expect(isSafePattern('^\\s*export (function|const) \\w+')).toEqual({ ok: true });
    expect(() => grep(fixture, '(a+)+$', { regex: true })).toThrow(/Unsafe pattern/);
  });

  it('scans a 10 KB adversarial file within the time budget', () => {
    const big = row('big.txt', ('a'.repeat(100) + '\n').repeat(100));
    const started = performance.now();
    const result = grep([big], '^(a|aa)*b', { regex: false });
    expect(performance.now() - started).toBeLessThan(500);
    expect(result.hits).toHaveLength(0);
  });
});

describe('globToRegExp', () => {
  it('maps *, **, and ? as documented', () => {
    expect(globToRegExp('src/*.ts').test('src/a.ts')).toBe(true);
    expect(globToRegExp('src/*.ts').test('src/lib/a.ts')).toBe(false);
    expect(globToRegExp('src/**/*.ts').test('src/lib/deep/a.ts')).toBe(true);
    expect(globToRegExp('**/*.test.ts').test('a/b.test.ts')).toBe(true);
    expect(globToRegExp('a?.ts').test('ab.ts')).toBe(true);
    expect(globToRegExp('a?.ts').test('a/.ts')).toBe(false);
  });
});

describe('findSymbol / findReferences', () => {
  it('classifies declarations and lists them first', () => {
    const result = findSymbol(fixture, 'handleResultClick');
    expect(result.hits.map((h) => [h.path, h.line, Boolean(h.declaration)])).toEqual([
      ['src/pages/SearchPage.tsx', 5, true],
      ['src/pages/SearchPage.tsx', 8, false],
      ['docs/notes.md', 1, false],
    ]);
    const refs = findReferences(fixture, 'handleResultClick');
    expect(refs.hits.map((h) => h.line)).toEqual([8, 1]);
  });

  it('matches whole identifiers only', () => {
    expect(findSymbol(fixture, 'scrollTo').hits.map((h) => [h.path.split('/').pop(), h.line, Boolean(h.declaration)])).toEqual([
      ['ConversationsPage.tsx', 5, true],
      ['SearchPage.tsx', 6, false],
      ['ConversationsPage.tsx', 6, false],
    ]);
    expect(findSymbol(fixture, 'scrollToMessage').hits.map((h) => [h.line, Boolean(h.declaration)])).toEqual([
      [1, true],
      [6, false],
    ]);
    expect(() => findSymbol(fixture, 'not an ident')).toThrow(/identifier/);
  });

  it('recognises the declaration shapes the heuristic promises', () => {
    expect(looksLikeDeclaration('export function foo(a: number) {', 'foo')).toBe(true);
    expect(looksLikeDeclaration('const foo = async (x) => {', 'foo')).toBe(true);
    expect(looksLikeDeclaration('  foo: (x) => x,', 'foo')).toBe(true);
    expect(looksLikeDeclaration('export default foo;', 'foo')).toBe(true);
    expect(looksLikeDeclaration('  async foo(): Promise<void> {', 'foo')).toBe(true);
    expect(looksLikeDeclaration('interface foo {', 'foo')).toBe(true);
    expect(looksLikeDeclaration('  return foo(1);', 'foo')).toBe(false);
    expect(looksLikeDeclaration('import { foo } from "./x";', 'foo')).toBe(false);
  });
});

describe('excerpt / buildCodeEvidence', () => {
  it('clips ranges to the file and returns exact lines', () => {
    expect(excerpt(fixture[1], 0, 2)).toEqual({
      startLine: 1,
      endLine: 2,
      text: "function scrollToMessage(messageId: string) {\n  document.getElementById(messageId)?.scrollIntoView({ block: 'center' });",
    });
    expect(excerpt(fixture[1], 6, 99).endLine).toBe(7);
  });

  it('scrubs secrets, caps the quote, and hashes the stored text (S4)', async () => {
    const { item, redactions, truncated } = await buildCodeEvidence(fixture[2], 1, 2, { id: 'e1', addedVia: 'search' });
    expect(redactions).toBe(1);
    expect(truncated).toBe(false);
    expect(item.quote).not.toContain('ghp_');
    expect(item.quote).toContain('[REDACTED]');
    expect(item).toMatchObject({ kind: 'code', origin: 'user', path: 'docs/notes.md', startLine: 1, endLine: 2, sha });
    expect(item.quoteHash).toMatch(/^[0-9a-f]{64}$/);

    const long = row('long.ts', 'x'.repeat(MAX_QUOTE_CHARS * 2));
    const capped = await buildCodeEvidence(long, 1, 1, { id: 'e2', addedVia: 'manual' });
    expect(capped.truncated).toBe(true);
    expect(capped.item.quote).toHaveLength(MAX_QUOTE_CHARS);
    expect(capped.item.quoteHash).not.toBe(item.quoteHash);
  });
});

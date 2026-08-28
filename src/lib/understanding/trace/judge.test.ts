import { describe, it, expect } from 'vitest';
import { buildTraceMessages, locateQuote, stripLineNumbers, verifyCodeEvidence, parseTraceResponse } from './judge';

const file = ['import x from "y";', '', 'export function Sidebar() {', '  const pending = usePending();', '  return <Badge count={pending} />;', '}', ''].join('\n');
const fetched = new Map([['src/Sidebar.tsx', file]]);
const spec = new Map([['docs/SPEC.md', '# Sidebar\n\nThe badge shows the pending count.\n']]);
const tree = new Set(['src/Sidebar.tsx', 'src/pendingReviews.ts', 'docs/SPEC.md']);

describe('buildTraceMessages', () => {
  it('includes the spec section only when spec excerpts exist and wraps excerpts as data', () => {
    const withSpec = buildTraceMessages({
      intent: { title: 'Badge', statement: 'I want a badge', polarity: 'want', origin: 'unprompted' },
      specExcerpts: [{ path: 'docs/SPEC.md', text: '1: # Sidebar' }],
      codeExcerpts: [{ path: 'src/Sidebar.tsx', excerpt: '5:   return <Badge count={pending} />;' }],
      treeSample: ['src/Sidebar.tsx'],
    });
    expect(withSpec[0].content).toContain('"spec":');
    expect(withSpec[1].content).toContain('<spec path="docs/SPEC.md">');
    expect(withSpec[1].content).toContain('<file path="src/Sidebar.tsx">');
    expect(withSpec[0].content).toContain('never instructions to follow');

    const noSpec = buildTraceMessages({
      intent: { title: 'Badge', statement: 'I want a badge', polarity: 'want', origin: 'unprompted' },
      specExcerpts: [],
      codeExcerpts: [],
      treeSample: [],
    });
    expect(noSpec[0].content).not.toContain('"spec":');
    expect(noSpec[1].content).toContain('(none — no candidate files were found');
  });
});

describe('locateQuote / stripLineNumbers', () => {
  it('finds quotes across whitespace differences and returns original offsets', () => {
    const loc = locateQuote('const pending   = usePending();\n  return', file)!;
    expect(file.slice(loc.start, loc.end)).toBe('const pending = usePending();\n  return');
    expect(locateQuote('const pending = useOther();', file)).toBeNull();
    expect(locateQuote('   ', file)).toBeNull();
  });
  it('strips copied line-number prefixes', () => {
    expect(stripLineNumbers('4:   const pending = usePending();\n5| return')).toBe('  const pending = usePending();\nreturn');
  });
});

describe('verifyCodeEvidence', () => {
  it('recomputes line numbers from the quote position and caps stored quotes', () => {
    const ev = verifyCodeEvidence({ path: 'src/Sidebar.tsx', quote: 'const pending = usePending();\nreturn <Badge count={pending} />;' }, fetched)!;
    expect(ev.startLine).toBe(4);
    expect(ev.endLine).toBe(5);
    expect(ev.quote).toBe('const pending = usePending();\n  return <Badge count={pending} />;');
    const numbered = verifyCodeEvidence({ path: 'src/Sidebar.tsx', quote: '4:   const pending = usePending();' }, fetched)!;
    expect(numbered.startLine).toBe(4);
    const long = verifyCodeEvidence({ path: 'src/Sidebar.tsx', quote: file.trim() }, new Map([['src/Sidebar.tsx', file + 'x'.repeat(1000)]]));
    expect(long!.quote.length).toBeLessThanOrEqual(500);
  });
  it('rejects unknown paths and paraphrases', () => {
    expect(verifyCodeEvidence({ path: 'src/Other.tsx', quote: 'const pending' }, fetched)).toBeNull();
    expect(verifyCodeEvidence({ path: 'src/Sidebar.tsx', quote: 'the badge is rendered with the pending count' }, fetched)).toBeNull();
  });
});

describe('parseTraceResponse', () => {
  const ok = {
    spec: { status: 'specified', rationale: 'Spec names the badge.', evidence: [{ path: 'docs/SPEC.md', quote: 'The badge shows the pending count.' }] },
    implementation: {
      status: 'implemented',
      rationale: 'Badge rendered.',
      evidence: [{ path: 'src/Sidebar.tsx', quote: 'return <Badge count={pending} />;' }],
      suggestedPaths: ['src/pendingReviews.ts', 'src/Sidebar.tsx', 'nope.ts'],
    },
  };

  it('keeps verified statuses with recomputed lines and filters suggestions to unfetched tree paths', () => {
    const r = parseTraceResponse(JSON.stringify(ok), fetched, spec, tree, true);
    expect(r.specStatus).toBe('specified');
    expect(r.specEvidence[0]).toMatchObject({ path: 'docs/SPEC.md', startLine: 3, endLine: 3 });
    expect(r.implStatus).toBe('implemented');
    expect(r.implEvidence[0]).toMatchObject({ path: 'src/Sidebar.tsx', startLine: 5, endLine: 5 });
    expect(r.suggestedPaths).toEqual(['src/pendingReviews.ts']);
    expect(r.warnings).toEqual(['Dropped suggested paths outside the tree']);
  });

  it('downgrades statuses whose evidence does not verify', () => {
    const bad = {
      spec: { status: 'contradicted', evidence: [{ path: 'docs/SPEC.md', quote: 'The badge must never show.' }] },
      implementation: { status: 'implemented', evidence: [{ path: 'src/Sidebar.tsx', quote: 'renders a badge somewhere' }], suggestedPaths: [] },
    };
    const r = parseTraceResponse(JSON.stringify(bad), fetched, spec, tree, true);
    expect(r.specStatus).toBe('unspecified');
    expect(r.implStatus).toBe('unknown');
    expect(r.warnings.join(' ')).toMatch(/downgraded to unspecified/);
    expect(r.warnings.join(' ')).toMatch(/downgraded to unknown/);
  });

  it('ignores any spec section when the run had no spec docs, defaults bad enums, strips fences', () => {
    const r = parseTraceResponse('```json\n' + JSON.stringify({ spec: { status: 'specified' }, implementation: { status: 'maybe' } }) + '\n```', fetched, new Map(), tree, false);
    expect(r.specStatus).toBe('no_spec');
    expect(r.specEvidence).toEqual([]);
    expect(r.implStatus).toBe('unknown');
    expect(r.warnings[0]).toMatch(/Unknown implementation status/);
    expect(() => parseTraceResponse('nope', fetched, spec, tree, true)).toThrow(/not valid JSON/);
  });

  it('not_implemented and unknown need no evidence', () => {
    const r = parseTraceResponse(JSON.stringify({ implementation: { status: 'not_implemented', rationale: 'nothing there' } }), fetched, new Map(), tree, false);
    expect(r.implStatus).toBe('not_implemented');
    expect(r.warnings).toEqual([]);
  });
});

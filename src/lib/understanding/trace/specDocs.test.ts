import { describe, it, expect } from 'vitest';
import { globToRegExp, findSpecPaths, tokenize, retrieveSpecExcerpts } from './specDocs';

describe('globToRegExp / findSpecPaths', () => {
  it('matches the default spec patterns and nothing else', () => {
    const tree = [
      'docs/SPEC-intent-trace.md', 'docs/a/b/notes.md', 'SPEC-x.md', 'PRD-y.md', 'README.md', 'CLAUDE.md',
      'src/README.md', 'docs/image.png', 'spec.md', 'src/lib/a.ts', 'backend/CLAUDE.md',
    ];
    expect(findSpecPaths(tree)).toEqual([
      'CLAUDE.md', 'PRD-y.md', 'README.md', 'SPEC-x.md', 'docs/SPEC-intent-trace.md', 'docs/a/b/notes.md',
    ]);
    expect(findSpecPaths(tree, ['**/README.md'])).toEqual(['README.md', 'src/README.md']);
    expect(globToRegExp('src/*.ts').test('src/a/b.ts')).toBe(false);
    expect(globToRegExp('src/**/*.ts').test('src/a/b.ts')).toBe(true);
    expect(globToRegExp('a?c.md').test('abc.md')).toBe(true);
    expect(globToRegExp('a.md').test('aXmd')).toBe(false);
  });
});

describe('tokenize', () => {
  it('splits camelCase, drops short tokens and stopwords, dedupes', () => {
    expect(tokenize('I want the pendingReviews badge on the sidebar, sidebar!')).toEqual([
      'pending', 'reviews', 'badge', 'sidebar',
    ]);
  });
});

describe('retrieveSpecExcerpts', () => {
  const doc = {
    path: 'docs/SPEC.md',
    text: [
      '# Sidebar',
      'Intro line.',
      '',
      '## Badge',
      'The pending-review badge lives in the sidebar and shows a count.',
      'It is amber.',
      '',
      '## Unrelated',
      ...Array.from({ length: 30 }, (_, i) => `filler line ${i}`),
      '## Footer',
      'Nothing about badges here except the word badge once.',
    ].join('\n'),
  };

  it('returns numbered windows around the best-scoring lines, headings weighted', () => {
    const excerpts = retrieveSpecExcerpts({ title: 'Sidebar badge', statement: 'I want the badge amber' }, [doc], { windowLines: 4 });
    expect(excerpts.length).toBeGreaterThan(0);
    const top = excerpts[0];
    expect(top.path).toBe('docs/SPEC.md');
    expect(top.text).toContain('4: ## Badge');
    expect(top.startLine).toBeLessThanOrEqual(4);
    expect(top.endLine).toBeGreaterThanOrEqual(4);
    // Windows never overlap; the badge paragraph shows up in a later excerpt.
    expect(excerpts.some((e) => e.text.includes('pending-review badge lives in the sidebar'))).toBe(true);
  });

  it('respects maxChars and maxExcerpts and returns nothing for keyword-less intents', () => {
    expect(retrieveSpecExcerpts({ title: 'it', statement: 'do it' }, [doc])).toEqual([]);
    const capped = retrieveSpecExcerpts({ title: 'Sidebar badge', statement: 'amber' }, [doc], { maxChars: 40, windowLines: 2 });
    expect(capped.every((e) => e.text.length <= 40)).toBe(true);
    const limited = retrieveSpecExcerpts({ title: 'Sidebar badge', statement: 'amber' }, [doc], { maxExcerpts: 1, windowLines: 2 });
    expect(limited).toHaveLength(1);
  });
});

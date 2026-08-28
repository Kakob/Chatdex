import { describe, it, expect } from 'vitest';
import {
  extractMentionedPaths,
  toRepoRelative,
  rankTreePathsByKeywords,
  selectCandidateFiles,
  excerptFile,
} from './candidateFiles';

const tree = [
  'src/components/layout/Sidebar.tsx',
  'src/lib/understanding/pendingReviews.ts',
  'src/lib/understanding/pendingReviews.test.ts',
  'src/pages/SettingsPage.tsx',
  'backend/.env',
  'node_modules/react/index.js',
  'package-lock.json',
  'docs/SPEC.md',
  'src/lib/db/schema.ts',
  'public/logo.png',
];

describe('extractMentionedPaths', () => {
  it('finds slash paths and bare code filenames, strips ./ and punctuation', () => {
    const texts = [
      'Edit ./src/components/layout/Sidebar.tsx, then `src/lib/db/schema.ts`.',
      'The Settings page is in SettingsPage.tsx (see docs/SPEC.md).',
      'not a path: 3.14 or v1.2.3 or e.g.',
    ];
    expect(extractMentionedPaths(texts).sort()).toEqual([
      'SettingsPage.tsx', 'docs/SPEC.md', 'src/components/layout/Sidebar.tsx', 'src/lib/db/schema.ts',
    ]);
  });
});

describe('toRepoRelative', () => {
  it('strips a matching root and passes relative paths through', () => {
    expect(toRepoRelative('/Users/x/proj/src/a.ts', ['/Users/x/proj', '/other'])).toBe('src/a.ts');
    expect(toRepoRelative('/Users/x/proj/src/a.ts', ['/Users/x/proj/'])).toBe('src/a.ts');
    expect(toRepoRelative('src/a.ts', ['/Users/x/proj'])).toBe('src/a.ts');
    expect(toRepoRelative('./src/a.ts', [])).toBe('src/a.ts');
    expect(toRepoRelative('/elsewhere/src/a.ts', ['/Users/x/proj'])).toBeNull();
  });
});

describe('rankTreePathsByKeywords', () => {
  it('scores path tokens against intent tokens, shorter paths first on ties', () => {
    const ranked = rankTreePathsByKeywords({ title: 'Pending reviews badge', statement: 'show pending reviews in the sidebar' }, tree, 3);
    expect(ranked[0]).toBe('src/lib/understanding/pendingReviews.ts');
    expect(ranked).toContain('src/components/layout/Sidebar.tsx');
  });
});

describe('selectCandidateFiles', () => {
  const intent = { title: 'Pending reviews badge', statement: 'I want the pending reviews badge in the sidebar' };

  it('orders mentioned > anchor > keyword, resolves bare names via unique suffix, dedupes, and caps', () => {
    const { candidates } = selectCandidateFiles(intent, {
      conversationTexts: ['Look at SettingsPage.tsx'],
      anchorPaths: ['src/lib/db/schema.ts'],
      treePaths: tree,
      maxFiles: 4,
    });
    expect(candidates.map((c) => `${c.reason}:${c.path}`)).toEqual([
      'mentioned:src/pages/SettingsPage.tsx',
      'anchor:src/lib/db/schema.ts',
      'keyword:src/lib/understanding/pendingReviews.ts',
      'keyword:src/components/layout/Sidebar.tsx',
    ]);
  });

  it('applies the fetch gate to every channel and reports skips', () => {
    const { candidates, skipped } = selectCandidateFiles(intent, {
      conversationTexts: ['see backend/.env and package-lock.json and node_modules/react/index.js'],
      anchorPaths: ['public/logo.png'],
      treePaths: tree,
      extraPaths: [{ path: 'backend/.env', reason: 'manual' }],
      keywordDisabled: true,
    });
    expect(candidates).toEqual([]);
    expect(skipped).toEqual(
      expect.arrayContaining([
        { path: 'backend/.env', reason: 'sensitive' },
        { path: 'package-lock.json', reason: 'excluded' },
        { path: 'node_modules/react/index.js', reason: 'excluded' },
        { path: 'public/logo.png', reason: 'excluded' },
      ])
    );
  });

  it('puts extra (suggested/manual) paths first and honours keywordDisabled', () => {
    const { candidates } = selectCandidateFiles(intent, {
      conversationTexts: [],
      anchorPaths: [],
      treePaths: tree,
      extraPaths: [{ path: 'docs/SPEC.md', reason: 'suggested' }],
      keywordDisabled: true,
    });
    expect(candidates).toEqual([{ path: 'docs/SPEC.md', reason: 'suggested' }]);
  });
});

describe('excerptFile', () => {
  const text = Array.from({ length: 100 }, (_, i) => (i === 50 ? 'const badge = pending;' : `line ${i + 1}`)).join('\n');

  it('centres numbered windows on keyword hits with correct line numbers', () => {
    const { excerpt, ranges } = excerptFile(text, ['badge'], { windowLines: 5 });
    expect(ranges).toEqual([[49, 53]]);
    expect(excerpt).toContain('51: const badge = pending;');
    expect(excerpt.startsWith('49: line 49')).toBe(true);
  });

  it('falls back to the head when nothing matches and merges overlapping windows', () => {
    const head = excerptFile(text, ['zzz'], { windowLines: 3 });
    expect(head.ranges).toEqual([[1, 3]]);
    const two = excerptFile('a\nbadge\nb\nbadge\nc', ['badge'], { windowLines: 3 });
    expect(two.ranges).toEqual([[1, 5]]);
  });

  it('caps characters', () => {
    const { excerpt } = excerptFile(text, ['line'], { windowLines: 100, maxChars: 300 });
    expect(excerpt.length).toBeLessThanOrEqual(300);
  });
});

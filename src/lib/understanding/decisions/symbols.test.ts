import { describe, it, expect } from 'vitest';
import { extractDeclaredSymbols, matchTestPaths } from './symbols';

describe('extractDeclaredSymbols (§11.1)', () => {
  it('finds declarations and methods, once each, skipping keywords', () => {
    const text = [
      'export async function deleteProject(id: string) {',
      '  const cascade = true;',
      '  return cascade;',
      '}',
      'export type DeleteOutcome = "ok";',
      'class ProjectStore {',
      '  async remove(id: string): Promise<void> {',
      '  }',
      '  if (x) {',
      '}',
      'function deleteProject() {}',
    ].join('\n');
    expect(extractDeclaredSymbols([text])).toEqual(['deleteProject', 'cascade', 'DeleteOutcome', 'ProjectStore', 'remove']);
  });

  it('returns nothing for prose', () => {
    expect(extractDeclaredSymbols(['I will mirror the cascade.'])).toEqual([]);
  });
});

describe('matchTestPaths', () => {
  const tree = [
    'src/lib/db/projects.ts',
    'src/lib/db/projects.test.ts',
    'src/lib/db/conversations.spec.tsx',
    'src/lib/__tests__/projects.ts',
    'src/lib/db/other.test.ts',
  ];
  it('matches by basename with .test/.spec infix or under __tests__', () => {
    expect(matchTestPaths(['src/lib/db/projects.ts', 'x/conversations.ts'], tree)).toEqual([
      'src/lib/__tests__/projects.ts',
      'src/lib/db/conversations.spec.tsx',
      'src/lib/db/projects.test.ts',
    ]);
    expect(matchTestPaths(['src/lib/db/projects.test.ts'], tree)).toEqual([]);
    expect(matchTestPaths([], tree)).toEqual([]);
  });
});

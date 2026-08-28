import { describe, it, expect, beforeEach } from 'vitest';
import { clearAllData } from '../db';
import { getMetadata } from '../db/metadata';
import { getGitHubToken, setGitHubToken, clearGitHubToken, hasGitHubToken, GITHUB_TOKEN_KEY } from './credentials';

beforeEach(async () => {
  await clearAllData();
});

describe('GitHub token storage', () => {
  it('round-trips through metadata under the github. prefix', async () => {
    expect(await hasGitHubToken()).toBe(false);
    await setGitHubToken('  github_pat_abc  ');
    expect(await getGitHubToken()).toBe('github_pat_abc');
    expect(await getMetadata(GITHUB_TOKEN_KEY)).toBe('github_pat_abc');
    expect(GITHUB_TOKEN_KEY.startsWith('github.')).toBe(true);
    await clearGitHubToken();
    expect(await getGitHubToken()).toBeUndefined();
  });
  it('rejects empty tokens', async () => {
    await expect(setGitHubToken('   ')).rejects.toThrow(/must not be empty/);
  });
});

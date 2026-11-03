// GitHub token storage (SPEC-intent-trace §8.1). Lives in the Dexie metadata
// table like LLM keys, but is DEVICE-LOCAL: the sync engine excludes every
// `github.` key from the sync stream (audit S1) — a PAT is a per-machine
// credential, and keeping it out of sync removes a replication path for a
// repository-read credential at no real UX cost. The token is sent only to
// api.github.com, in an Authorization header, never to the relay.

import { getMetadata, setMetadata, deleteMetadata } from '../db/metadata';

/** Prefix the sync engine treats as device-local. */
export const GITHUB_METADATA_PREFIX = 'github.';
export const GITHUB_TOKEN_KEY = `${GITHUB_METADATA_PREFIX}token`;

export async function getGitHubToken(): Promise<string | undefined> {
  return getMetadata<string>(GITHUB_TOKEN_KEY);
}

export async function setGitHubToken(token: string): Promise<void> {
  const trimmed = token.trim();
  if (!trimmed) throw new Error('GitHub token must not be empty');
  await setMetadata(GITHUB_TOKEN_KEY, trimmed);
}

export async function clearGitHubToken(): Promise<void> {
  await deleteMetadata(GITHUB_TOKEN_KEY);
}

export async function hasGitHubToken(): Promise<boolean> {
  return Boolean(await getGitHubToken());
}

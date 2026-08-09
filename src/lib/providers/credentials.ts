// API-key storage for LLM providers. Keys live in the Dexie metadata table:
// plaintext locally (same trust level as conversation content), ciphertext in
// sync (the whole metadata table syncs encrypted), so a configured provider
// follows the user across devices.

import { getMetadata, setMetadata } from '../db/metadata';
import { db } from '../db/schema';
import { ALL_PROVIDERS } from './registry';
import type { AuthMode, LLMProviderId } from './types';

function credentialKey(provider: LLMProviderId): string {
  return `llm.apiKey.${provider}`;
}

function authModeKey(provider: LLMProviderId): string {
  return `llm.authMode.${provider}`;
}

export async function getProviderAuthMode(provider: LLMProviderId): Promise<AuthMode> {
  return (await getMetadata<AuthMode>(authModeKey(provider))) ?? 'api-key';
}

export async function setProviderAuthMode(
  provider: LLMProviderId,
  mode: AuthMode
): Promise<void> {
  await setMetadata(authModeKey(provider), mode);
}

export async function setProviderKey(provider: LLMProviderId, apiKey: string): Promise<void> {
  const trimmed = apiKey.trim();
  if (!trimmed) throw new Error('API key must not be empty');
  await setMetadata(credentialKey(provider), trimmed);
}

export async function getProviderKey(provider: LLMProviderId): Promise<string | undefined> {
  return getMetadata<string>(credentialKey(provider));
}

export async function clearProviderKey(provider: LLMProviderId): Promise<void> {
  await db.metadata.delete(credentialKey(provider));
}

export async function listConfiguredProviders(): Promise<LLMProviderId[]> {
  const configured: LLMProviderId[] = [];
  for (const id of ALL_PROVIDERS) {
    if (await getProviderKey(id)) configured.push(id);
  }
  return configured;
}

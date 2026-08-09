// Client for the backend LLM relay (/api/llm/complete). The relay is
// transit-only — it forwards to the provider with the user's key and never
// persists or logs content (CLAUDE.md invariant 6).

import { getAuthToken } from '../auth/session';
import { getProviderKey } from './credentials';
import { getProviderInfo } from './registry';
import type { LLMProviderId, CompletionRequest, CompletionResponse } from './types';

const BACKEND_URL =
  import.meta.env.VITE_API_URL?.replace(/\/api$/, '') || 'http://localhost:3003';

export async function complete(
  provider: LLMProviderId,
  request: CompletionRequest
): Promise<CompletionResponse> {
  const apiKey = await getProviderKey(provider);
  if (!apiKey) {
    throw new Error(`No API key configured for provider "${provider}"`);
  }

  const headers = new Headers({ 'Content-Type': 'application/json' });
  const token = getAuthToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const res = await fetch(`${BACKEND_URL}/api/llm/complete`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      provider,
      apiKey,
      model: request.model ?? getProviderInfo(provider).defaultModel,
      messages: request.messages,
      maxTokens: request.maxTokens,
      temperature: request.temperature,
    }),
  });

  if (!res.ok) {
    let detail = '';
    try {
      const body = (await res.json()) as { error?: string; providerStatus?: number };
      detail = body.error
        ? ` — ${body.error}${body.providerStatus ? ` (provider ${body.providerStatus})` : ''}`
        : '';
    } catch {
      // Non-JSON error body; status alone is enough.
    }
    throw new Error(`LLM relay failed: ${res.status}${detail}`);
  }

  return (await res.json()) as CompletionResponse;
}

// Client for the backend LLM relay (/api/llm/complete). The relay is
// transit-only — it forwards to the provider with the user's key or, in
// subscription mode, bridges through local CLI login state; it never persists
// or logs content (CLAUDE.md invariant 6).

import { getAuthToken } from '../auth/session';
import { getProviderAuthMode, getProviderKey } from './credentials';
import { ALL_PROVIDERS, getProviderInfo } from './registry';
import type {
  LLMProviderId,
  CompletionRequest,
  CompletionResponse,
  SubscriptionStatus,
} from './types';

const BACKEND_URL =
  import.meta.env.VITE_API_URL?.replace(/\/api$/, '') || 'http://localhost:3003';

function authHeaders(): Headers {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  const token = getAuthToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return headers;
}

export async function complete(
  provider: LLMProviderId,
  request: CompletionRequest
): Promise<CompletionResponse> {
  const authMode = await getProviderAuthMode(provider);

  let apiKey: string | undefined;
  let model: string | undefined;
  if (authMode === 'api-key') {
    apiKey = await getProviderKey(provider);
    if (!apiKey) {
      throw new Error(`No API key configured for provider "${provider}"`);
    }
    model = request.model ?? getProviderInfo(provider).defaultModel;
  } else {
    // Subscription mode: omit the model unless explicitly requested so the
    // local CLI's own default applies (Codex model names are not knowable
    // here without a login to verify against).
    model = request.model;
  }

  const res = await fetch(`${BACKEND_URL}/api/llm/complete`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      provider,
      authMode,
      ...(apiKey ? { apiKey } : {}),
      ...(model ? { model } : {}),
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

/** Whether local CLI login state exists for each provider's subscription. */
export async function fetchSubscriptionStatus(): Promise<SubscriptionStatus> {
  const res = await fetch(`${BACKEND_URL}/api/llm/subscription/status`, {
    headers: authHeaders(),
  });
  if (!res.ok) {
    throw new Error(`Subscription status check failed: ${res.status}`);
  }
  return (await res.json()) as SubscriptionStatus;
}

/**
 * Providers usable right now, matching what complete() will do: api-key mode
 * needs a stored key; subscription mode needs a detected CLI login. Backend
 * unreachable ⇒ subscription-mode providers are simply not ready.
 */
export async function listReadyProviders(): Promise<LLMProviderId[]> {
  let status: SubscriptionStatus | undefined;
  const ready: LLMProviderId[] = [];
  for (const id of ALL_PROVIDERS) {
    if ((await getProviderAuthMode(id)) === 'api-key') {
      if (await getProviderKey(id)) ready.push(id);
      continue;
    }
    if (status === undefined) {
      try {
        status = await fetchSubscriptionStatus();
      } catch {
        status = { anthropic: false, openai: false };
      }
    }
    if (status[id]) ready.push(id);
  }
  return ready;
}

// User-authenticated LLM provider layer (CLAUDE.md invariant 6).
// Synthesis calls are user-initiated, use the user's own API keys, and are
// relayed through the Chatdex backend transit-only (/api/llm). Detection never
// touches this layer.

export type LLMProviderId = 'anthropic' | 'openai';

/**
 * How a provider is billed: 'api-key' relays with the user's own key;
 * 'subscription' bridges through local CLI login state (Claude Code /
 * `codex login`) and bills the user's consumer subscription.
 */
export type AuthMode = 'api-key' | 'subscription';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CompletionRequest {
  /** Defaults to the provider's defaultModel when omitted. */
  model?: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
}

export interface CompletionUsage {
  inputTokens?: number;
  outputTokens?: number;
}

export interface CompletionResponse {
  text: string;
  model: string;
  usage?: CompletionUsage;
}

export interface ProviderInfo {
  id: LLMProviderId;
  label: string;
  defaultModel: string;
  /** Hint shown in the credential input, e.g. "sk-ant-…". */
  keyPlaceholder: string;
  /** How to get subscription auth working, shown in settings. */
  subscriptionHint: string;
}

export interface SubscriptionStatus {
  anthropic: boolean;
  openai: boolean;
}

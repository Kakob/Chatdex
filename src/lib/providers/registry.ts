import type { LLMProviderId, ProviderInfo } from './types';

export const PROVIDERS: Record<LLMProviderId, ProviderInfo> = {
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    defaultModel: 'claude-sonnet-4-6',
    keyPlaceholder: 'sk-ant-…',
  },
  openai: {
    id: 'openai',
    label: 'OpenAI (ChatGPT)',
    defaultModel: 'gpt-4o',
    keyPlaceholder: 'sk-…',
  },
};

export const ALL_PROVIDERS: LLMProviderId[] = ['anthropic', 'openai'];

export function getProviderInfo(id: LLMProviderId): ProviderInfo {
  return PROVIDERS[id];
}

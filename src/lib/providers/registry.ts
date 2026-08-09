import type { LLMProviderId, ProviderInfo } from './types';

export const PROVIDERS: Record<LLMProviderId, ProviderInfo> = {
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    defaultModel: 'claude-sonnet-4-6',
    keyPlaceholder: 'sk-ant-…',
    subscriptionHint:
      'Bills your Claude Pro/Max plan via your Claude Code login (shares its usage limits). Not logged in? Run `claude login` in a terminal.',
  },
  openai: {
    id: 'openai',
    label: 'OpenAI (ChatGPT)',
    defaultModel: 'gpt-4o',
    keyPlaceholder: 'sk-…',
    subscriptionHint:
      'Bills your ChatGPT Plus/Pro plan via the Codex CLI login. Not logged in? Install the Codex CLI (`npm i -g @openai/codex`) and run `codex login`.',
  },
};

export const ALL_PROVIDERS: LLMProviderId[] = ['anthropic', 'openai'];

export function getProviderInfo(id: LLMProviderId): ProviderInfo {
  return PROVIDERS[id];
}

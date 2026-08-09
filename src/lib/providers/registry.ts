import type { LLMProviderId, ProviderInfo } from './types';

export const PROVIDERS: Record<LLMProviderId, ProviderInfo> = {
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    defaultModel: 'claude-opus-5',
    chatModels: [
      { id: 'claude-opus-5', label: 'Claude Opus 5' },
      { id: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
      { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
    ],
    keyPlaceholder: 'sk-ant-…',
    subscriptionHint:
      'Bills your Claude Pro/Max plan via your Claude Code login (shares its usage limits). Not logged in? Run `claude login` in a terminal.',
  },
  openai: {
    id: 'openai',
    label: 'OpenAI (ChatGPT)',
    defaultModel: 'gpt-4o',
    chatModels: [{ id: 'gpt-4o', label: 'GPT-4o' }],
    keyPlaceholder: 'sk-…',
    subscriptionHint:
      'Bills your ChatGPT Plus/Pro plan via the Codex CLI login. Not logged in? Install the Codex CLI (`npm i -g @openai/codex`) and run `codex login`.',
  },
};

export const ALL_PROVIDERS: LLMProviderId[] = ['anthropic', 'openai'];

export function getProviderInfo(id: LLMProviderId): ProviderInfo {
  return PROVIDERS[id];
}

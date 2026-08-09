import { useEffect, useState } from 'react';
import { BrainCircuit, CheckCircle, CircleAlert, Loader2, Trash2 } from 'lucide-react';
import {
  ALL_PROVIDERS,
  getProviderInfo,
  setProviderKey,
  clearProviderKey,
  listConfiguredProviders,
  getProviderAuthMode,
  setProviderAuthMode,
  fetchSubscriptionStatus,
  type AuthMode,
  type LLMProviderId,
  type SubscriptionStatus,
} from '../../lib/providers';
import { useToastStore } from '../../stores/toastStore';

export function LLMProvidersSection() {
  const addToast = useToastStore((s) => s.addToast);
  const [configured, setConfigured] = useState<LLMProviderId[]>([]);
  const [authModes, setAuthModes] = useState<Record<LLMProviderId, AuthMode>>({
    anthropic: 'api-key',
    openai: 'api-key',
  });
  const [subscription, setSubscription] = useState<SubscriptionStatus | 'loading' | 'error'>(
    'loading'
  );
  const [inputs, setInputs] = useState<Record<string, string>>({});

  const refresh = () =>
    Promise.all([
      listConfiguredProviders(),
      getProviderAuthMode('anthropic'),
      getProviderAuthMode('openai'),
    ]).then(([keys, anthropic, openai]) => {
      setConfigured(keys);
      setAuthModes({ anthropic, openai });
    });

  useEffect(() => {
    void refresh();
    fetchSubscriptionStatus().then(setSubscription, () => setSubscription('error'));
  }, []);

  const handleModeChange = async (provider: LLMProviderId, mode: AuthMode) => {
    await setProviderAuthMode(provider, mode);
    setAuthModes((prev) => ({ ...prev, [provider]: mode }));
  };

  const handleSave = async (provider: LLMProviderId) => {
    const key = (inputs[provider] ?? '').trim();
    if (!key) return;
    await setProviderKey(provider, key);
    setInputs((prev) => ({ ...prev, [provider]: '' }));
    await refresh();
    addToast(`${getProviderInfo(provider).label} API key saved`);
  };

  const handleClear = async (provider: LLMProviderId) => {
    if (!confirm(`Remove the ${getProviderInfo(provider).label} API key?`)) return;
    await clearProviderKey(provider);
    await refresh();
    addToast(`${getProviderInfo(provider).label} API key removed`);
  };

  return (
    <section className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6">
      <div className="flex items-center gap-3 mb-1">
        <BrainCircuit size={20} className="text-violet-600 dark:text-violet-400" />
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">LLM providers</h2>
      </div>
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
        Used for project discovery and understanding synthesis. Pay with your own API key, or
        bill your existing Claude / ChatGPT subscription through its local CLI login. Requests go
        through Chatdex&apos;s transit-only relay — nothing is logged or stored server-side.
      </p>

      <div className="space-y-4">
        {ALL_PROVIDERS.map((provider) => {
          const info = getProviderInfo(provider);
          const isConfigured = configured.includes(provider);
          const mode = authModes[provider];
          const loggedIn = typeof subscription === 'object' ? subscription[provider] : undefined;
          return (
            <div key={provider} className="p-3 rounded-lg bg-gray-50 dark:bg-gray-800 space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex-1 min-w-32 text-sm font-medium text-gray-900 dark:text-gray-100">
                  {info.label}
                </div>
                <div className="flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden text-xs">
                  {(['api-key', 'subscription'] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => void handleModeChange(provider, m)}
                      className={`px-3 py-1.5 transition-colors ${
                        mode === m
                          ? 'bg-violet-600 text-white'
                          : 'bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                      }`}
                    >
                      {m === 'api-key' ? 'API key' : 'Subscription'}
                    </button>
                  ))}
                </div>
              </div>

              {mode === 'api-key' ? (
                <div className="flex flex-wrap items-center gap-3">
                  <div className="min-w-32 text-xs text-gray-500 dark:text-gray-400">
                    {isConfigured ? (
                      <span className="inline-flex items-center gap-1 text-green-600 dark:text-green-400">
                        <CheckCircle size={12} /> configured
                      </span>
                    ) : (
                      <>default model: {info.defaultModel}</>
                    )}
                  </div>
                  <input
                    type="password"
                    value={inputs[provider] ?? ''}
                    onChange={(e) =>
                      setInputs((prev) => ({ ...prev, [provider]: e.target.value }))
                    }
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void handleSave(provider);
                    }}
                    placeholder={isConfigured ? 'Replace API key...' : 'API key...'}
                    className="flex-1 min-w-48 px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
                  />
                  <button
                    onClick={() => void handleSave(provider)}
                    disabled={!(inputs[provider] ?? '').trim()}
                    className="px-3 py-1.5 text-xs bg-violet-600 hover:bg-violet-700 text-white rounded-lg transition-colors disabled:opacity-50"
                  >
                    Save
                  </button>
                  {isConfigured && (
                    <button
                      onClick={() => void handleClear(provider)}
                      title="Remove key"
                      className="p-1.5 text-gray-400 hover:text-red-500 transition-colors"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              ) : (
                <div className="space-y-1.5">
                  <div className="text-xs">
                    {subscription === 'loading' ? (
                      <span className="inline-flex items-center gap-1 text-gray-500 dark:text-gray-400">
                        <Loader2 size={12} className="animate-spin" /> checking login...
                      </span>
                    ) : subscription === 'error' ? (
                      <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
                        <CircleAlert size={12} /> backend unreachable — status unknown
                      </span>
                    ) : loggedIn ? (
                      <span className="inline-flex items-center gap-1 text-green-600 dark:text-green-400">
                        <CheckCircle size={12} /> logged in
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
                        <CircleAlert size={12} /> no login detected
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {info.subscriptionHint}
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

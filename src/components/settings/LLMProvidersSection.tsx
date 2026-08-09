import { useEffect, useState } from 'react';
import { BrainCircuit, CheckCircle, Trash2 } from 'lucide-react';
import {
  ALL_PROVIDERS,
  getProviderInfo,
  setProviderKey,
  clearProviderKey,
  listConfiguredProviders,
  type LLMProviderId,
} from '../../lib/providers';
import { useToastStore } from '../../stores/toastStore';

export function LLMProvidersSection() {
  const addToast = useToastStore((s) => s.addToast);
  const [configured, setConfigured] = useState<LLMProviderId[]>([]);
  const [inputs, setInputs] = useState<Record<string, string>>({});

  const refresh = async () => {
    setConfigured(await listConfiguredProviders());
  };

  useEffect(() => {
    void listConfiguredProviders().then(setConfigured);
  }, []);

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
        Used for project discovery and understanding synthesis. Keys are stored locally in your
        browser and sent only to the provider through Chatdex&apos;s transit-only relay — nothing
        is logged or stored server-side.
      </p>

      <div className="space-y-4">
        {ALL_PROVIDERS.map((provider) => {
          const info = getProviderInfo(provider);
          const isConfigured = configured.includes(provider);
          return (
            <div
              key={provider}
              className="flex flex-wrap items-center gap-3 p-3 rounded-lg bg-gray-50 dark:bg-gray-800"
            >
              <div className="min-w-32">
                <div className="flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-gray-100">
                  {info.label}
                  {isConfigured && (
                    <span className="inline-flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                      <CheckCircle size={12} /> configured
                    </span>
                  )}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  default model: {info.defaultModel}
                </div>
              </div>
              <input
                type="password"
                value={inputs[provider] ?? ''}
                onChange={(e) => setInputs((prev) => ({ ...prev, [provider]: e.target.value }))}
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
          );
        })}
      </div>
    </section>
  );
}

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Radar, RotateCcw, Loader2, HelpCircle } from 'lucide-react';
import { registerAllDetectors } from '../../lib/detection/registerAll';
import { getDetectors, type DetectorConfig } from '../../lib/detection/registry';
import {
  analyzeConversation,
  getStoredConfigOverrides,
  setStoredConfigOverrides,
} from '../../lib/detection/autoAnalyze';
import type { ConfigOverrides } from '../../lib/detection/pipeline';
import { getConversations } from '../../lib/db';
import { useToastStore } from '../../stores/toastStore';
import { detectorLabel } from '../detection/severity';

// Detector config editor (IMPLEMENTATION_PLAN decisions log #2). The form is
// generated from each detector's defaultConfig shape — numbers become number
// inputs, string arrays become line-separated textareas — so new detectors
// get a settings UI without any per-detector code here.
export function DetectionSettingsSection() {
  registerAllDetectors();
  const detectors = getDetectors();
  const addToast = useToastStore((s) => s.addToast);

  const [values, setValues] = useState<ConfigOverrides>({});
  const [dirty, setDirty] = useState(false);
  const [reanalyzing, setReanalyzing] = useState<{ done: number; total: number } | null>(null);

  useEffect(() => {
    void getStoredConfigOverrides().then((stored) => {
      const merged: ConfigOverrides = {};
      for (const detector of detectors) {
        merged[detector.id] = { ...detector.defaultConfig, ...stored?.[detector.id] };
      }
      setValues(merged);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setField = (detectorId: string, key: string, value: unknown) => {
    setValues((prev) => ({
      ...prev,
      [detectorId]: { ...prev[detectorId], [key]: value },
    }));
    setDirty(true);
  };

  const handleSave = async () => {
    await setStoredConfigOverrides(values);
    setDirty(false);
    addToast('Detection settings saved — re-analyze to apply them');
  };

  const handleResetDefaults = () => {
    const defaults: ConfigOverrides = {};
    for (const detector of detectors) defaults[detector.id] = { ...detector.defaultConfig };
    setValues(defaults);
    setDirty(true);
  };

  const handleReanalyzeAll = async () => {
    const conversations = await getConversations({ source: 'claude-code' });
    setReanalyzing({ done: 0, total: conversations.length });
    let failures = 0;
    for (let i = 0; i < conversations.length; i++) {
      try {
        await analyzeConversation(conversations[i].id);
      } catch {
        failures++;
      }
      setReanalyzing({ done: i + 1, total: conversations.length });
    }
    setReanalyzing(null);
    addToast(
      failures === 0
        ? `Re-analyzed ${conversations.length} sessions`
        : `Re-analyzed with ${failures} failure(s) — see console`,
      failures === 0 ? undefined : 'error'
    );
  };

  return (
    <section className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-6">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <Radar size={18} className="text-violet-500" />
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Failure detection
          </h2>
        </div>
        <Link
          to="/how-detection-works"
          className="flex items-center gap-1 text-xs text-violet-600 dark:text-violet-400 hover:underline"
        >
          <HelpCircle size={12} />
          How detection works
        </Link>
      </div>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
        Thresholds and whitelists for the failure-pattern detectors. Changes apply
        to future analyses; existing findings are never rewritten. Re-analyze to
        evaluate your sessions under the new settings.
      </p>

      <div className="space-y-5">
        {detectors.map((detector) => (
          <fieldset key={detector.id}>
            <legend className="text-sm font-medium text-gray-800 dark:text-gray-200 mb-2">
              {detectorLabel(detector.id)}{' '}
              <span className="text-[10px] text-gray-400 font-normal">v{detector.version}</span>
            </legend>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {Object.entries(detector.defaultConfig).map(([key, defaultValue]) => (
                <ConfigField
                  key={key}
                  fieldKey={key}
                  defaultValue={defaultValue}
                  value={(values[detector.id] as DetectorConfig | undefined)?.[key] ?? defaultValue}
                  onChange={(v) => setField(detector.id, key, v)}
                />
              ))}
            </div>
          </fieldset>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 mt-5">
        <button
          onClick={handleSave}
          disabled={!dirty}
          className="px-3 py-1.5 rounded-lg text-sm font-medium bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 transition-colors"
        >
          Save settings
        </button>
        <button
          onClick={handleResetDefaults}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        >
          <RotateCcw size={14} />
          Reset to defaults
        </button>
        <button
          onClick={handleReanalyzeAll}
          disabled={!!reanalyzing || dirty}
          title={dirty ? 'Save settings first' : 'Run all detectors over every Claude Code session'}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50 transition-colors ml-auto"
        >
          {reanalyzing ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              {reanalyzing.done}/{reanalyzing.total}
            </>
          ) : (
            'Re-analyze all sessions'
          )}
        </button>
      </div>
    </section>
  );
}

function ConfigField({
  fieldKey,
  defaultValue,
  value,
  onChange,
}: {
  fieldKey: string;
  defaultValue: unknown;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const label = fieldKey.replace(/([A-Z])/g, ' $1').toLowerCase();

  if (typeof defaultValue === 'number') {
    return (
      <label className="text-xs text-gray-600 dark:text-gray-400">
        <span className="block mb-1 capitalize">{label}</span>
        <input
          type="number"
          value={value as number}
          min={0}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-full px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/40"
        />
      </label>
    );
  }

  if (Array.isArray(defaultValue)) {
    return (
      <label className="text-xs text-gray-600 dark:text-gray-400 sm:col-span-2">
        <span className="block mb-1 capitalize">{label} (one pattern per line)</span>
        <textarea
          value={(value as string[]).join('\n')}
          rows={Math.min(6, (value as string[]).length + 1)}
          onChange={(e) =>
            onChange(e.target.value.split('\n').map((s) => s.trim()).filter(Boolean))
          }
          className="w-full px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-violet-500/40"
        />
      </label>
    );
  }

  return (
    <label className="text-xs text-gray-600 dark:text-gray-400">
      <span className="block mb-1 capitalize">{label}</span>
      <input
        type="text"
        value={String(value)}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/40"
      />
    </label>
  );
}

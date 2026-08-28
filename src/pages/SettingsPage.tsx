import { useState, useEffect } from 'react';
import { Key, Trash2, HardDrive, Moon, Sun, Loader2, CheckCircle, XCircle } from 'lucide-react';
import { useAppStore } from '../stores/appStore';
import {
  db,
  getMetadata,
  setMetadata,
  findLegacyClaudeCodeImports,
  deleteLegacyClaudeCodeImports,
  getConversationCount,
} from '../lib/db';
import { syncEngine } from '../lib/sync/engine';
import { invalidateIndex } from '../lib/search';
import { validateLicense } from '../lib/license';
import { CloudSyncSection } from '../components/settings/CloudSyncSection';
import { DetectionSettingsSection } from '../components/settings/DetectionSettingsSection';
import { LLMProvidersSection } from '../components/settings/LLMProvidersSection';
import { GitHubSection } from '../components/settings/GitHubSection';
import { LocalRepositorySection } from '../components/settings/LocalRepositorySection';

export function SettingsPage() {
  const { theme, setTheme, conversationCount, messageCount, setStats, isPro, setLicense } = useAppStore();
  const [isClearing, setIsClearing] = useState(false);
  const [legacyCount, setLegacyCount] = useState<number | null>(null);
  const [isCleaningLegacy, setIsCleaningLegacy] = useState(false);
  const [licenseInput, setLicenseInput] = useState('');
  const [isActivating, setIsActivating] = useState(false);
  const [licenseError, setLicenseError] = useState<string | null>(null);
  const [licenseSuccess, setLicenseSuccess] = useState(false);
  const [licenseEmail, setLicenseEmail] = useState<string | null>(null);

  // Load saved license on mount
  useEffect(() => {
    const loadLicense = async () => {
      const savedKey = await getMetadata<string>('license.key');
      if (savedKey) {
        const result = await validateLicense(savedKey);
        if (result.valid && result.payload) {
          setLicense(savedKey, true);
          setLicenseEmail(result.payload.email);
        }
      }
    };
    loadLicense();
  }, [setLicense]);

  const handleActivateLicense = async () => {
    if (!licenseInput.trim()) return;

    setIsActivating(true);
    setLicenseError(null);
    setLicenseSuccess(false);

    try {
      const result = await validateLicense(licenseInput.trim());
      if (result.valid && result.payload) {
        await setMetadata('license.key', licenseInput.trim());
        await setMetadata('license.validatedAt', Date.now());
        setLicense(licenseInput.trim(), true);
        setLicenseEmail(result.payload.email);
        setLicenseSuccess(true);
        setLicenseInput('');
      } else {
        setLicenseError(result.error || 'Invalid license key');
      }
    } catch {
      setLicenseError('Failed to validate license');
    } finally {
      setIsActivating(false);
    }
  };

  // Count broken pre-2026-05-14 imports so the cleanup button can show scope.
  useEffect(() => {
    findLegacyClaudeCodeImports()
      .then((rows) => setLegacyCount(rows.length))
      .catch(() => setLegacyCount(null));
  }, []);

  const handleCleanupLegacy = async () => {
    if (
      !confirm(
        `Delete ${legacyCount} legacy Claude Code import(s)? These were imported by an old parser ("agent xxx" names, blank tool calls) and cannot be repaired. If cloud sync is unlocked, they are deleted from the server too.`
      )
    ) {
      return;
    }
    setIsCleaningLegacy(true);
    try {
      await deleteLegacyClaudeCodeImports();
      setLegacyCount(0);
      const [conversationCount, messageCount] = await Promise.all([
        getConversationCount(),
        db.messages.count(),
      ]);
      setStats({ conversationCount, messageCount });
      await invalidateIndex();
    } catch (err) {
      console.error('Failed to clean up legacy imports:', err);
      alert('Failed to clean up legacy imports. Please try again.');
    } finally {
      setIsCleaningLegacy(false);
    }
  };

  const handleClearData = async () => {
    if (!confirm('Delete all local data on this device? Synced data on the server is NOT affected (use "Wipe server data" in Cloud Sync for that). This cannot be undone.')) {
      return;
    }

    setIsClearing(true);
    try {
      await syncEngine.clearLocalData();
      setStats({ conversationCount: 0, messageCount: 0 });
      // Invalidate search index so cleared data is no longer searchable
      await invalidateIndex();
    } catch (err) {
      console.error('Failed to clear data:', err);
      alert('Failed to clear data. Please try again.');
    } finally {
      setIsClearing(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-white mb-2">
          Settings
        </h1>
        <p className="text-gray-600 dark:text-gray-400">
          Manage your preferences and data
        </p>
      </div>

      <div className="space-y-6">
        {/* Theme */}
        <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
            {theme === 'dark' ? <Moon size={20} /> : <Sun size={20} />}
            Appearance
          </h2>
          <div className="flex gap-3">
            {(['light', 'dark', 'system'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTheme(t)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  theme === t
                    ? 'bg-violet-600 text-white'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                }`}
              >
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
        </section>

        {/* Cloud sync (E2EE, opt-in) */}
        <CloudSyncSection />

        {/* Agent-failure detection config */}
        <DetectionSettingsSection />

        {/* LLM provider credentials (understanding synthesis) */}
        <LLMProvidersSection />
        <GitHubSection />
        <LocalRepositorySection />

        {/* License */}
        <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
            <Key size={20} />
            License
          </h2>
          {isPro ? (
            <div className="flex items-center gap-2 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg text-green-700 dark:text-green-400">
              <CheckCircle size={18} />
              <span>Pro license active{licenseEmail ? ` (${licenseEmail})` : ''}</span>
            </div>
          ) : (
            <>
              <div className="flex gap-3">
                <input
                  type="text"
                  value={licenseInput}
                  onChange={(e) => setLicenseInput(e.target.value)}
                  placeholder="Enter license key"
                  className="flex-1 px-4 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-900 dark:text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-violet-500"
                  disabled={isActivating}
                />
                <button
                  onClick={handleActivateLicense}
                  disabled={isActivating || !licenseInput.trim()}
                  className="px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white rounded-lg transition-colors flex items-center gap-2"
                >
                  {isActivating && <Loader2 size={16} className="animate-spin" />}
                  Activate
                </button>
              </div>
              {licenseError && (
                <div className="mt-3 flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
                  <XCircle size={16} />
                  {licenseError}
                </div>
              )}
              {licenseSuccess && (
                <div className="mt-3 flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
                  <CheckCircle size={16} />
                  License activated successfully!
                </div>
              )}
            </>
          )}
          <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">
            {isPro ? 'Thank you for supporting Chatdex!' : (
              <>
                Don't have a license?{' '}
                <a href="#" className="text-violet-600 dark:text-violet-400 hover:underline">
                  Purchase Pro ($29)
                </a>
              </>
            )}
          </p>
        </section>

        {/* Storage */}
        <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
            <HardDrive size={20} />
            Storage
          </h2>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4">
              <p className="text-2xl font-semibold text-gray-900 dark:text-white">
                {conversationCount}
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Conversations
              </p>
            </div>
            <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4">
              <p className="text-2xl font-semibold text-gray-900 dark:text-white">
                {messageCount}
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Messages
              </p>
            </div>
          </div>
        </section>

        {/* Danger Zone */}
        <section className="bg-white dark:bg-gray-900 border border-red-200 dark:border-red-900/50 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-red-600 dark:text-red-400 mb-4 flex items-center gap-2">
            <Trash2 size={20} />
            Danger Zone
          </h2>
          {legacyCount !== null && legacyCount > 0 && (
            <div className="mb-6">
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                {legacyCount} conversation(s) were imported by an old parser and are
                missing tool calls and project names. They cannot be repaired.
              </p>
              <button
                onClick={handleCleanupLegacy}
                disabled={isCleaningLegacy}
                className="px-4 py-2 border border-red-300 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50 rounded-lg transition-colors flex items-center gap-2"
              >
                {isCleaningLegacy && <Loader2 size={16} className="animate-spin" />}
                {isCleaningLegacy ? 'Removing...' : `Remove ${legacyCount} legacy import(s)`}
              </button>
            </div>
          )}
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
            Deletes all local data on this device. Synced data on the server is not
            affected. This cannot be undone.
          </p>
          <button
            onClick={handleClearData}
            disabled={isClearing}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded-lg transition-colors flex items-center gap-2"
          >
            {isClearing && <Loader2 size={16} className="animate-spin" />}
            {isClearing ? 'Clearing...' : 'Clear Local Data'}
          </button>
        </section>
      </div>
    </div>
  );
}

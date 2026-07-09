import { useState, useEffect } from 'react';
import {
  Cloud,
  Lock,
  CheckCircle2,
  Loader2,
  AlertCircle,
  Copy,
  Fingerprint,
  KeyRound,
} from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import {
  signup,
  login,
  unlock,
  logout,
  recoverWithCode,
} from '../../lib/auth/session';
import { isPasskeySupported } from '../../lib/auth/webauthn';
import { syncEngine } from '../../lib/sync/engine';
import { lock as lockVault } from '../../lib/crypto';

type Mode = 'idle' | 'signup' | 'login' | 'recover' | 'recovery-shown';

export function CloudSyncSection() {
  const { status, user, hydrate, setStatus, setUser, syncing, lastSyncAt } = useAuthStore();
  const [mode, setMode] = useState<Mode>('idle');
  const [email, setEmail] = useState('');
  const [recoveryInput, setRecoveryInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const [savedRecovery, setSavedRecovery] = useState(false);

  const passkeysOk = isPasskeySupported();

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (status === 'unlocked') {
      void syncEngine.start().catch((err) => console.error('[sync] start failed', err));
    }
  }, [status]);

  const reset = () => {
    setEmail('');
    setRecoveryInput('');
    setError(null);
    setRecoveryCode(null);
    setSavedRecovery(false);
  };

  const wrap = async (fn: () => Promise<void>) => {
    setError(null);
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleSignup = () =>
    wrap(async () => {
      const result = await signup(email);
      setUser(result.user);
      setStatus('unlocked');
      setRecoveryCode(result.recoveryCode);
      setMode('recovery-shown');
    });

  const handleLogin = () =>
    wrap(async () => {
      const u = await login(email);
      setUser(u);
      setStatus('unlocked');
      setMode('idle');
      reset();
    });

  const handleUnlock = () =>
    wrap(async () => {
      const u = await unlock();
      if (!u) {
        setError('Could not unlock — log in again');
        return;
      }
      setUser(u);
      setStatus('unlocked');
    });

  const handleRecover = () =>
    wrap(async () => {
      const u = await recoverWithCode(email, recoveryInput.trim());
      setUser(u);
      setStatus('unlocked');
      setMode('idle');
      reset();
    });

  const handleLock = () => {
    lockVault();
    syncEngine.stop();
    setStatus('locked');
  };

  const handleLogout = async () => {
    if (!confirm('Log out and stop syncing? Local data stays on this device.')) return;
    syncEngine.stop();
    await logout();
    setUser(null);
    setStatus('logged-out');
  };

  const handleResyncAll = () =>
    wrap(async () => {
      if (
        !confirm(
          'Re-upload every local record to the server? Use this after a server wipe, or if data was imported while the vault was locked.'
        )
      )
        return;
      await syncEngine.resyncAll();
    });

  const handleWipeServer = () =>
    wrap(async () => {
      if (
        !confirm(
          'Permanently delete every encrypted record from the server? Local data is unaffected. This cannot be undone.'
        )
      )
        return;
      await syncEngine.wipeServer();
    });

  const copyCode = () => {
    if (recoveryCode) navigator.clipboard.writeText(recoveryCode);
  };

  return (
    <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-6">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-1 flex items-center gap-2">
        <Cloud size={20} /> Cloud Sync
      </h2>
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
        Optional. End-to-end encrypted with your device passkey — touch your fingerprint or face to unlock. The server stores opaque ciphertext and cannot read your conversations.
      </p>

      {!passkeysOk && (
        <div className="flex items-center gap-2 px-3 py-2 mb-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg text-yellow-700 dark:text-yellow-300 text-sm">
          <AlertCircle size={14} /> This browser doesn't support passkeys. Use Chrome, Safari 17.4+, or Firefox 122+.
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 px-3 py-2 mb-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-300 text-sm">
          <AlertCircle size={14} /> {error}
        </div>
      )}

      {mode === 'recovery-shown' && recoveryCode && (
        <>
          <div className="space-y-3 p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
            <div className="flex items-center gap-2 text-amber-700 dark:text-amber-300 font-medium">
              <AlertCircle size={16} /> Save this recovery code now
            </div>
            <p className="text-xs text-amber-700 dark:text-amber-400">
              Shown <strong>only once</strong>. If you lose this device, this code is the only way to recover access on a new one. Store it in a password manager.
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 px-3 py-2 bg-white dark:bg-gray-900 border border-amber-200 dark:border-amber-800 rounded font-mono text-sm break-all">
                {recoveryCode}
              </code>
              <button
                onClick={copyCode}
                className="p-2 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/40 rounded"
                title="Copy"
              >
                <Copy size={16} />
              </button>
            </div>
            <label className="flex items-center gap-2 text-sm text-amber-800 dark:text-amber-300">
              <input
                type="checkbox"
                checked={savedRecovery}
                onChange={(e) => setSavedRecovery(e.target.checked)}
              />
              I've saved my recovery code somewhere safe
            </label>
            <button
              disabled={!savedRecovery}
              onClick={() => {
                setMode('idle');
                reset();
              }}
              className="w-full px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white rounded-lg text-sm"
            >
              Continue
            </button>
          </div>

          <div className="mt-3 space-y-2 p-4 bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800 rounded-lg">
            <div className="flex items-center gap-2 text-violet-700 dark:text-violet-300 font-medium">
              <KeyRound size={16} /> Back up your passkey
            </div>
            <p className="text-xs text-violet-700 dark:text-violet-400">
              The easiest way to keep access if you lose this device is to save the passkey to a password manager that syncs across devices — <strong>1Password</strong>, <strong>iCloud Keychain</strong>, <strong>Bitwarden</strong>, or <strong>Google Password Manager</strong>. If your browser saved it to one of those when you enrolled, you're set. Otherwise the recovery code above is your only fallback.
            </p>
          </div>
        </>
      )}

      {mode === 'idle' && status === 'logged-out' && passkeysOk && (
        <div className="space-y-2">
          <div className="flex gap-2">
            <button
              onClick={() => {
                reset();
                setMode('signup');
              }}
              className="flex-1 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm flex items-center justify-center gap-2"
            >
              <Fingerprint size={16} /> Enable cloud sync
            </button>
            <button
              onClick={() => {
                reset();
                setMode('login');
              }}
              className="flex-1 px-4 py-2 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg text-sm"
            >
              Log in
            </button>
          </div>
          <button
            onClick={() => {
              reset();
              setMode('recover');
            }}
            className="w-full text-xs text-gray-500 dark:text-gray-400 hover:text-violet-600"
          >
            Lost your device? Recover with code
          </button>
        </div>
      )}

      {mode === 'idle' && status === 'locked' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-800 rounded-lg text-sm text-gray-700 dark:text-gray-300">
            <Lock size={14} /> Logged in as {user?.email} — vault is locked
          </div>
          <button
            disabled={busy}
            onClick={() => void handleUnlock()}
            className="w-full px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white rounded-lg text-sm flex items-center justify-center gap-2"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Fingerprint size={16} />}
            Unlock with passkey
          </button>
          <button
            onClick={handleLogout}
            className="text-xs text-gray-500 dark:text-gray-400 hover:text-red-600"
          >
            Log out
          </button>
        </div>
      )}

      {mode === 'idle' && status === 'unlocked' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 px-3 py-2 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg text-sm text-green-700 dark:text-green-400">
            <CheckCircle2 size={14} /> Synced as {user?.email}
            {syncing && <Loader2 size={12} className="animate-spin ml-auto" />}
          </div>
          {lastSyncAt && (
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Last synced {lastSyncAt.toLocaleTimeString()}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => void syncEngine.tick()}
              className="px-3 py-1.5 text-xs border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg"
            >
              Sync now
            </button>
            <button
              onClick={() => void handleResyncAll()}
              disabled={busy}
              className="px-3 py-1.5 text-xs border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg disabled:opacity-50"
            >
              Re-upload local data
            </button>
            <button
              onClick={handleLock}
              className="px-3 py-1.5 text-xs border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg"
            >
              Lock
            </button>
            <button
              onClick={handleLogout}
              className="px-3 py-1.5 text-xs border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg"
            >
              Log out
            </button>
            <button
              onClick={() => void handleWipeServer()}
              disabled={busy}
              className="px-3 py-1.5 text-xs text-red-600 dark:text-red-400 border border-red-200 dark:border-red-900/40 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg disabled:opacity-50"
            >
              Wipe server data
            </button>
          </div>
        </div>
      )}

      {mode === 'signup' && passkeysOk && (
        <div className="space-y-2">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900"
          />
          <p className="text-xs text-gray-500 dark:text-gray-400">
            You'll be prompted to create a passkey (Touch ID, Face ID, Windows Hello, or security key). No password to remember.
          </p>
          <div className="flex gap-2 pt-1">
            <button
              disabled={busy || !email}
              onClick={() => void handleSignup()}
              className="flex-1 px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white rounded-lg text-sm flex items-center justify-center gap-2"
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Fingerprint size={16} />}
              Create encrypted account
            </button>
            <button
              onClick={() => {
                setMode('idle');
                reset();
              }}
              className="px-4 py-2 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {mode === 'login' && passkeysOk && (
        <div className="space-y-2">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900"
          />
          <div className="flex gap-2 pt-1">
            <button
              disabled={busy || !email}
              onClick={() => void handleLogin()}
              className="flex-1 px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white rounded-lg text-sm flex items-center justify-center gap-2"
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Fingerprint size={16} />}
              Authenticate with passkey
            </button>
            <button
              onClick={() => {
                setMode('idle');
                reset();
              }}
              className="px-4 py-2 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {mode === 'recover' && passkeysOk && (
        <div className="space-y-2">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900"
          />
          <input
            type="text"
            value={recoveryInput}
            onChange={(e) => setRecoveryInput(e.target.value)}
            placeholder="Recovery code (XXXXX-XXXXX-XXXXX-...)"
            className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 font-mono"
          />
          <p className="text-xs text-gray-500 dark:text-gray-400">
            You'll be prompted to enroll a new passkey on this device. Your old passkey on the lost device will stop working.
          </p>
          <div className="flex gap-2 pt-1">
            <button
              disabled={busy || !email || !recoveryInput}
              onClick={() => void handleRecover()}
              className="flex-1 px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white rounded-lg text-sm flex items-center justify-center gap-2"
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Fingerprint size={16} />}
              Recover account
            </button>
            <button
              onClick={() => {
                setMode('idle');
                reset();
              }}
              className="px-4 py-2 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

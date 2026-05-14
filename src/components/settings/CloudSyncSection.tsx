import { useState, useEffect } from 'react';
import { Cloud, Lock, CheckCircle2, Loader2, AlertCircle, Copy } from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import {
  signup,
  login,
  restoreAndUnlock,
  logout,
  rotateRecoveryCode,
} from '../../lib/auth/session';
import { syncEngine } from '../../lib/sync/engine';
import { wipeServerData } from '../../lib/sync/syncApi';
import { lock as lockVault } from '../../lib/crypto';

type Mode = 'idle' | 'signup' | 'login' | 'unlock' | 'recovery-shown';

export function CloudSyncSection() {
  const { status, user, hydrate, setStatus, setUser, syncing, lastSyncAt } = useAuthStore();
  const [mode, setMode] = useState<Mode>('idle');
  const [email, setEmail] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [confirmPassphrase, setConfirmPassphrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const [savedRecovery, setSavedRecovery] = useState(false);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (status === 'unlocked') {
      void syncEngine.start().catch((err) => {
        console.error('[sync] start failed', err);
      });
    }
    return () => {
      // engine.stop() is idempotent; no-op if not started
    };
  }, [status]);

  const reset = () => {
    setEmail('');
    setPassphrase('');
    setConfirmPassphrase('');
    setError(null);
    setRecoveryCode(null);
    setSavedRecovery(false);
  };

  const handleSignup = async () => {
    setError(null);
    if (passphrase.length < 8) return setError('Passphrase must be at least 8 characters');
    if (passphrase !== confirmPassphrase) return setError('Passphrases do not match');
    setBusy(true);
    try {
      const result = await signup(email, passphrase);
      setUser(result.user);
      setStatus('unlocked');
      setRecoveryCode(result.recoveryCode);
      setMode('recovery-shown');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleLogin = async () => {
    setError(null);
    setBusy(true);
    try {
      const u = await login(email, passphrase);
      setUser(u);
      setStatus('unlocked');
      setMode('idle');
      reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleUnlock = async () => {
    setError(null);
    setBusy(true);
    try {
      const u = await restoreAndUnlock(passphrase);
      if (!u) {
        setError('Wrong passphrase');
        return;
      }
      setUser(u);
      setStatus('unlocked');
      setMode('idle');
      reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleLock = () => {
    lockVault();
    syncEngine.stop();
    setStatus('locked');
  };

  const handleLogout = async () => {
    if (!confirm('Log out and stop syncing? Your local data stays on this device.')) return;
    syncEngine.stop();
    await logout();
    setUser(null);
    setStatus('logged-out');
  };

  const handleRotateRecovery = async () => {
    if (!confirm('Generate a new recovery code? Your old code stops working immediately.')) return;
    setBusy(true);
    try {
      const code = await rotateRecoveryCode();
      setRecoveryCode(code);
      setMode('recovery-shown');
      setSavedRecovery(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleWipeServer = async () => {
    if (
      !confirm(
        'Permanently delete every encrypted record from the server? Local data is unaffected. This cannot be undone.'
      )
    )
      return;
    setBusy(true);
    try {
      await wipeServerData();
      await syncEngine.wipeLocalCursor();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const copyCode = () => {
    if (recoveryCode) navigator.clipboard.writeText(recoveryCode);
  };

  return (
    <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-6">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-1 flex items-center gap-2">
        <Cloud size={20} /> Cloud Sync
      </h2>
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
        Optional. End-to-end encrypted — the server stores opaque ciphertext and cannot read your conversations.
      </p>

      {error && (
        <div className="flex items-center gap-2 px-3 py-2 mb-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-300 text-sm">
          <AlertCircle size={14} /> {error}
        </div>
      )}

      {mode === 'recovery-shown' && recoveryCode && (
        <div className="space-y-3 p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
          <div className="flex items-center gap-2 text-amber-700 dark:text-amber-300 font-medium">
            <AlertCircle size={16} /> Save this recovery code now
          </div>
          <p className="text-xs text-amber-700 dark:text-amber-400">
            This is shown <strong>only once</strong>. If you forget your passphrase, it's the only way to recover access. Store it in a password manager.
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
      )}

      {mode === 'idle' && status === 'logged-out' && (
        <div className="flex gap-2">
          <button
            onClick={() => {
              reset();
              setMode('signup');
            }}
            className="flex-1 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm"
          >
            Enable cloud sync
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
      )}

      {mode === 'idle' && status === 'locked' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-800 rounded-lg text-sm text-gray-700 dark:text-gray-300">
            <Lock size={14} /> Logged in as {user?.email} — vault is locked
          </div>
          <div className="flex gap-2">
            <input
              type="password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder="Passphrase"
              className="flex-1 px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900"
              onKeyDown={(e) => e.key === 'Enter' && void handleUnlock()}
            />
            <button
              disabled={busy || !passphrase}
              onClick={() => void handleUnlock()}
              className="px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white rounded-lg text-sm flex items-center gap-2"
            >
              {busy && <Loader2 size={14} className="animate-spin" />}
              Unlock
            </button>
          </div>
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
              onClick={handleLock}
              className="px-3 py-1.5 text-xs border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg"
            >
              Lock
            </button>
            <button
              onClick={() => void handleRotateRecovery()}
              disabled={busy}
              className="px-3 py-1.5 text-xs border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg disabled:opacity-50"
            >
              New recovery code
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

      {mode === 'signup' && (
        <div className="space-y-2">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900"
          />
          <input
            type="password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            placeholder="Passphrase (min 8 chars)"
            className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900"
          />
          <input
            type="password"
            value={confirmPassphrase}
            onChange={(e) => setConfirmPassphrase(e.target.value)}
            placeholder="Confirm passphrase"
            className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900"
          />
          <div className="flex gap-2 pt-1">
            <button
              disabled={busy || !email || !passphrase}
              onClick={() => void handleSignup()}
              className="flex-1 px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white rounded-lg text-sm flex items-center justify-center gap-2"
            >
              {busy && <Loader2 size={14} className="animate-spin" />}
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

      {mode === 'login' && (
        <div className="space-y-2">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900"
          />
          <input
            type="password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            placeholder="Passphrase"
            className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900"
            onKeyDown={(e) => e.key === 'Enter' && void handleLogin()}
          />
          <div className="flex gap-2 pt-1">
            <button
              disabled={busy || !email || !passphrase}
              onClick={() => void handleLogin()}
              className="flex-1 px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white rounded-lg text-sm flex items-center justify-center gap-2"
            >
              {busy && <Loader2 size={14} className="animate-spin" />}
              Log in
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

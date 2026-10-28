// Nav-bar sync status and lock control (docs/changes/reliable-sync). Always
// says plainly where the user's data is: only on this device, waiting to
// upload, or backed up (encrypted) to the cloud.

import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle,
  Cloud,
  CloudOff,
  Fingerprint,
  Loader2,
  Lock,
  RefreshCw,
  Settings,
} from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { lock as lockDevice, unlock } from '../../lib/auth/session';
import { syncEngine } from '../../lib/sync/engine';
import { useStorageSummary } from '../../hooks/useStorageLocation';
import type { Tally } from '../../lib/sync/storageLocation';

function timeAgo(date: Date, now: number): string {
  const seconds = Math.max(0, Math.round((now - date.getTime()) / 1000));
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return date.toLocaleDateString();
}

function plural(n: number, word: string): string {
  return `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
}

function SummaryRow({ label, tally, signedIn }: { label: string; tally: Tally; signedIn: boolean }) {
  const notBackedUp = tally.total - tally.cloud;
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-gray-600 dark:text-gray-400">{label}</span>
      <span className="text-right tabular-nums">
        <span className="text-emerald-600 dark:text-emerald-400">
          {tally.cloud.toLocaleString()}
        </span>
        <span className="text-gray-400"> / {tally.total.toLocaleString()} backed up</span>
        {notBackedUp > 0 && (
          <span className="block text-[11px] text-amber-600 dark:text-amber-400">
            {signedIn && tally.pending > 0
              ? `${tally.pending.toLocaleString()} waiting to upload`
              : `${notBackedUp.toLocaleString()} on this device only`}
          </span>
        )}
      </span>
    </div>
  );
}

type Tone = 'ok' | 'busy' | 'warn' | 'error';

const TONE_CLASSES: Record<Tone, string> = {
  ok: 'text-emerald-600 dark:text-emerald-400',
  busy: 'text-gray-500 dark:text-gray-400',
  warn: 'text-amber-600 dark:text-amber-400',
  error: 'text-red-600 dark:text-red-400',
};

export function SyncStatusMenu() {
  const { status, user, syncing, syncError, lastSyncAt, pending, setStatus, setUser } =
    useAuthStore();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const ref = useRef<HTMLDivElement>(null);
  const summary = useStorageSummary(open);

  // Keep "2 min ago" fresh.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  const run = async (fn: () => Promise<void>) => {
    setActionError(null);
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleUnlock = () =>
    run(async () => {
      const u = await unlock();
      if (!u) throw new Error('Could not unlock. Log in again from Settings.');
      setUser(u);
      setStatus('unlocked');
    });

  const handleLock = () =>
    run(async () => {
      await lockDevice();
      setStatus('locked');
    });

  let Icon = CloudOff;
  let label: string;
  let tone: Tone;
  let detail: string;

  if (status === 'logged-out') {
    label = 'On this device only';
    tone = 'warn';
    detail =
      'Cloud sync is off. Everything you import or create exists only in this browser — clearing site data deletes it.';
  } else if (status === 'locked') {
    Icon = Lock;
    label = pending > 0 ? `Locked · ${pending} waiting` : 'Locked';
    tone = 'warn';
    detail =
      pending > 0
        ? `${plural(pending, 'change')} on this device only. They upload when you unlock.`
        : 'Sync is paused. New changes stay on this device until you unlock.';
  } else if (syncError) {
    Icon = AlertCircle;
    label = 'Sync error';
    tone = 'error';
    detail = `Last attempt failed: ${syncError}.${
      pending > 0 ? ` ${plural(pending, 'change')} still on this device only.` : ''
    } Sync retries automatically.`;
  } else if (syncing) {
    Icon = Loader2;
    label = pending > 0 ? `Syncing ${pending}…` : 'Syncing…';
    tone = 'busy';
    detail = 'Encrypting and uploading changes, and checking for new ones.';
  } else if (pending > 0) {
    Icon = Cloud;
    label = `${pending} waiting`;
    tone = 'warn';
    detail = `${plural(pending, 'change')} waiting to upload.`;
  } else {
    Icon = Cloud;
    label = lastSyncAt ? `Synced · ${timeAgo(lastSyncAt, now)}` : 'Synced';
    tone = 'ok';
    detail = 'Everything that syncs is backed up to the cloud, encrypted so only you can read it.';
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1.5 px-2 py-1 text-xs rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors ${TONE_CLASSES[tone]}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={detail}
      >
        <Icon size={14} className={Icon === Loader2 ? 'animate-spin' : undefined} />
        <span className="hidden sm:inline">{label}</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Sync status"
          className="absolute right-0 top-full mt-1 z-50 w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg p-3 space-y-3 text-sm"
        >
          <div>
            <div className={`flex items-center gap-1.5 font-medium ${TONE_CLASSES[tone]}`}>
              <Icon size={14} className={Icon === Loader2 ? 'animate-spin' : undefined} />
              {label}
            </div>
            <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">{detail}</p>
            {user && (
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-500">Account: {user.email}</p>
            )}
            {status === 'unlocked' && lastSyncAt && (
              <p className="text-xs text-gray-500 dark:text-gray-500">
                Last synced {lastSyncAt.toLocaleTimeString()}
              </p>
            )}
            {summary && (
              <div className="mt-3 space-y-1 text-xs border-t border-gray-100 dark:border-gray-800 pt-2">
                <SummaryRow label="Conversations" tally={summary.conversations} signedIn={status !== 'logged-out'} />
                <SummaryRow label="Messages" tally={summary.messages} signedIn={status !== 'logged-out'} />
                <SummaryRow label="Projects" tally={summary.projects} signedIn={status !== 'logged-out'} />
              </div>
            )}
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-500">
              Repository file caches and research sources always stay on this device.
            </p>
          </div>

          {actionError && (
            <p className="flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400">
              <AlertCircle size={12} /> {actionError}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            {status === 'unlocked' && (
              <>
                <button
                  onClick={() => void syncEngine.tick()}
                  disabled={syncing}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg disabled:opacity-50"
                >
                  <RefreshCw size={12} /> Sync now
                </button>
                <button
                  onClick={() => void handleLock()}
                  disabled={busy}
                  title="Pause sync and require your passkey to resume, even after a reload"
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg disabled:opacity-50"
                >
                  <Lock size={12} /> Lock
                </button>
              </>
            )}
            {status === 'locked' && (
              <button
                onClick={() => void handleUnlock()}
                disabled={busy}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-violet-600 hover:bg-violet-700 text-white rounded-lg disabled:opacity-50"
              >
                {busy ? <Loader2 size={12} className="animate-spin" /> : <Fingerprint size={12} />}
                Unlock with passkey
              </button>
            )}
            <Link
              to="/settings"
              onClick={() => setOpen(false)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg"
            >
              <Settings size={12} />
              {status === 'logged-out' ? 'Set up cloud sync' : 'Sync settings'}
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

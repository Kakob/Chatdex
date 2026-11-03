// "Where is this saved?" label (docs/changes/reliable-sync Phase 2).

import { Cloud, CloudOff, CloudUpload } from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import {
  effectiveLocation,
  type StorageLocation,
  type Tally,
} from '../../lib/sync/storageLocation';

const META: Record<StorageLocation, { label: string; className: string; Icon: typeof Cloud }> = {
  cloud: {
    label: 'Backed up',
    className: 'text-emerald-700 bg-emerald-50 dark:text-emerald-300 dark:bg-emerald-900/30',
    Icon: Cloud,
  },
  pending: {
    label: 'Waiting to upload',
    className: 'text-amber-700 bg-amber-50 dark:text-amber-300 dark:bg-amber-900/30',
    Icon: CloudUpload,
  },
  device: {
    label: 'This device only',
    className: 'text-gray-600 bg-gray-100 dark:text-gray-300 dark:bg-gray-800',
    Icon: CloudOff,
  },
};

function describe(location: StorageLocation, locked: boolean, messages?: Tally): string {
  const head =
    location === 'cloud'
      ? 'Backed up to the cloud, encrypted so only you can read it.'
      : location === 'pending'
        ? locked
          ? 'Waiting to upload. Sync is locked; unlock to back it up.'
          : 'Waiting to upload to the cloud.'
        : 'Only on this device. Clearing this browser’s site data would delete it.';
  if (!messages || messages.total === 0) return head;
  return `${head} ${messages.cloud} of ${messages.total} messages backed up.`;
}

interface StorageBadgeProps {
  location: StorageLocation;
  /** Message counts, shown in the tooltip (and inline when `showCounts`). */
  messages?: Tally;
  showCounts?: boolean;
}

export function StorageBadge({ location, messages, showCounts = false }: StorageBadgeProps) {
  const status = useAuthStore((s) => s.status);
  const shown = effectiveLocation(location, status);
  const { label, className, Icon } = META[shown];
  const partial = messages && messages.total > 0 && messages.cloud < messages.total;
  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium ${className}`}
      title={describe(shown, status === 'locked', messages)}
    >
      <Icon size={11} />
      {label}
      {showCounts && partial && (
        <span className="font-normal">
          · {messages.cloud}/{messages.total} messages
        </span>
      )}
    </span>
  );
}

/** Tiny per-message marker: an icon with a tooltip, no text. */
export function StorageDot({ location }: { location: StorageLocation }) {
  const status = useAuthStore((s) => s.status);
  const shown = effectiveLocation(location, status);
  const { Icon } = META[shown];
  const color =
    shown === 'cloud'
      ? 'text-emerald-500/70'
      : shown === 'pending'
        ? 'text-amber-500'
        : 'text-gray-400';
  return (
    <span title={describe(shown, status === 'locked')} className={`inline-flex ${color}`}>
      <Icon size={11} aria-label={META[shown].label} />
    </span>
  );
}

// File System Access API helpers for picking ~/.claude/projects and walking
// for .jsonl session logs. The directory handle is persisted in IndexedDB
// (via the existing metadata table) so a returning user can re-grant access
// in one click instead of re-picking the folder.

import { getMetadata, setMetadata, deleteMetadata } from '../db/metadata';

const HANDLE_KEY = 'claudeCode.projectsDirHandle';
const NAME_KEY = 'claudeCode.projectsDirName';

type PermissionMode = 'read' | 'readwrite';
type PermissionState = 'granted' | 'denied' | 'prompt';

interface WithPermissions {
  queryPermission?: (opts: { mode: PermissionMode }) => Promise<PermissionState>;
  requestPermission?: (opts: { mode: PermissionMode }) => Promise<PermissionState>;
}

export function isDirectoryPickerSupported(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

export async function pickProjectsDirectory(): Promise<FileSystemDirectoryHandle | null> {
  if (!isDirectoryPickerSupported()) return null;
  try {
    const handle = await (window as unknown as {
      showDirectoryPicker: (opts?: { id?: string; mode?: PermissionMode }) => Promise<FileSystemDirectoryHandle>;
    }).showDirectoryPicker({ id: 'chatdex-claude-code', mode: 'read' });
    return handle;
  } catch (err) {
    // User cancelled the picker — not an error worth surfacing.
    if (err instanceof DOMException && err.name === 'AbortError') return null;
    throw err;
  }
}

export async function rememberHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  await setMetadata(HANDLE_KEY, handle);
  await setMetadata(NAME_KEY, handle.name);
}

export async function getRememberedHandle(): Promise<FileSystemDirectoryHandle | null> {
  const handle = await getMetadata<FileSystemDirectoryHandle>(HANDLE_KEY);
  return handle ?? null;
}

export async function getRememberedHandleName(): Promise<string | null> {
  const name = await getMetadata<string>(NAME_KEY);
  return name ?? null;
}

export async function forgetHandle(): Promise<void> {
  await deleteMetadata(HANDLE_KEY);
  await deleteMetadata(NAME_KEY);
}

export async function ensureReadPermission(
  handle: FileSystemDirectoryHandle,
): Promise<boolean> {
  const h = handle as FileSystemDirectoryHandle & WithPermissions;
  const opts = { mode: 'read' as const };
  if (h.queryPermission && (await h.queryPermission(opts)) === 'granted') return true;
  if (h.requestPermission && (await h.requestPermission(opts)) === 'granted') return true;
  return false;
}

export interface WalkProgress {
  scanned: number;
  found: number;
}

export async function collectJsonlFiles(
  root: FileSystemDirectoryHandle,
  onProgress?: (p: WalkProgress) => void,
): Promise<File[]> {
  const out: File[] = [];
  let scanned = 0;

  async function walk(dir: FileSystemDirectoryHandle): Promise<void> {
    // `entries()` is an async iterator on directory handles.
    const iter = (dir as unknown as {
      entries: () => AsyncIterableIterator<[string, FileSystemHandle]>;
    }).entries();
    for await (const [name, entry] of iter) {
      scanned++;
      if (entry.kind === 'file' && name.toLowerCase().endsWith('.jsonl')) {
        const file = await (entry as FileSystemFileHandle).getFile();
        out.push(file);
        onProgress?.({ scanned, found: out.length });
      } else if (entry.kind === 'directory') {
        await walk(entry as FileSystemDirectoryHandle);
      }
    }
  }

  await walk(root);
  onProgress?.({ scanned, found: out.length });
  return out;
}

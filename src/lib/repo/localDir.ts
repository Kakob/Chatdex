// Remembered local directory for evidence search (SPEC-change-workspace §9,
// audit S11; CW-8). The handle lives in the device-local `repo.*` metadata
// keys (never synced — a handle is not serializable and grants read access
// to a folder on this machine). Forgetting it also evicts its file cache.

import { getMetadata, setMetadata, deleteMetadata } from '../db/metadata';
import { evictRepo } from '../db/repoFiles';
import { ensureReadPermission, isDirectoryPickerSupported } from '../fs/directoryPicker';
import { localRepoKey } from './localDirSource';

export const LOCAL_DIR_HANDLE_KEY = 'repo.localDirHandle';
export const LOCAL_DIR_NAME_KEY = 'repo.localDirName';

export { isDirectoryPickerSupported, ensureReadPermission };

export async function pickLocalDirectory(): Promise<FileSystemDirectoryHandle | null> {
  if (!isDirectoryPickerSupported()) return null;
  try {
    const handle = await (window as unknown as {
      showDirectoryPicker: (opts?: { id?: string; mode?: 'read' }) => Promise<FileSystemDirectoryHandle>;
    }).showDirectoryPicker({ id: 'chatdex-repo', mode: 'read' });
    return handle;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return null;
    throw err;
  }
}

export async function rememberLocalDirectory(handle: FileSystemDirectoryHandle): Promise<void> {
  await setMetadata(LOCAL_DIR_HANDLE_KEY, handle);
  await setMetadata(LOCAL_DIR_NAME_KEY, handle.name);
}

export async function getRememberedLocalDirectory(): Promise<FileSystemDirectoryHandle | null> {
  return (await getMetadata<FileSystemDirectoryHandle>(LOCAL_DIR_HANDLE_KEY)) ?? null;
}

export async function getRememberedLocalDirectoryName(): Promise<string | null> {
  return (await getMetadata<string>(LOCAL_DIR_NAME_KEY)) ?? null;
}

/** Forget the handle and evict every cached file from it. */
export async function forgetLocalDirectory(): Promise<number> {
  const name = await getRememberedLocalDirectoryName();
  await deleteMetadata(LOCAL_DIR_HANDLE_KEY);
  await deleteMetadata(LOCAL_DIR_NAME_KEY);
  return name ? evictRepo(localRepoKey(name)) : 0;
}

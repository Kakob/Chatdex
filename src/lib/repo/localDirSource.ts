// Local-directory RepoSource (SPEC-change-workspace §9, D2, audit S11; CW-8).
// Reads a user-picked folder through the File System Access API (Chrome),
// read-only. Same rules as the GitHub source: excluded directories are never
// walked, sensitive paths never cached, per-file size cap applies, and the
// cache stays LOCAL-ONLY. The snapshot sha is the constant 'local' — a
// working tree has no pinned commit, and evidence says so.

import { EXCLUDED_DIRS, isFetchAllowed } from '../understanding/trace/fetchPolicy';
import { MAX_FILE_BYTES } from '../github/client';
import type { RepoSource, SourceFile } from './sources';

export const LOCAL_SHA = 'local';
/** Files (after exclusions) a picked directory may contain before it is refused (S11). */
export const LOCAL_MAX_FILES = 5000;
/** Directory entries walked before giving up — guards against picking `~` (S11). */
export const LOCAL_MAX_ENTRIES = 50_000;

export function localRepoKey(name: string): string {
  return `fs:${name}`;
}

interface DirHandleLike {
  name: string;
  kind: 'directory';
  entries: () => AsyncIterableIterator<[string, FileHandleLike | DirHandleLike]>;
}
interface FileHandleLike {
  name: string;
  kind: 'file';
  getFile: () => Promise<{ size: number; text: () => Promise<string> }>;
}

export class LocalDirectoryTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LocalDirectoryTooLargeError';
  }
}

/** Walk once, respecting exclusions; returns relative paths with sizes. */
export async function walkLocalDirectory(
  rootHandle: FileSystemDirectoryHandle,
  options: { maxFiles?: number; maxEntries?: number } = {}
): Promise<{ files: SourceFile[]; truncated: boolean; excludedDirs: number }> {
  const maxFiles = options.maxFiles ?? LOCAL_MAX_FILES;
  const maxEntries = options.maxEntries ?? LOCAL_MAX_ENTRIES;
  const root = rootHandle as unknown as DirHandleLike;
  const files: SourceFile[] = [];
  let entries = 0;
  let excludedDirs = 0;

  async function walk(dir: DirHandleLike, prefix: string): Promise<void> {
    for await (const [name, entry] of dir.entries()) {
      entries += 1;
      if (entries > maxEntries) {
        throw new LocalDirectoryTooLargeError(`Stopped after ${maxEntries} entries — pick a project folder, not a home directory`);
      }
      const path = prefix ? `${prefix}/${name}` : name;
      if (entry.kind === 'directory') {
        if (EXCLUDED_DIRS.includes(name) || name.startsWith('.')) {
          excludedDirs += 1;
          continue;
        }
        await walk(entry as DirHandleLike, path);
      } else {
        if (files.length >= maxFiles) {
          throw new LocalDirectoryTooLargeError(`More than ${maxFiles} files — pick a smaller folder`);
        }
        if (!isFetchAllowed(path).allowed) continue; // never even listed
        const file = await (entry as FileHandleLike).getFile();
        files.push({ path, size: file.size });
      }
    }
  }

  await walk(root, '');
  return { files, truncated: false, excludedDirs };
}

export function createLocalDirSource(handle: FileSystemDirectoryHandle): RepoSource {
  const root = handle as unknown as DirHandleLike;
  let listing: { files: SourceFile[]; handles: Map<string, FileHandleLike> } | null = null;

  async function ensureListing() {
    if (listing) return listing;
    const handles = new Map<string, FileHandleLike>();
    async function index(dir: DirHandleLike, prefix: string): Promise<void> {
      for await (const [name, entry] of dir.entries()) {
        const path = prefix ? `${prefix}/${name}` : name;
        if (entry.kind === 'directory') {
          if (EXCLUDED_DIRS.includes(name) || name.startsWith('.')) continue;
          await index(entry as DirHandleLike, path);
        } else if (isFetchAllowed(path).allowed) {
          handles.set(path, entry as FileHandleLike);
        }
      }
    }
    const walked = await walkLocalDirectory(handle);
    await index(root, '');
    listing = { files: walked.files, handles };
    return listing;
  }

  return {
    key: localRepoKey(handle.name),
    label: `${handle.name}/ (local, read-only)`,
    async listFiles() {
      const l = await ensureListing();
      return { files: l.files, truncated: false };
    },
    async readFile(_sha, path) {
      const l = await ensureListing();
      const h = l.handles.get(path);
      if (!h) throw new Error(`Not in the picked directory: ${path}`);
      const file = await h.getFile();
      if (file.size > MAX_FILE_BYTES) throw new Error(`File too large (${file.size} bytes)`);
      return { text: await file.text(), size: file.size };
    },
  };
}

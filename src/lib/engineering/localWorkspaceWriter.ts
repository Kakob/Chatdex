/**
 * Explicit opt-in local working-tree writer for the shared coding protocol.
 *
 * Separate from src/lib/repo/localDirSource.ts, which MUST stay read-only.
 * The user picks a folder with readwrite permission for every write. We
 * refuse changed baselines and NEVER create files/directories implicitly.
 * This API is unsupported on iOS/Safari; use the copy/handoff path there.
 */
import { sha256Hex } from '../utils/hash';
import type { SourceEditProposal } from './codingProtocol';
import { validateSourceBinding } from './sourceCatalog';
import { recordSuccessfulWrite } from './codingStore';

export interface LocalWriteResult {
  path: string;
  revisionId: string;
  bytesWritten: number;
}

export interface WritableFileLike {
  getFile(): Promise<{ text(): Promise<string> }>;
  createWritable(): Promise<{ write(content: string): Promise<void>; close(): Promise<void>; abort?(): Promise<void> }>;
}
export interface WritableDirectoryLike {
  getDirectoryHandle(name: string): Promise<WritableDirectoryLike>;
  getFileHandle(name: string): Promise<WritableFileLike>;
}
export type DirectoryPicker = (options: { mode: 'readwrite'; id: string }) => Promise<WritableDirectoryLike>;

export function canWriteLocalWorkingTree(): boolean {
  return typeof window !== 'undefined' && typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';
}

/**
 * Folder picker must be invoked directly from a user interaction.
 * No silent write, no git commit, no overwritten changed baseline.
 */
export async function writeRevisionToPickedFolder(
  edit: SourceEditProposal,
  pick: DirectoryPicker,
): Promise<LocalWriteResult> {
  validateSourceBinding({
    id: edit.bindingId, projectId: edit.projectId, targetId: edit.targetId,
    role: 'implementation', repoKey: edit.repoKey, path: edit.path,
    sourceKind: edit.sourceKind, sha: edit.sourceSha, needle: '',
    label: 'Requested file revision', origin: 'manual',
  });
  const segments = edit.path.split('/');
  const root = await pick({ mode: 'readwrite', id: 'chatdex-code-write' });
  let dir = root;
  try {
    for (const segment of segments.slice(0, -1)) {
      dir = await dir.getDirectoryHandle(segment);
    }
    const file = await dir.getFileHandle(segments[segments.length - 1]);
    const current = await (await file.getFile()).text();
    if ((await sha256Hex(current)) !== edit.baselineHash || current !== edit.baselineText) {
      throw new Error('The selected file is different from the staged baseline. Nothing was written. Refresh the source first.');
    }
    const writer = await file.createWritable();
    try {
      await writer.write(edit.proposedText);
      await writer.close();
    } catch (error) {
      try { await writer.abort?.(); } catch { /* preserve original error */ }
      throw error;
    }
  } catch (reason) {
    if (reason instanceof Error && reason.name === 'NotFoundError') {
      throw new Error('Selected folder does not contain the exact bound path. Nothing was written.');
    }
    throw reason;
  }
  await recordSuccessfulWrite(edit.id, 'local-folder-confirmed');
  return {
    path: edit.path,
    revisionId: edit.id,
    bytesWritten: new TextEncoder().encode(edit.proposedText).length,
  };
}

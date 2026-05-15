import { useCallback, useEffect, useState } from 'react';
import {
  collectJsonlFiles,
  ensureReadPermission,
  forgetHandle,
  getRememberedHandle,
  getRememberedHandleName,
  isDirectoryPickerSupported,
  pickProjectsDirectory,
  rememberHandle,
} from '../lib/fs/directoryPicker';

interface UseClaudeCodeFolderArgs {
  onFiles: (files: File[]) => void | Promise<void>;
  disabled?: boolean;
}

interface UseClaudeCodeFolderReturn {
  supported: boolean;
  rememberedName: string | null;
  isScanning: boolean;
  error: string | null;
  pickFolder: () => Promise<void>;
  resumeFolder: () => Promise<void>;
  forget: () => Promise<void>;
}

export function useClaudeCodeFolder({
  onFiles,
  disabled,
}: UseClaudeCodeFolderArgs): UseClaudeCodeFolderReturn {
  const supported = isDirectoryPickerSupported();
  const [rememberedName, setRememberedName] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supported) return;
    getRememberedHandleName().then(setRememberedName).catch(() => setRememberedName(null));
  }, [supported]);

  const importFromHandle = useCallback(
    async (handle: FileSystemDirectoryHandle) => {
      setIsScanning(true);
      setError(null);
      try {
        const ok = await ensureReadPermission(handle);
        if (!ok) {
          setError('Permission to read the folder was denied.');
          return;
        }
        const files = await collectJsonlFiles(handle);
        if (files.length === 0) {
          setError('No .jsonl files found in that folder.');
          return;
        }
        await onFiles(files);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to scan folder');
      } finally {
        setIsScanning(false);
      }
    },
    [onFiles],
  );

  const pickFolder = useCallback(async () => {
    if (disabled || !supported) return;
    try {
      const handle = await pickProjectsDirectory();
      if (!handle) return;
      await rememberHandle(handle);
      setRememberedName(handle.name);
      await importFromHandle(handle);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to open folder picker');
    }
  }, [disabled, supported, importFromHandle]);

  const resumeFolder = useCallback(async () => {
    if (disabled || !supported) return;
    const handle = await getRememberedHandle();
    if (!handle) {
      setRememberedName(null);
      return;
    }
    await importFromHandle(handle);
  }, [disabled, supported, importFromHandle]);

  const forget = useCallback(async () => {
    await forgetHandle();
    setRememberedName(null);
  }, []);

  return {
    supported,
    rememberedName,
    isScanning,
    error,
    pickFolder,
    resumeFolder,
    forget,
  };
}

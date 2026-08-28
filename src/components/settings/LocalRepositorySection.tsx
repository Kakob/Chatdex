// Local repository directory for Change Workspace evidence search
// (SPEC-change-workspace §9, audit S11; CW-8). Chrome only (File System
// Access). Read-only; the handle and its file cache stay on this device.

import { useEffect, useState } from 'react';
import { FolderOpen, Trash2 } from 'lucide-react';
import {
  forgetLocalDirectory,
  getRememberedLocalDirectoryName,
  isDirectoryPickerSupported,
  pickLocalDirectory,
  rememberLocalDirectory,
} from '../../lib/repo/localDir';
import { countRepoFiles } from '../../lib/db/repoFiles';
import { LOCAL_SHA, localRepoKey } from '../../lib/repo/localDirSource';
import { useToastStore } from '../../stores/toastStore';

export function LocalRepositorySection() {
  const addToast = useToastStore((s) => s.addToast);
  const supported = isDirectoryPickerSupported();
  const [name, setName] = useState<string | null>(null);
  const [cached, setCached] = useState(0);

  const refresh = () =>
    getRememberedLocalDirectoryName().then(async (n) => {
      const count = n ? await countRepoFiles(localRepoKey(n), LOCAL_SHA) : 0;
      setName(n);
      setCached(count);
    });

  useEffect(() => {
    void refresh();
  }, []);

  const pick = async () => {
    try {
      const handle = await pickLocalDirectory();
      if (!handle) return;
      await rememberLocalDirectory(handle);
      await refresh();
      addToast(`Using ${handle.name}/ as a local read-only source`);
    } catch (err) {
      addToast(err instanceof Error ? err.message : String(err), 'error');
    }
  };

  const forget = async () => {
    const evicted = await forgetLocalDirectory();
    await refresh();
    addToast(`Forgot the directory${evicted ? ` and cleared ${evicted} cached file(s)` : ''}`);
  };

  return (
    <section className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6" data-testid="local-repository-section">
      <div className="flex items-center gap-3 mb-1">
        <FolderOpen size={20} className="text-violet-600 dark:text-violet-400" />
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Local repository (optional)</h2>
      </div>
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
        Point Change Workspace evidence search at a local clone instead of GitHub. Read-only: Chatdex never writes to the
        folder. Files are cached on this device only, sensitive paths and generated directories are skipped, and the
        snapshot is labelled <code>local</code> because a working tree has no pinned commit.
      </p>
      {!supported ? (
        <p className="text-xs text-amber-700 dark:text-amber-300">Your browser does not support the File System Access API (Chrome / Edge do).</p>
      ) : (
        <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-800 flex flex-wrap items-center gap-3 text-sm">
          <div className="flex-1 min-w-48 text-gray-700 dark:text-gray-300">
            {name ? (
              <>
                <span className="font-medium">{name}/</span>
                <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">{cached} file{cached === 1 ? '' : 's'} cached</span>
              </>
            ) : (
              <span className="text-gray-500 dark:text-gray-400">No directory picked. Pick a project folder — not your home directory.</span>
            )}
          </div>
          <button onClick={() => void pick()} className="px-3 py-1.5 text-xs bg-violet-600 hover:bg-violet-700 text-white rounded-lg">
            {name ? 'Pick another' : 'Pick directory'}
          </button>
          {name && (
            <button onClick={() => void forget()} title="Forget directory" className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200">
              <Trash2 size={12} /> Forget directory
            </button>
          )}
        </div>
      )}
    </section>
  );
}

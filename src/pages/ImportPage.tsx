import { FileArchive, FileCode, FolderOpen, RotateCw, X } from 'lucide-react';
import { DropZone, ImportProgress } from '../components/import';
import { useClaudeCodeFolder, useImport } from '../hooks';

export function ImportPage() {
  const { isImporting, progress, error, result, handleFiles, reset } = useImport();
  const folder = useClaudeCodeFolder({ onFiles: handleFiles, disabled: isImporting });

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-white mb-2">
          Import Data
        </h1>
        <p className="text-gray-600 dark:text-gray-400">
          Import your Claude conversations from Claude.ai or Claude Code
        </p>
      </div>

      {/* Show progress/result/error when importing */}
      {(isImporting || error || result) && (
        <div className="mb-6">
          <ImportProgress
            progress={progress}
            error={error}
            result={result}
            onReset={reset}
          />
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        {/* Claude.ai Import */}
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-violet-100 dark:bg-violet-900/30 rounded-lg">
              <FileArchive className="text-violet-600 dark:text-violet-400" size={24} />
            </div>
            <div>
              <h2 className="font-semibold text-gray-900 dark:text-white">
                Claude.ai
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                ZIP export from Settings
              </p>
            </div>
          </div>

          <DropZone
            onFiles={handleFiles}
            accept=".zip,.json"
            label="Drag & drop your ZIP file"
            hint="or click to browse"
            accentColor="violet"
            disabled={isImporting}
          />

          <p className="mt-4 text-xs text-gray-500 dark:text-gray-400">
            Export from Claude.ai: Settings → Privacy → Export Data
          </p>
        </div>

        {/* Claude Code Import */}
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-emerald-100 dark:bg-emerald-900/30 rounded-lg">
              <FileCode className="text-emerald-600 dark:text-emerald-400" size={24} />
            </div>
            <div>
              <h2 className="font-semibold text-gray-900 dark:text-white">
                Claude Code
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                JSONL log files
              </p>
            </div>
          </div>

          <DropZone
            onFiles={handleFiles}
            accept=".jsonl"
            multiple
            label="Drag & drop JSONL files"
            hint="or click to browse (multiple allowed)"
            accentColor="emerald"
            disabled={isImporting}
          />

          {folder.supported && (
            <div className="mt-4 space-y-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={folder.pickFolder}
                  disabled={isImporting || folder.isScanning}
                  className="flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <FolderOpen size={16} />
                  Select folder
                </button>
                {folder.rememberedName && (
                  <>
                    <button
                      type="button"
                      onClick={folder.resumeFolder}
                      disabled={isImporting || folder.isScanning}
                      className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg border border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 disabled:opacity-50 disabled:cursor-not-allowed"
                      title={`Re-scan "${folder.rememberedName}"`}
                    >
                      <RotateCw size={14} />
                      Resume "{folder.rememberedName}"
                    </button>
                    <button
                      type="button"
                      onClick={folder.forget}
                      disabled={isImporting || folder.isScanning}
                      className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 disabled:opacity-50"
                      title="Forget remembered folder"
                    >
                      <X size={14} />
                    </button>
                  </>
                )}
              </div>
              {folder.isScanning && (
                <p className="text-xs text-emerald-600 dark:text-emerald-400">
                  Scanning folder for .jsonl files…
                </p>
              )}
              {folder.error && (
                <p className="text-xs text-red-600 dark:text-red-400">{folder.error}</p>
              )}
            </div>
          )}

          <p className="mt-4 text-xs text-gray-500 dark:text-gray-400">
            Located at: ~/.claude/projects/
            {!folder.supported && (
              <span className="block mt-1">
                Tip: Chrome/Edge can pick the whole folder in one click.
              </span>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}

// GitHub token settings (SPEC-intent-trace §8.1). The token is device-local
// (never synced), sent only to api.github.com, and used read-only for
// Intent Trace. Saving runs a test call so an over-privileged classic token
// is flagged immediately.

import { useEffect, useState } from 'react';
import { CheckCircle, CircleAlert, Github, Loader2, Trash2 } from 'lucide-react';
import { getGitHubToken, setGitHubToken, clearGitHubToken } from '../../lib/github/credentials';
import { getTokenInfo, GitHubError, type TokenInfo } from '../../lib/github/client';
import { useToastStore } from '../../stores/toastStore';

type TestState = { kind: 'idle' } | { kind: 'testing' } | { kind: 'ok'; info: TokenInfo } | { kind: 'failed'; message: string };

export function GitHubSection() {
  const addToast = useToastStore((s) => s.addToast);
  const [hasToken, setHasToken] = useState(false);
  const [input, setInput] = useState('');
  const [test, setTest] = useState<TestState>({ kind: 'idle' });

  useEffect(() => {
    void getGitHubToken().then((t) => setHasToken(Boolean(t)));
  }, []);

  const runTest = async () => {
    const token = await getGitHubToken();
    if (!token) return;
    setTest({ kind: 'testing' });
    try {
      const info = await getTokenInfo({ token });
      setTest({ kind: 'ok', info });
    } catch (err) {
      const message =
        err instanceof GitHubError && err.status === 401
          ? 'Token rejected (401) — check it was pasted completely and has not expired.'
          : err instanceof Error
            ? err.message
            : String(err);
      setTest({ kind: 'failed', message });
    }
  };

  const handleSave = async () => {
    const token = input.trim();
    if (!token) return;
    await setGitHubToken(token);
    setInput('');
    setHasToken(true);
    addToast('GitHub token saved on this device');
    await runTest();
  };

  const handleClear = async () => {
    if (!confirm('Remove the GitHub token from this device?')) return;
    await clearGitHubToken();
    setHasToken(false);
    setTest({ kind: 'idle' });
    addToast('GitHub token removed');
  };

  return (
    <section className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6">
      <div className="flex items-center gap-3 mb-1">
        <Github size={20} className="text-violet-600 dark:text-violet-400" />
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">GitHub</h2>
      </div>
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
        Used by Intent Trace to read a project&apos;s repository and check what is implemented.
        Read-only. The token stays on this device (it is not synced) and is sent only to
        api.github.com — never to Chatdex&apos;s relay or to an LLM provider.
      </p>

      <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-800 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-32 text-xs text-gray-500 dark:text-gray-400">
            {hasToken ? (
              <span className="inline-flex items-center gap-1 text-green-600 dark:text-green-400">
                <CheckCircle size={12} /> configured
              </span>
            ) : (
              'no token'
            )}
          </div>
          <input
            type="password"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleSave();
            }}
            placeholder={hasToken ? 'Replace token…' : 'github_pat_… or ghp_…'}
            aria-label="GitHub token"
            className="flex-1 min-w-48 px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
          />
          <button
            onClick={() => void handleSave()}
            disabled={!input.trim()}
            className="px-3 py-1.5 text-xs bg-violet-600 hover:bg-violet-700 text-white rounded-lg transition-colors disabled:opacity-50"
          >
            Save
          </button>
          {hasToken && (
            <>
              <button
                onClick={() => void runTest()}
                disabled={test.kind === 'testing'}
                className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50"
              >
                Test
              </button>
              <button
                onClick={() => void handleClear()}
                title="Remove token"
                className="p-1.5 text-gray-400 hover:text-red-500 transition-colors"
              >
                <Trash2 size={14} />
              </button>
            </>
          )}
        </div>

        {test.kind === 'testing' && (
          <div className="inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
            <Loader2 size={12} className="animate-spin" /> checking token…
          </div>
        )}
        {test.kind === 'ok' && (
          <div className="space-y-1 text-xs">
            <div className="inline-flex items-center gap-1 text-green-600 dark:text-green-400">
              <CheckCircle size={12} /> works — signed in as {test.info.login}
              {test.info.scopes.length === 0 && ' (fine-grained token)'}
            </div>
            {test.info.overPrivileged && (
              <div className="flex items-start gap-1 text-amber-600 dark:text-amber-400">
                <CircleAlert size={12} className="mt-0.5 shrink-0" />
                <span>
                  Over-privileged: this classic token grants write access (
                  {test.info.scopes.join(', ')}). Intent Trace only reads. Prefer a fine-grained
                  token limited to the one repository with Contents: Read and Metadata: Read.
                </span>
              </div>
            )}
          </div>
        )}
        {test.kind === 'failed' && (
          <div className="inline-flex items-start gap-1 text-xs text-amber-600 dark:text-amber-400">
            <CircleAlert size={12} className="mt-0.5 shrink-0" /> {test.message}
          </div>
        )}

        <p className="text-xs text-gray-500 dark:text-gray-400">
          Recommended: a fine-grained personal access token scoped to the one repository, with
          permissions <span className="font-medium">Contents: Read</span> and{' '}
          <span className="font-medium">Metadata: Read</span>, expiring within 90 days. Public
          repositories also work without a token (60 requests/hour).
        </p>
      </div>
    </section>
  );
}

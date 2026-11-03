// Change Workspace — What I Learned + Close (SPEC-change-workspace §12, §7.1;
// PRD §15; CW-5). Human-authored (law §2.3): an AI suggestion, when one
// exists, sits in a visibly separate slot and is only copied in by hand.

import { useEffect, useState } from 'react';
import { Archive, GraduationCap, Loader2, Save } from 'lucide-react';
import { closeWorkspace, updateLearned } from '../../lib/prepare/lifecycle';
import { editabilityOf } from '../../lib/prepare/editability';
import { useToastStore } from '../../stores/toastStore';
import type { PreparedChange } from '../../types/preparedChange';

interface Props {
  change: PreparedChange;
  onChanged: (change: PreparedChange) => Promise<void>;
}

export function LearnedSection({ change, onChanged }: Props) {
  const addToast = useToastStore((s) => s.addToast);
  const editability = editabilityOf(change, 'learned');
  const editable = editability === 'editable';
  const [text, setText] = useState(change.learned?.text ?? '');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setText(change.learned?.text ?? '');
  }, [change.id, change.learned?.text]);

  const run = async (fn: () => Promise<PreparedChange>, message: string) => {
    setBusy(true);
    try {
      const updated = await fn();
      await onChanged(updated);
      addToast(message);
    } catch (err) {
      addToast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const dirty = text.trim() !== (change.learned?.text ?? '');

  return (
    <section className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
      <div className="flex flex-wrap items-center gap-3 px-5 py-4 border-b border-gray-100 dark:border-gray-800">
        <GraduationCap size={16} className="text-violet-600 dark:text-violet-400" />
        <h2 className="font-semibold text-gray-900 dark:text-white">What I learned</h2>
        <span className="text-xs text-gray-400">What do you now understand that you did not before this change?</span>
        {editable && change.state === 'verified' && (
          <button
            type="button"
            onClick={() => void run(() => closeWorkspace(change.id), 'Workspace closed')}
            disabled={busy || dirty || !change.learned?.text.trim()}
            title={!change.learned?.text.trim() ? 'Write what you learned first' : dirty ? 'Save first' : 'Close the workspace'}
            className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 disabled:opacity-50"
          >
            <Archive size={14} /> Close workspace
          </button>
        )}
      </div>

      <div className="p-5 space-y-3">
        {editability === 'unavailable' && (
          <p className="text-xs text-gray-400">Opens once an implementation is attached.</p>
        )}
        {editability !== 'unavailable' && (
          <>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              disabled={!editable}
              rows={5}
              placeholder="e.g. Search navigation carries conversation identity through the route. Message scrolling belongs to ConversationsPage, which waits until messages have rendered before locating the target element."
              aria-label="What I learned"
              className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100 text-sm disabled:opacity-75"
            />
            {editable && (
              <button
                type="button"
                onClick={() => void run(() => updateLearned(change.id, text), 'Saved')}
                disabled={busy || !dirty}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-violet-600 text-white disabled:opacity-50"
              >
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save
              </button>
            )}
            {change.learned?.aiSuggested && (
              <div className="rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50/50 dark:bg-amber-900/10 p-3 text-xs" data-testid="ai-suggested">
                <p className="font-medium text-amber-800 dark:text-amber-300">AI suggestion (not your words until you copy it)</p>
                <p className="mt-1 whitespace-pre-wrap text-gray-700 dark:text-gray-300">{change.learned.aiSuggested}</p>
                {editable && (
                  <button type="button" onClick={() => setText(change.learned?.aiSuggested ?? '')} className="mt-2 underline text-amber-800 dark:text-amber-300">
                    Copy into my explanation
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

// Change Workspace — My Hypothesis section (SPEC-change-workspace §7.1, §2.4;
// PRD §12; CW-3). Human-authored (law §2.3). The open hypothesis is editable
// until an implementation is attached; from then on it is frozen and shown
// beside later hypotheses so expectation can be compared with outcome.

import { useState } from 'react';
import { Lightbulb, Loader2, Lock, Plus, Save } from 'lucide-react';
import { addHypothesis, editOpenHypothesis } from '../../lib/prepare/lifecycle';
import { canAppend } from '../../lib/prepare/editability';
import { useToastStore } from '../../stores/toastStore';
import type { Hypothesis, PreparedChange } from '../../types/preparedChange';

interface Props {
  change: PreparedChange;
  onChanged: (change: PreparedChange) => Promise<void>;
}

const TEMPLATE = `I think ______ happens because ______.
The evidence supporting this is ______.
I expect changing ______ to cause ______.`;

export function HypothesisSection({ change, onChanged }: Props) {
  const addToast = useToastStore((s) => s.addToast);
  const appendable = canAppend(change, 'hypotheses');
  const hypotheses = change.hypotheses ?? [];
  const open = hypotheses.find((h) => !h.frozenAt) ?? null;
  const frozen = hypotheses.filter((h) => h.frozenAt);
  const [draft, setDraft] = useState(open?.text ?? '');
  const [busy, setBusy] = useState(false);

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

  return (
    <section className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
      <div className="flex flex-wrap items-center gap-3 px-5 py-4 border-b border-gray-100 dark:border-gray-800">
        <Lightbulb size={16} className="text-violet-600 dark:text-violet-400" />
        <h2 className="font-semibold text-gray-900 dark:text-white">My Hypothesis</h2>
        <span className="text-xs text-gray-400">
          {frozen.length > 0
            ? `${frozen.length} frozen · timestamped before implementation`
            : 'timestamped and frozen when an implementation is attached'}
        </span>
      </div>

      <div className="p-5 space-y-4">
        {frozen.map((h) => (
          <FrozenHypothesis key={h.id} hypothesis={h} />
        ))}

        {appendable ? (
          <div className="space-y-2">
            <label className="block text-sm text-gray-700 dark:text-gray-300">
              <span className="block mb-1 font-medium">{open ? 'Open hypothesis' : frozen.length ? 'New hypothesis' : 'Hypothesis'}</span>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={5}
                placeholder={TEMPLATE}
                aria-label="Hypothesis text"
                className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100 font-mono text-sm"
              />
            </label>
            <div className="flex flex-wrap items-center gap-2">
              {open ? (
                <button
                  type="button"
                  disabled={busy || draft.trim() === open.text}
                  onClick={() => void run(() => editOpenHypothesis(change.id, open.id, draft), 'Hypothesis updated')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-violet-600 text-white disabled:opacity-50"
                >
                  {busy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save hypothesis
                </button>
              ) : (
                <button
                  type="button"
                  disabled={busy || !draft.trim()}
                  onClick={() =>
                    void run(async () => {
                      const updated = await addHypothesis(change.id, draft);
                      setDraft('');
                      return updated;
                    }, 'Hypothesis recorded')
                  }
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-violet-600 text-white disabled:opacity-50"
                >
                  {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Record hypothesis
                </button>
              )}
              <span className="text-xs text-gray-400">
                Written by you. Assisted mode may only suggest; it never writes here.
              </span>
            </div>
          </div>
        ) : (
          !frozen.length && <p className="text-xs text-gray-400">No hypothesis was recorded.</p>
        )}
      </div>
    </section>
  );
}

function FrozenHypothesis({ hypothesis }: { hypothesis: Hypothesis }) {
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-950 p-3" data-testid="frozen-hypothesis">
      <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
        <Lock size={12} />
        <span>
          recorded {new Date(hypothesis.createdAt).toLocaleString()} · frozen {hypothesis.frozenAt ? new Date(hypothesis.frozenAt).toLocaleString() : ''}
        </span>
        <span className="ml-auto">{hypothesis.origin === 'ai' ? 'AI-drafted, accepted by you' : 'you'}</span>
      </div>
      <pre className="mt-2 whitespace-pre-wrap font-sans text-sm text-gray-900 dark:text-gray-100">{hypothesis.text}</pre>
    </div>
  );
}

// Change Workspace — Questions (SPEC-change-workspace §12; PRD §21; CW-5).
// Unknowns are first-class UnderstandingObjects (type 'question') linked to
// the workspace; they appear in Current Understanding and can seed a new
// workspace (`/prepare?question=<id>`).

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { HelpCircle, Loader2, Plus } from 'lucide-react';
import { createWorkspaceQuestion, questionsForWorkspace } from '../../lib/prepare/promote';
import { canAppend } from '../../lib/prepare/editability';
import { useToastStore } from '../../stores/toastStore';
import type { PreparedChange } from '../../types/preparedChange';
import type { UnderstandingObject } from '../../types/understanding';

interface Props {
  change: PreparedChange;
  onChanged: (change: PreparedChange) => Promise<void>;
}

export function QuestionsSection({ change, onChanged }: Props) {
  const addToast = useToastStore((s) => s.addToast);
  const appendable = canAppend(change, 'questions');
  const [questions, setQuestions] = useState<UnderstandingObject[]>([]);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void questionsForWorkspace(change).then((rows) => !cancelled && setQuestions(rows));
    return () => {
      cancelled = true;
    };
  }, [change]);

  const add = async () => {
    setBusy(true);
    try {
      const { change: updated } = await createWorkspaceQuestion(change.id, { title, body });
      setTitle('');
      setBody('');
      await onChanged(updated);
      addToast('Question recorded in Current Understanding');
    } catch (err) {
      addToast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
      <div className="flex flex-wrap items-center gap-3 px-5 py-4 border-b border-gray-100 dark:border-gray-800">
        <HelpCircle size={16} className="text-violet-600 dark:text-violet-400" />
        <h2 className="font-semibold text-gray-900 dark:text-white">Open questions</h2>
        <span className="text-xs text-gray-400">what you still do not know — preserved, not papered over</span>
      </div>

      <div className="p-5 space-y-3">
        {questions.length === 0 ? (
          <p className="text-xs text-gray-400">No questions recorded from this workspace.</p>
        ) : (
          <ul className="space-y-2" data-testid="question-list">
            {questions.map((q) => (
              <li key={q.id} className="rounded-lg border border-gray-200 dark:border-gray-800 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-gray-900 dark:text-white">{q.title}</span>
                  <span className={`px-1.5 py-0.5 rounded text-[10px] ${q.status === 'current' ? 'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300' : 'bg-gray-100 dark:bg-gray-800 text-gray-500'}`}>
                    {q.status === 'current' ? 'open' : q.status}
                  </span>
                  {q.projectId && (
                    <Link to={`/projects/${q.projectId}/prepare?question=${encodeURIComponent(q.id)}`} className="ml-auto text-xs text-violet-600 dark:text-violet-400 underline">
                      start a workspace from this
                    </Link>
                  )}
                </div>
                {q.body && <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">{q.body}</p>}
              </li>
            ))}
          </ul>
        )}

        {appendable && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg bg-gray-50 dark:bg-gray-950 p-3">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && title.trim() && void add()}
              placeholder="e.g. What happens if the target message has been deleted?"
              aria-label="New question"
              className="flex-1 min-w-64 px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
            />
            <input
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="context (optional)"
              aria-label="Question context"
              className="flex-1 min-w-48 px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
            />
            <button
              type="button"
              onClick={() => void add()}
              disabled={busy || !title.trim()}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 disabled:opacity-50"
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Add question
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

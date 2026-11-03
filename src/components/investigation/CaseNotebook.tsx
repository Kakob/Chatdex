// Case notebook region (SPEC-decision-investigation §8.3–§8.7, DI-2c).
// Everything here is either the user's own writing (clearly labeled) or
// literal source material. No field is ever prefilled with generated prose —
// the title starts from a deterministic literal template the user may edit.

import { useState } from 'react';
import { Pin, Trash2 } from 'lucide-react';
import type { UseInvestigationCaseResult } from '../../hooks/useInvestigationCase';
import { captureTranscriptSelection } from '../../lib/investigation/selection';
import { VerdictPanel } from './VerdictPanel';
import type { CaseExhibit, InvestigationAnchor } from '../../types/investigation';

interface CaseNotebookProps {
  anchor: InvestigationAnchor;
  stepCount: number;
  focusedStep: number;
  focusedStepTextLength: number;
  caseApi: UseInvestigationCaseResult;
  onJumpToStep: (stepIndex: number) => void;
  investigateBasePath?: string;
}

const EXHIBIT_KIND_LABELS: Record<CaseExhibit['kind'], string> = {
  transcript_span: 'Transcript',
  tool_event: 'Tool event',
  code_span: 'Code',
};

export function CaseNotebook({
  anchor,
  stepCount,
  focusedStep,
  focusedStepTextLength,
  caseApi,
  onJumpToStep,
  investigateBasePath = '/investigate',
}: CaseNotebookProps) {
  const {
    caseRow,
    exhibits,
    scopes,
    resolutions,
    error,
    clearError,
    start,
    saveTitle,
    saveNotes,
    pinSelection,
    pinWholeStep,
    pinCodeEvent,
    removeExhibit,
    saveExhibitNote,
    confirmScope,
    removeScope,
  } = caseApi;

  // Local edits are a draft keyed to the case they belong to; when the case
  // changes (or a save round-trips), display derives from the stored row —
  // no state-syncing effect needed.
  const [draft, setDraft] = useState<{
    caseId: string;
    title: string;
    notes: string;
  } | null>(null);
  const [scopeStart, setScopeStart] = useState('');
  const [scopeEnd, setScopeEnd] = useState('');
  const [pinHint, setPinHint] = useState<string | null>(null);

  const activeDraft = draft && caseRow && draft.caseId === caseRow.id ? draft : null;
  const title = activeDraft?.title ?? caseRow?.title ?? '';
  const notes = activeDraft?.notes ?? caseRow?.notes ?? '';
  const editable = caseRow ? caseRow.state !== 'adjudicated' : false;
  const editDraft = (patch: Partial<{ title: string; notes: string }>) => {
    if (!caseRow) return;
    setDraft({ caseId: caseRow.id, title, notes, ...patch });
  };

  if (!caseRow) {
    return (
      <div>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
          No case yet for this change event. Starting an investigation creates a
          draft case — your question, pinned evidence, reviewed ranges, and
          eventually your verdict.
        </p>
        <button
          type="button"
          onClick={() => void start()}
          className="px-3 py-1.5 text-sm rounded-lg bg-violet-600 text-white hover:bg-violet-700"
        >
          Start investigation
        </button>
        {error && <ErrorLine message={error} onDismiss={clearError} />}
      </div>
    );
  }

  const pinCurrentSelection = () => {
    const selection = captureTranscriptSelection();
    if (!selection) {
      setPinHint(
        'Select text inside a single transcript event first (cross-event selections pin as separate exhibits).'
      );
      return;
    }
    setPinHint(null);
    void pinSelection(selection);
  };

  // Keyboard-accessible alternative to pointer selection (spec §13).
  const pinFocused = () => {
    setPinHint(null);
    void pinWholeStep(focusedStep, focusedStepTextLength);
  };

  return (
    <div className="space-y-4">
      <div>
        <label
          htmlFor="case-title"
          className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1"
        >
          Your question (editable)
        </label>
        <input
          id="case-title"
          type="text"
          value={title}
          disabled={!editable}
          onChange={(e) => editDraft({ title: e.target.value })}
          onBlur={() => {
            if (title !== caseRow.title) void saveTitle(title);
          }}
          className="w-full px-2 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
        />
        <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
          Case state: {caseRow.state} · {caseRow.searchRecords.length} recorded search
          {caseRow.searchRecords.length === 1 ? '' : 'es'}
        </p>
      </div>

      <div>
        <label
          htmlFor="case-notes"
          className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1"
        >
          Your notes (not source evidence)
        </label>
        <textarea
          id="case-notes"
          value={notes}
          disabled={!editable}
          onChange={(e) => editDraft({ notes: e.target.value })}
          onBlur={() => {
            if (notes !== caseRow.notes) void saveNotes(notes);
          }}
          rows={3}
          className="w-full px-2 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
        />
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-xs font-medium text-gray-700 dark:text-gray-300">
            Exhibits ({exhibits.length})
          </h3>
        </div>
        {editable && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            <NotebookButton onClick={pinCurrentSelection} icon={<Pin size={12} />}>
              Pin selection
            </NotebookButton>
            <NotebookButton
              onClick={pinFocused}
              icon={<Pin size={12} />}
              disabled={focusedStepTextLength === 0}
            >
              Pin step #{focusedStep}
            </NotebookButton>
            <NotebookButton onClick={() => void pinCodeEvent()} icon={<Pin size={12} />}>
              Pin this code event
            </NotebookButton>
          </div>
        )}
        {pinHint && (
          <p className="text-xs text-amber-600 dark:text-amber-400 mb-1.5">{pinHint}</p>
        )}
        {exhibits.length === 0 ? (
          <p className="text-xs text-gray-400 dark:text-gray-500">
            Select text in the transcript and pin it, or pin the code event itself.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {exhibits.map((exhibit) => {
              const resolution = resolutions.get(exhibit.id);
              const mismatch = resolution?.status === 'source_mismatch';
              const text =
                resolution?.status === 'ok' ? resolution.text : exhibit.selectedText;
              return (
                <li
                  key={exhibit.id}
                  className="rounded-lg border border-gray-200 dark:border-gray-800 px-2 py-1.5"
                >
                  <div className="flex items-center gap-2 text-xs mb-0.5">
                    <span className="px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300">
                      {EXHIBIT_KIND_LABELS[exhibit.kind]}
                    </span>
                    <button
                      type="button"
                      onClick={() => onJumpToStep(exhibit.stepIndex)}
                      className="text-violet-600 dark:text-violet-400 hover:underline"
                    >
                      step #{exhibit.stepIndex}
                    </button>
                    {exhibit.filePath && (
                      <span className="font-mono text-gray-500 dark:text-gray-400 truncate">
                        {exhibit.filePath}
                      </span>
                    )}
                    {mismatch && (
                      <span
                        className="px-1.5 py-0.5 rounded-full bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300"
                        title="The stored source no longer matches this exhibit's hash; showing the cached copy"
                      >
                        Source mismatch
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => void removeExhibit(exhibit.id)}
                      className="ml-auto text-gray-400 hover:text-red-500"
                      aria-label="Remove exhibit"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                  <p className="font-mono text-xs text-gray-700 dark:text-gray-300 line-clamp-2 whitespace-pre-wrap break-words">
                    {text}
                  </p>
                  <ExhibitNote
                    exhibitId={exhibit.id}
                    note={exhibit.humanNote ?? ''}
                    editable={editable}
                    onSave={(value) => void saveExhibitNote(exhibit.id, value)}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div>
        <h3 className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
          Reviewed ranges ({scopes.length})
        </h3>
        <div className={`${editable ? 'flex' : 'hidden'} items-center gap-1.5 mb-2`}>
          <input
            type="number"
            min={0}
            max={stepCount - 1}
            value={scopeStart}
            onChange={(e) => setScopeStart(e.target.value)}
            placeholder="from #"
            aria-label="Reviewed range start step"
            className="w-20 px-2 py-1 text-xs rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
          />
          <input
            type="number"
            min={0}
            max={stepCount - 1}
            value={scopeEnd}
            onChange={(e) => setScopeEnd(e.target.value)}
            placeholder="to #"
            aria-label="Reviewed range end step"
            className="w-20 px-2 py-1 text-xs rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
          />
          <button
            type="button"
            disabled={scopeStart === '' || scopeEnd === ''}
            onClick={() => {
              void confirmScope(Number(scopeStart), Number(scopeEnd));
              setScopeStart('');
              setScopeEnd('');
            }}
            className="px-2 py-1 text-xs rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            I reviewed this range
          </button>
        </div>
        <p className="text-xs text-gray-400 dark:text-gray-500 mb-1.5">
          Only you can mark events reviewed — scrolling past them never counts.
        </p>
        {scopes.length > 0 && (
          <ul className="space-y-1">
            {scopes.map((scope) => (
              <li
                key={scope.id}
                className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                <button
                  type="button"
                  onClick={() => onJumpToStep(scope.startStepIndex)}
                  className="hover:underline"
                >
                  steps #{scope.startStepIndex}–{scope.endStepIndex}
                </button>
                <span className="text-gray-400 dark:text-gray-500">
                  ({scope.eventCount} events · confirmed{' '}
                  {scope.humanConfirmedAt.toLocaleString()})
                </span>
                <button
                  type="button"
                  onClick={() => void removeScope(scope.id)}
                  className="ml-auto text-gray-400 hover:text-red-500"
                  aria-label="Remove reviewed range"
                >
                  <Trash2 size={12} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="pt-3 border-t border-gray-100 dark:border-gray-800">
        <VerdictPanel
          anchor={anchor}
          caseApi={caseApi}
          investigateBasePath={investigateBasePath}
        />
      </div>

      {error && <ErrorLine message={error} onDismiss={clearError} />}
    </div>
  );
}

function ExhibitNote({
  exhibitId,
  note,
  editable,
  onSave,
}: {
  exhibitId: string;
  note: string;
  editable: boolean;
  onSave: (value: string) => void;
}) {
  const [draft, setDraft] = useState<{ id: string; text: string } | null>(null);
  const value = draft?.id === exhibitId ? draft.text : note;

  if (!editable) {
    return note ? (
      <p className="mt-1 text-xs italic text-gray-500 dark:text-gray-400">
        Your note: {note}
      </p>
    ) : null;
  }
  return (
    <input
      type="text"
      value={value}
      placeholder="Your note (optional)…"
      aria-label="Your note on this exhibit"
      onChange={(e) => setDraft({ id: exhibitId, text: e.target.value })}
      onBlur={() => {
        if (value !== note) onSave(value);
      }}
      className="mt-1 w-full px-1.5 py-0.5 text-xs italic rounded border border-gray-200 dark:border-gray-700 bg-transparent text-gray-600 dark:text-gray-300"
    />
  );
}

function NotebookButton({
  onClick,
  icon,
  disabled,
  children,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-1 px-2 py-1 text-xs rounded-lg border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
    >
      {icon}
      {children}
    </button>
  );
}

function ErrorLine({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <p className="text-xs text-red-600 dark:text-red-400">
      {message}{' '}
      <button type="button" onClick={onDismiss} className="underline">
        dismiss
      </button>
    </p>
  );
}

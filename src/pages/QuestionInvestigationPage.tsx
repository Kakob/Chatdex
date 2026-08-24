import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Check,
  ExternalLink,
  FileText,
  Pin,
  Search,
} from 'lucide-react';
import { getConversation } from '../lib/db/conversations';
import {
  getExhibitsForCase,
  getFindingsForCase,
  getInvestigationCase,
  getScopesForCase,
} from '../lib/db/investigationCases';
import { getMessagesForConversation } from '../lib/db/messages';
import { normalizeSession, type Step } from '../lib/detection/normalize';
import {
  completeQuestionInvestigation,
  confirmReviewScope,
  pinTranscriptExhibit,
  recordCaseSearch,
  reopenQuestionInvestigation,
  updateCaseHumanFields,
} from '../lib/investigation/cases';
import {
  createInvestigationFinding,
  finalizeInvestigationFinding,
  promoteFindingToCurrentUnderstanding,
} from '../lib/investigation/findings';
import {
  searchStepTexts,
  stepDisplayText,
  type StepSearchMatch,
} from '../lib/investigation/search';
import { useToastStore } from '../stores/toastStore';
import type { StoredConversation } from '../types';
import type {
  CaseExhibit,
  InvestigationCase,
  InvestigationFinding,
  InvestigationFindingType,
  ReviewScope,
  VerdictConfidence,
} from '../types/investigation';

interface InvestigationData {
  investigation: InvestigationCase;
  conversation: StoredConversation;
  steps: Step[];
  exhibits: CaseExhibit[];
  scopes: ReviewScope[];
  findings: InvestigationFinding[];
}

const inputClass =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100';

const FINDING_TYPES: Array<{ value: InvestigationFindingType; label: string }> = [
  { value: 'belief', label: 'Belief' },
  { value: 'decision', label: 'Decision' },
  { value: 'constraint', label: 'Constraint' },
  { value: 'consequence', label: 'Consequence' },
  { value: 'question', label: 'Open question' },
];

const STEP_LABELS: Record<Step['kind'], string> = {
  user_msg: 'User',
  agent_text: 'Assistant',
  tool_call: 'Tool call',
  tool_result: 'Tool result',
};

export function QuestionInvestigationPage() {
  const { id: projectId, caseId } = useParams<{ id: string; caseId: string }>();
  const addToast = useToastStore((state) => state.addToast);
  const [data, setData] = useState<InvestigationData | null>(null);
  const [loadedCaseId, setLoadedCaseId] = useState<string | null>(null);
  const [caseTitle, setCaseTitle] = useState('');
  const [caseNotes, setCaseNotes] = useState('');
  const [query, setQuery] = useState('');
  const [executedQuery, setExecutedQuery] = useState('');
  const [reviewStart, setReviewStart] = useState('1');
  const [reviewEnd, setReviewEnd] = useState('1');
  const [findingType, setFindingType] = useState<InvestigationFindingType>('belief');
  const [findingConfidence, setFindingConfidence] = useState<VerdictConfidence>('medium');
  const [findingTitle, setFindingTitle] = useState('');
  const [findingBody, setFindingBody] = useState('');
  const [selectedExhibitIds, setSelectedExhibitIds] = useState<Set<string>>(new Set());
  const [selectedScopeIds, setSelectedScopeIds] = useState<Set<string>>(new Set());
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!projectId || !caseId) return;
    const investigation = await getInvestigationCase(caseId);
    if (
      !investigation ||
      investigation.projectId !== projectId ||
      investigation.kind !== 'question'
    ) {
      setData(null);
      setLoadedCaseId(caseId);
      return;
    }
    const [conversation, messages, exhibits, scopes, findings] = await Promise.all([
      getConversation(investigation.conversationId),
      getMessagesForConversation(investigation.conversationId),
      getExhibitsForCase(caseId),
      getScopesForCase(caseId),
      getFindingsForCase(caseId),
    ]);
    if (!conversation) {
      setData(null);
      setLoadedCaseId(caseId);
      return;
    }
    const steps = normalizeSession(conversation.id, messages).steps;
    setData({ investigation, conversation, steps, exhibits, scopes, findings });
    setCaseTitle(investigation.title);
    setCaseNotes(investigation.notes);
    setReviewEnd((current) =>
      current === '1' || Number(current) > steps.length ? String(Math.max(steps.length, 1)) : current
    );
    setLoadedCaseId(caseId);
  }, [caseId, projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const displayTexts = useMemo(
    () => data?.steps.map((step) => stepDisplayText(step)) ?? [],
    [data]
  );
  const matches = useMemo(
    () => searchStepTexts(displayTexts, executedQuery),
    [displayTexts, executedQuery]
  );
  const matchesByStep = useMemo(() => {
    const grouped = new Map<number, StepSearchMatch[]>();
    for (const match of matches) {
      grouped.set(match.stepIndex, [...(grouped.get(match.stepIndex) ?? []), match]);
    }
    return grouped;
  }, [matches]);
  const visibleSteps = useMemo(() => {
    if (!data) return [];
    if (!executedQuery.trim()) return data.steps;
    const matchingIndexes = new Set(matches.map((match) => match.stepIndex));
    return data.steps.filter((step) => matchingIndexes.has(step.index));
  }, [data, executedQuery, matches]);

  const isEditable = Boolean(
    data && data.investigation.state !== 'completed' && data.investigation.state !== 'adjudicated'
  );

  const runAction = async (key: string, action: () => Promise<void>, success?: string) => {
    setBusyAction(key);
    try {
      await action();
      if (success) addToast(success);
      await load();
    } catch (error) {
      addToast(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      setBusyAction(null);
    }
  };

  const handleSearch = async () => {
    if (!data) return;
    const literalQuery = query.trim();
    setExecutedQuery(literalQuery);
    if (!literalQuery || !isEditable) return;
    const resultCount = searchStepTexts(displayTexts, literalQuery).length;
    await runAction(
      'search',
      async () => {
        await recordCaseSearch(data.investigation.id, {
          query: literalQuery,
          resultCount,
        });
      },
      `Recorded literal search · ${resultCount} match${resultCount === 1 ? '' : 'es'}`
    );
  };

  const handleSaveCase = async () => {
    if (!data) return;
    await runAction(
      'case',
      async () => {
        await updateCaseHumanFields(data.investigation.id, {
          title: caseTitle,
          notes: caseNotes,
        });
      },
      'Investigation notes saved'
    );
  };

  const handlePin = async (step: Step) => {
    if (!data) return;
    const text = stepDisplayText(step);
    if (!text) {
      addToast('This source event has no displayable text to pin', 'error');
      return;
    }
    await runAction(
      `pin:${step.index}`,
      async () => {
        await pinTranscriptExhibit(data.investigation.id, {
          stepIndex: step.index,
          startOffset: 0,
          endOffset: text.length,
        });
      },
      `Pinned event ${step.index + 1}`
    );
  };

  const handleConfirmReview = async () => {
    if (!data) return;
    await runAction(
      'scope',
      async () => {
        await confirmReviewScope(data.investigation.id, {
          startStepIndex: Number(reviewStart) - 1,
          endStepIndex: Number(reviewEnd) - 1,
        });
      },
      'Reviewed range confirmed'
    );
  };

  const handleCreateFinding = async () => {
    if (!data) return;
    await runAction(
      'finding:new',
      async () => {
        await createInvestigationFinding({
          caseId: data.investigation.id,
          type: findingType,
          title: findingTitle,
          body: findingBody,
          confidence: findingConfidence,
          exhibitIds: [...selectedExhibitIds],
          reviewScopeIds: [...selectedScopeIds],
        });
        setFindingTitle('');
        setFindingBody('');
        setSelectedExhibitIds(new Set());
        setSelectedScopeIds(new Set());
      },
      'Finding saved as draft'
    );
  };

  const toggleSelected = (
    setter: Dispatch<SetStateAction<Set<string>>>,
    id: string
  ) => {
    setter((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (loadedCaseId !== caseId) {
    return <p className="text-sm text-gray-500 dark:text-gray-400">Loading investigation…</p>;
  }

  if (!data || !projectId) {
    return (
      <div className="space-y-3">
        <p className="text-gray-700 dark:text-gray-300">
          This project investigation was not found or its primary source was removed.
        </p>
        <Link
          to={projectId ? `/projects/${projectId}/investigate` : '/projects'}
          className="text-violet-600 hover:underline dark:text-violet-400"
        >
          Back to Investigate History
        </Link>
      </div>
    );
  }

  const { investigation, conversation, exhibits, scopes, findings, steps } = data;
  const pinnedSteps = new Set(exhibits.map((exhibit) => exhibit.stepIndex));
  const finalizedCount = findings.filter((finding) => finding.state === 'finalized').length;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start gap-3">
        <Link
          to={`/projects/${projectId}/investigate`}
          className="mt-1 flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
        >
          <ArrowLeft size={15} /> Investigate History
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">
              Human-led investigation
            </span>
            <span className="text-xs uppercase tracking-wide text-gray-400">
              {investigation.state}
            </span>
          </div>
          <h1 className="mt-1 text-xl font-semibold text-gray-900 dark:text-white">
            {investigation.title}
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Primary source: {conversation.name} · {steps.length} source event
            {steps.length === 1 ? '' : 's'}
          </p>
        </div>
        <Link
          to={`/conversations/${conversation.id}`}
          className="flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
        >
          <ExternalLink size={14} /> Open full source
        </Link>
      </header>

      {investigation.state === 'completed' && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm dark:border-emerald-900/60 dark:bg-emerald-950/20">
          <span className="text-emerald-800 dark:text-emerald-300">
            Completed with {finalizedCount} finalized finding
            {finalizedCount === 1 ? '' : 's'}. Reopen it to add evidence or findings.
          </span>
          <button
            type="button"
            onClick={() =>
              void runAction(
                'reopen',
                async () => {
                  await reopenQuestionInvestigation(investigation.id);
                },
                'Investigation reopened'
              )
            }
            disabled={busyAction !== null}
            className="font-medium text-emerald-800 hover:underline disabled:opacity-50 dark:text-emerald-300"
          >
            Reopen investigation
          </button>
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.8fr)_minmax(20rem,0.95fr)]">
        <section className="min-w-0 rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
          <div className="border-b border-gray-200 p-4 dark:border-gray-800">
            <div className="flex items-center gap-2">
              <FileText size={17} className="text-violet-500" />
              <h2 className="font-semibold text-gray-900 dark:text-white">Primary source</h2>
            </div>
            <form
              className="mt-3 flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void handleSearch();
              }}
            >
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Literal search—no rewriting or ranking"
                aria-label="Literal source search"
                className={inputClass}
              />
              <button
                type="submit"
                disabled={!query.trim() || busyAction === 'search'}
                className="flex items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white"
              >
                <Search size={14} /> Search
              </button>
            </form>
            {executedQuery && (
              <div className="mt-2 flex items-center justify-between gap-3 text-xs text-gray-500 dark:text-gray-400">
                <span>
                  {matches.length} exact match{matches.length === 1 ? '' : 'es'} in{' '}
                  {visibleSteps.length} event{visibleSteps.length === 1 ? '' : 's'}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setQuery('');
                    setExecutedQuery('');
                  }}
                  className="font-medium text-violet-600 hover:underline dark:text-violet-400"
                >
                  Show full chronology
                </button>
              </div>
            )}
          </div>

          <div className="max-h-[62rem] space-y-3 overflow-y-auto p-4">
            {visibleSteps.length === 0 ? (
              <p className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">
                {steps.length === 0 ? 'This source contains no readable events.' : 'No literal matches.'}
              </p>
            ) : (
              visibleSteps.map((step) => {
                const text = stepDisplayText(step);
                const pinned = pinnedSteps.has(step.index);
                return (
                  <article
                    key={`${step.messageId}:${step.index}`}
                    className="rounded-lg border border-gray-200 bg-gray-50/60 p-3 dark:border-gray-800 dark:bg-gray-950/40"
                  >
                    <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-medium text-gray-700 dark:text-gray-300">
                        Event {step.index + 1} · {STEP_LABELS[step.kind]}
                        {step.toolName ? ` · ${step.toolName}` : ''}
                      </span>
                      <button
                        type="button"
                        onClick={() => void handlePin(step)}
                        disabled={!isEditable || !text || pinned || busyAction !== null}
                        className="ml-auto flex items-center gap-1 font-medium text-violet-600 hover:underline disabled:text-gray-400 disabled:no-underline dark:text-violet-400"
                      >
                        {pinned ? <Check size={13} /> : <Pin size={13} />}
                        {pinned ? 'Pinned' : 'Pin exact event'}
                      </button>
                    </div>
                    <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-6 text-gray-800 dark:text-gray-200">
                      <HighlightedText text={text || '(empty event)'} matches={matchesByStep.get(step.index) ?? []} />
                    </pre>
                  </article>
                );
              })
            )}
          </div>
        </section>

        <section className="min-w-0 space-y-4">
          <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
            <h2 className="font-semibold text-gray-900 dark:text-white">Evidence record</h2>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Pinned text is hashed against its immutable source. Reviewed ranges are recorded only
              when you explicitly confirm them.
            </p>

            <div className="mt-4 rounded-lg bg-gray-50 p-3 dark:bg-gray-950/50">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                Literal search record · {investigation.searchRecords.length}
              </p>
              {investigation.searchRecords.length === 0 ? (
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  No searches have been recorded for this investigation.
                </p>
              ) : (
                <ul className="mt-2 space-y-1.5">
                  {investigation.searchRecords.map((record) => (
                    <li
                      key={record.id}
                      className="flex items-baseline justify-between gap-2 text-xs"
                    >
                      <code className="min-w-0 truncate text-gray-700 dark:text-gray-300">
                        {record.query}
                      </code>
                      <span className="shrink-0 text-gray-400">
                        {record.resultCount} match{record.resultCount === 1 ? '' : 'es'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="mt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                Pinned evidence · {exhibits.length}
              </p>
              {exhibits.length === 0 ? (
                <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                  Pin an exact source event to support a finding.
                </p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {exhibits.map((exhibit) => (
                    <li key={exhibit.id} className="rounded-lg border border-gray-200 p-3 dark:border-gray-800">
                      <label className="flex cursor-pointer items-start gap-2">
                        <input
                          type="checkbox"
                          checked={selectedExhibitIds.has(exhibit.id)}
                          onChange={() => toggleSelected(setSelectedExhibitIds, exhibit.id)}
                          className="mt-1 accent-violet-600"
                        />
                        <span className="min-w-0">
                          <span className="block text-xs font-medium text-gray-700 dark:text-gray-300">
                            Event {exhibit.stepIndex + 1} · exact source span
                          </span>
                          <span className="mt-1 block max-h-20 overflow-hidden whitespace-pre-wrap break-words text-xs text-gray-500 dark:text-gray-400">
                            {exhibit.selectedText}
                          </span>
                          <code
                            className="mt-1 block truncate text-[10px] text-gray-400"
                            title={`Selected text SHA-256: ${exhibit.selectedContentHash}`}
                          >
                            SHA-256 {exhibit.selectedContentHash.slice(0, 16)}…
                          </code>
                        </span>
                      </label>
                      <Link
                        to={`/conversations/${conversation.id}?scrollTo=${exhibit.messageId}`}
                        className="mt-2 inline-block text-xs font-medium text-violet-600 hover:underline dark:text-violet-400"
                      >
                        Open source event
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="mt-5 border-t border-gray-100 pt-4 dark:border-gray-800">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                Explicitly reviewed ranges · {scopes.length}
              </p>
              <div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={Math.max(steps.length, 1)}
                  value={reviewStart}
                  onChange={(event) => setReviewStart(event.target.value)}
                  aria-label="First reviewed event"
                  className={inputClass}
                />
                <span className="text-sm text-gray-400">to</span>
                <input
                  type="number"
                  min={1}
                  max={Math.max(steps.length, 1)}
                  value={reviewEnd}
                  onChange={(event) => setReviewEnd(event.target.value)}
                  aria-label="Last reviewed event"
                  className={inputClass}
                />
              </div>
              <button
                type="button"
                onClick={() => void handleConfirmReview()}
                disabled={!isEditable || steps.length === 0 || busyAction !== null}
                className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                Confirm reviewed range
              </button>
              {scopes.length > 0 && (
                <ul className="mt-3 space-y-2">
                  {scopes.map((scope) => (
                    <li key={scope.id}>
                      <label className="flex cursor-pointer items-start gap-2 rounded-lg bg-gray-50 p-2 text-xs text-gray-600 dark:bg-gray-950/50 dark:text-gray-400">
                        <input
                          type="checkbox"
                          checked={selectedScopeIds.has(scope.id)}
                          onChange={() => toggleSelected(setSelectedScopeIds, scope.id)}
                          className="mt-0.5 accent-violet-600"
                        />
                        <span>
                          Events {scope.startStepIndex + 1}–{scope.endStepIndex + 1} ·{' '}
                          {scope.eventCount} reviewed · {scope.includedSearchRecordIds.length} recorded
                          search{scope.includedSearchRecordIds.length === 1 ? '' : 'es'} ·{' '}
                          {scope.humanConfirmedAt.toLocaleString()}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>

        <section className="min-w-0 space-y-4">
          <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="font-semibold text-gray-900 dark:text-white">Investigation notebook</h2>
              <span className="text-xs text-gray-400">Your writing</span>
            </div>
            <label className="mt-3 block text-xs font-medium text-gray-600 dark:text-gray-400">
              Question
              <input
                value={caseTitle}
                onChange={(event) => setCaseTitle(event.target.value)}
                disabled={!isEditable}
                className={`${inputClass} mt-1 disabled:opacity-60`}
              />
            </label>
            <label className="mt-3 block text-xs font-medium text-gray-600 dark:text-gray-400">
              Working notes
              <textarea
                value={caseNotes}
                onChange={(event) => setCaseNotes(event.target.value)}
                disabled={!isEditable}
                rows={4}
                placeholder="What remains uncertain? What did you notice?"
                className={`${inputClass} mt-1 resize-y disabled:opacity-60`}
              />
            </label>
            <button
              type="button"
              onClick={() => void handleSaveCase()}
              disabled={!isEditable || !caseTitle.trim() || busyAction !== null}
              className="mt-3 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              Save notes
            </button>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
            <h2 className="font-semibold text-gray-900 dark:text-white">Write a finding</h2>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Findings are human-authored. Select supporting evidence, save the draft, then
              explicitly finalize and promote it.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <select
                value={findingType}
                onChange={(event) => setFindingType(event.target.value as InvestigationFindingType)}
                disabled={!isEditable}
                aria-label="Finding type"
                className={inputClass}
              >
                {FINDING_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
              <select
                value={findingConfidence}
                onChange={(event) => setFindingConfidence(event.target.value as VerdictConfidence)}
                disabled={!isEditable}
                aria-label="Finding confidence"
                className={inputClass}
              >
                <option value="low">Low confidence</option>
                <option value="medium">Medium confidence</option>
                <option value="high">High confidence</option>
              </select>
            </div>
            <input
              value={findingTitle}
              onChange={(event) => setFindingTitle(event.target.value)}
              disabled={!isEditable}
              placeholder="Finding statement"
              aria-label="Finding statement"
              className={`${inputClass} mt-2`}
            />
            <textarea
              value={findingBody}
              onChange={(event) => setFindingBody(event.target.value)}
              disabled={!isEditable}
              rows={3}
              placeholder="Optional context or qualification"
              aria-label="Finding context"
              className={`${inputClass} mt-2 resize-y`}
            />
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              Selected: {selectedExhibitIds.size} pinned item
              {selectedExhibitIds.size === 1 ? '' : 's'} · {selectedScopeIds.size} reviewed range
              {selectedScopeIds.size === 1 ? '' : 's'}
            </p>
            <button
              type="button"
              onClick={() => void handleCreateFinding()}
              disabled={
                !isEditable ||
                !findingTitle.trim() ||
                selectedExhibitIds.size + selectedScopeIds.size === 0 ||
                busyAction !== null
              }
              className="mt-3 w-full rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
            >
              Save finding draft
            </button>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="font-semibold text-gray-900 dark:text-white">Findings</h2>
              <span className="text-xs tabular-nums text-gray-400">{findings.length}</span>
            </div>
            {findings.length === 0 ? (
              <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">
                No findings yet.
              </p>
            ) : (
              <ul className="mt-3 space-y-3">
                {findings.map((finding) => (
                  <li key={finding.id} className="rounded-lg border border-gray-200 p-3 dark:border-gray-800">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 font-medium text-gray-700 dark:bg-gray-800 dark:text-gray-300">
                        {FINDING_TYPES.find((type) => type.value === finding.type)?.label ?? finding.type}
                      </span>
                      <span className="text-gray-400">{finding.confidence} confidence</span>
                      <span className="ml-auto uppercase tracking-wide text-gray-400">
                        {finding.state}
                      </span>
                    </div>
                    <p className="mt-2 text-sm font-medium text-gray-900 dark:text-white">
                      {finding.title}
                    </p>
                    {finding.body && (
                      <p className="mt-1 whitespace-pre-wrap text-sm text-gray-600 dark:text-gray-400">
                        {finding.body}
                      </p>
                    )}
                    <p className="mt-2 text-xs text-gray-400">
                      {finding.exhibitIds.length} pinned · {finding.reviewScopeIds.length} reviewed
                    </p>
                    <div className="mt-3 flex flex-wrap gap-3 text-sm">
                      {finding.state === 'draft' && (
                        <button
                          type="button"
                          onClick={() =>
                            void runAction(
                              `finding:finalize:${finding.id}`,
                              async () => {
                                await finalizeInvestigationFinding(finding.id);
                              },
                              'Finding finalized'
                            )
                          }
                          disabled={!isEditable || busyAction !== null}
                          className="font-medium text-violet-600 hover:underline disabled:opacity-50 dark:text-violet-400"
                        >
                          Finalize finding
                        </button>
                      )}
                      {finding.state === 'finalized' && !finding.promotedUnderstandingObjectId && (
                        <button
                          type="button"
                          onClick={() =>
                            void runAction(
                              `finding:promote:${finding.id}`,
                              async () => {
                                await promoteFindingToCurrentUnderstanding(finding.id);
                              },
                              'Finding promoted to Current Understanding'
                            )
                          }
                          disabled={busyAction !== null}
                          className="font-medium text-violet-600 hover:underline disabled:opacity-50 dark:text-violet-400"
                        >
                          Promote to Current Understanding
                        </button>
                      )}
                      {finding.promotedUnderstandingObjectId && (
                        <Link
                          to={`/projects/${projectId}/understanding`}
                          className="flex items-center gap-1 font-medium text-emerald-600 hover:underline dark:text-emerald-400"
                        >
                          <Check size={13} /> In Current Understanding
                        </Link>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {isEditable && (
              <button
                type="button"
                onClick={() =>
                  void runAction(
                    'complete',
                    async () => {
                      await completeQuestionInvestigation(investigation.id);
                    },
                    'Investigation completed'
                  )
                }
                disabled={finalizedCount === 0 || busyAction !== null}
                className="mt-4 w-full rounded-lg border border-emerald-300 px-3 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 dark:border-emerald-800 dark:text-emerald-300 dark:hover:bg-emerald-950/30"
              >
                Complete investigation
              </button>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function HighlightedText({ text, matches }: { text: string; matches: StepSearchMatch[] }) {
  if (matches.length === 0) return <>{text}</>;
  const parts = [];
  let cursor = 0;
  for (const match of matches) {
    if (match.start > cursor) {
      parts.push(<Fragment key={`plain:${cursor}`}>{text.slice(cursor, match.start)}</Fragment>);
    }
    parts.push(
      <mark
        key={`match:${match.start}`}
        className="rounded-sm bg-amber-200 text-gray-900 dark:bg-amber-500/70"
      >
        {text.slice(match.start, match.end)}
      </mark>
    );
    cursor = match.end;
  }
  if (cursor < text.length) {
    parts.push(<Fragment key={`plain:${cursor}`}>{text.slice(cursor)}</Fragment>);
  }
  return <>{parts}</>;
}

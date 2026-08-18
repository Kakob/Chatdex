// Investigation workbench (SPEC-decision-investigation §8.2, DI-2b).
// Three synchronized regions — transcript, code event, case notebook — over
// one anchor's complete primary source. Wide screens show them side by side;
// narrow screens switch via labeled tabs. Reading position is independent
// per region (each scrolls its own container).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, FileSearch } from 'lucide-react';
import { TranscriptReader, type ScrollRequest } from '../components/investigation/TranscriptReader';
import { CodeEventPanel, type CodePanelChange } from '../components/investigation/CodeEventPanel';
import { WorkbenchSearch } from '../components/investigation/WorkbenchSearch';
import { CaseNotebook } from '../components/investigation/CaseNotebook';
import { useInvestigationCase } from '../hooks/useInvestigationCase';
import {
  getInvestigationContext,
  type InvestigationContext,
} from '../lib/investigation/context';
import {
  searchStepTexts,
  stepDisplayText,
  type StepSearchMatch,
} from '../lib/investigation/search';
import { anchorFileLabel, KIND_LABELS } from '../lib/investigation/filter';

type Region = 'transcript' | 'code' | 'notebook';

// Loaded context tied to the anchor id it belongs to, so a param change
// renders as loading without any synchronous state reset in an effect.
interface LoadState {
  anchorId: string | undefined;
  context: InvestigationContext | null;
}

export function InvestigationWorkbenchPage() {
  const { anchorId } = useParams<{ anchorId: string }>();
  const navigate = useNavigate();
  const [loaded, setLoaded] = useState<LoadState | null>(null);

  const [query, setQuery] = useState('');
  // Match navigation position, valid only for the query it was set under —
  // a new query derives back to the first match without an effect.
  const [nav, setNav] = useState<{ query: string; index: number }>({ query: '', index: 0 });
  const [codeStepIndex, setCodeStepIndex] = useState<number | null>(null);
  const [scrollRequest, setScrollRequest] = useState<ScrollRequest | null>(null);
  const [region, setRegion] = useState<Region>('transcript');
  const [focusedStep, setFocusedStep] = useState<number>(0);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const scrollSeq = useRef(0);
  const lastRecordedQuery = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!anchorId) return;
    void getInvestigationContext(anchorId).then((ctx) => {
      if (cancelled) return;
      setLoaded({ anchorId, context: ctx });
      if (ctx) {
        setCodeStepIndex(ctx.anchor.stepIndex);
        setFocusedStep(ctx.anchor.stepIndex);
        scrollSeq.current += 1;
        setScrollRequest({ stepIndex: ctx.anchor.stepIndex, seq: scrollSeq.current });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [anchorId]);

  const isLoading = loaded?.anchorId !== anchorId;
  const context = isLoading ? null : loaded?.context ?? null;

  const displayTexts = useMemo(
    () => (context ? context.steps.map((ws) => stepDisplayText(ws.step)) : []),
    [context]
  );

  const matches = useMemo(
    () => searchStepTexts(displayTexts, query),
    [displayTexts, query]
  );

  const matchIndex =
    matches.length === 0
      ? -1
      : nav.query === query
        ? Math.min(nav.index, matches.length - 1)
        : 0;

  const currentMatch: StepSearchMatch | null =
    matchIndex >= 0 ? matches[matchIndex] : null;

  const caseApi = useInvestigationCase(context?.anchor ?? null, displayTexts);

  const reviewedStepIndexes = useMemo(() => {
    const set = new Set<number>();
    for (const scope of caseApi.scopes) {
      for (let i = scope.startStepIndex; i <= scope.endStepIndex; i++) set.add(i);
    }
    return set;
  }, [caseApi.scopes]);

  const matchesByStep = useMemo(() => {
    const map = new Map<number, StepSearchMatch[]>();
    for (const m of matches) {
      const list = map.get(m.stepIndex) ?? [];
      list.push(m);
      map.set(m.stepIndex, list);
    }
    return map;
  }, [matches]);

  const scrollToStep = useCallback((stepIndex: number) => {
    scrollSeq.current += 1;
    setScrollRequest({ stepIndex, seq: scrollSeq.current });
    setFocusedStep(stepIndex);
    setRegion('transcript');
  }, []);

  const navigateMatch = useCallback(
    (direction: 1 | -1) => {
      if (matches.length === 0) return;
      const base = matchIndex < 0 ? 0 : matchIndex;
      const next = (base + direction + matches.length) % matches.length;
      setNav({ query, index: next });
      scrollSeq.current += 1;
      setScrollRequest({ stepIndex: matches[next].stepIndex, seq: scrollSeq.current });
      // Record the executed query once per distinct query while a case is
      // open (spec §8.6) — navigation through results is the execution signal.
      if (query.trim() && lastRecordedQuery.current !== query) {
        lastRecordedQuery.current = query;
        void caseApi.recordSearch(query, matches.length);
      }
    },
    [matches, matchIndex, query, caseApi]
  );

  // Keyboard: '/' focus search, j/k next/prev event, [/] prev/next match
  // (spec §13 — secondary to the labeled controls above).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inField =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === '/' && !inField) {
        e.preventDefault();
        searchInputRef.current?.focus();
      } else if (!inField && context) {
        if (e.key === 'j' || e.key === 'k') {
          e.preventDefault();
          const delta = e.key === 'j' ? 1 : -1;
          const next = Math.min(
            context.steps.length - 1,
            Math.max(0, focusedStep + delta)
          );
          scrollToStep(next);
        } else if (e.key === ']') {
          e.preventDefault();
          navigateMatch(1);
        } else if (e.key === '[') {
          e.preventDefault();
          navigateMatch(-1);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [context, focusedStep, navigateMatch, scrollToStep]);

  if (isLoading) {
    return <p className="text-gray-500 dark:text-gray-400">Loading workbench…</p>;
  }

  if (!context) {
    return (
      <div>
        <p className="text-gray-700 dark:text-gray-300 mb-2">
          This anchor no longer exists — it may not have been derived yet, or its
          conversation was deleted.
        </p>
        <Link
          to="/investigate"
          className="text-violet-600 dark:text-violet-400 hover:underline"
        >
          Back to Investigate
        </Link>
      </div>
    );
  }

  const { anchor, conversation, steps, siblingAnchors } = context;
  const anchorStepIndexes = new Set(siblingAnchors.map((a) => a.stepIndex));

  const selectedWs =
    codeStepIndex !== null && codeStepIndex < steps.length ? steps[codeStepIndex] : null;
  const isAnchorEvent = codeStepIndex === anchor.stepIndex;
  const changes: CodePanelChange[] = isAnchorEvent
    ? anchor.fileChanges
    : (selectedWs?.step.editHunks ?? []).map((hunk, i) => ({
        path: hunk.filePath,
        changeIndex: i,
        oldString: hunk.oldString,
        newString: hunk.newString,
      }));

  const regionTabs: { id: Region; label: string }[] = [
    { id: 'transcript', label: 'Transcript' },
    { id: 'code', label: 'Code event' },
    { id: 'notebook', label: 'Notebook' },
  ];

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] min-h-0">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Link
          to="/investigate"
          className="flex items-center gap-1 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100"
        >
          <ArrowLeft size={16} /> Investigate
        </Link>
        <FileSearch size={18} className="text-violet-500" />
        <h1 className="text-lg font-semibold text-gray-900 dark:text-white truncate">
          {KIND_LABELS[anchor.kind]} · {anchorFileLabel(anchor)}
        </h1>
        <span className="text-sm text-gray-500 dark:text-gray-400 truncate">
          {conversation.name} · {anchor.occurredAt.toLocaleString()}
        </span>
        <div className="ml-auto">
          <WorkbenchSearch
            ref={searchInputRef}
            query={query}
            onQueryChange={setQuery}
            matchCount={matches.length}
            currentIndex={matchIndex}
            onNavigate={navigateMatch}
          />
        </div>
      </div>

      <div className="mb-3 flex gap-1 lg:hidden" role="tablist" aria-label="Workbench regions">
        {regionTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={region === tab.id}
            onClick={() => setRegion(tab.id)}
            className={`px-3 py-1.5 text-sm rounded-lg font-medium ${
              region === tab.id
                ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400'
                : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,26rem)]">
        <div
          className={`${region === 'transcript' ? 'block' : 'hidden'} lg:block min-h-0`}
        >
          <TranscriptReader
            steps={steps}
            displayTexts={displayTexts}
            anchorStepIndexes={anchorStepIndexes}
            primaryStepIndex={anchor.stepIndex}
            selectedCodeStepIndex={codeStepIndex}
            matchesByStep={matchesByStep}
            currentMatch={currentMatch}
            scrollRequest={scrollRequest}
            onToolCallClick={(stepIndex) => setCodeStepIndex(stepIndex)}
            reviewedStepIndexes={reviewedStepIndexes}
          />
        </div>

        <div className="min-h-0 flex flex-col gap-4">
          <div
            className={`${region === 'code' ? 'flex' : 'hidden'} lg:flex flex-col flex-1 min-h-0`}
          >
            <CodeEventPanel
              anchor={anchor}
              selected={selectedWs}
              changes={changes}
              isAnchorEvent={isAnchorEvent}
              onJumpToTranscript={scrollToStep}
              onBackToAnchorEvent={() => setCodeStepIndex(anchor.stepIndex)}
            />
          </div>

          <section
            aria-label="Case notebook"
            className={`${region === 'notebook' ? 'block' : 'hidden'} lg:block rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 overflow-y-auto max-h-[28rem]`}
          >
            <h2 className="font-semibold text-gray-900 dark:text-white text-sm mb-2">
              Case notebook
            </h2>
            <CaseNotebook
              anchor={anchor}
              stepCount={steps.length}
              focusedStep={focusedStep}
              focusedStepTextLength={displayTexts[focusedStep]?.length ?? 0}
              caseApi={caseApi}
              onJumpToStep={scrollToStep}
            />
            {siblingAnchors.length > 1 && (
              <div className="mt-4 pt-3 border-t border-gray-100 dark:border-gray-800">
                <h3 className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Code changes in this session
                </h3>
                <ul className="space-y-1">
                  {siblingAnchors.map((a) => (
                    <li key={a.id}>
                      <button
                        type="button"
                        onClick={() => {
                          if (a.id === anchor.id) {
                            scrollToStep(a.stepIndex);
                          } else {
                            navigate(`/investigate/${encodeURIComponent(a.id)}`);
                          }
                        }}
                        className={`w-full text-left text-xs px-2 py-1 rounded-lg font-mono truncate ${
                          a.id === anchor.id
                            ? 'bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-300'
                            : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                        }`}
                        title={a.filePaths.join('\n')}
                      >
                        #{a.stepIndex} {KIND_LABELS[a.kind]} · {anchorFileLabel(a)}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

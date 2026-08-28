// Investigate — neutral anchor browser (SPEC-decision-investigation §8.1).
// Rows show only mechanically derived metadata (spec §7.4): tool kind,
// literal paths, session, timestamp, case state. Ordering is chronological
// only — no relevance, importance, or recommendation exists by design.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { listPreparedChangesForProject } from '../lib/db/preparedChanges';
import type { PreparedChange } from '../types/preparedChange';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowDownNarrowWide,
  ArrowRight,
  ArrowUpNarrowWide,
  FileSearch,
  Plus,
  RefreshCw,
} from 'lucide-react';
import { useInvestigationAnchors } from '../hooks/useInvestigationAnchors';
import {
  anchorCaseState,
  anchorFileLabel,
  filterAnchors,
  KIND_LABELS,
  type AnchorBrowserFilters,
  type AnchorCaseState,
} from '../lib/investigation/filter';
import {
  getCaseStatesByAnchor,
  startInvestigation,
  startQuestionInvestigation,
} from '../lib/investigation/cases';
import { getAssociationsForProject } from '../lib/db/understanding';
import { getFindingsForCase, listInvestigationCases } from '../lib/db/investigationCases';
import { db } from '../lib/db/schema';
import { CoverageView } from '../components/investigation/CoverageView';
import { useToastStore } from '../stores/toastStore';
import type {
  CaseState,
  CodeChangeKind,
  InvestigationAnchor,
  InvestigationCase,
} from '../types/investigation';
import type { StoredConversation } from '../types';
import type { AnchorConversationInfo } from '../hooks/useInvestigationAnchors';

const inputClass =
  'px-2 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100';

export function InvestigatePage({ projectScoped = false }: { projectScoped?: boolean }) {
  const { id: routeProjectId } = useParams<{ id: string }>();
  const projectId = projectScoped ? routeProjectId : undefined;
  const navigate = useNavigate();
  const addToast = useToastStore((state) => state.addToast);
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');
  const [filters, setFilters] = useState<AnchorBrowserFilters>({});
  const [view, setView] = useState<'questions' | 'workspaces' | 'anchors' | 'coverage'>(
    projectScoped ? 'questions' : 'anchors'
  );
  const [projectConversationIds, setProjectConversationIds] = useState<string[]>([]);
  const [projectConversations, setProjectConversations] = useState<StoredConversation[]>([]);
  const [questionCases, setQuestionCases] = useState<
    Array<{ investigation: InvestigationCase; sourceName: string; findingCount: number }>
  >([]);
  const [question, setQuestion] = useState('');
  const [questionConversationId, setQuestionConversationId] = useState('');
  const [isStartingQuestion, setIsStartingQuestion] = useState(false);

  const loadProjectInvestigationData = useCallback(async () => {
    if (!projectId) return;
    const associations = await getAssociationsForProject(projectId);
    const conversationIds = associations
      .filter(
        (association) =>
          association.reviewState === 'accepted' || association.reviewState === 'edited'
      )
      .map((association) => association.conversationId);
    const [conversationRows, cases] = await Promise.all([
      db.conversations.bulkGet(conversationIds),
      listInvestigationCases({ projectId }),
    ]);
    const conversations = conversationRows.filter(
      (row): row is StoredConversation => Boolean(row)
    );
    const names = new Map(conversations.map((conversation) => [conversation.id, conversation.name]));
    const questionRows = await Promise.all(
      cases
        .filter((investigation) => investigation.kind === 'question')
        .map(async (investigation) => ({
          investigation,
          sourceName: names.get(investigation.conversationId) ?? investigation.conversationId,
          findingCount: (await getFindingsForCase(investigation.id)).length,
        }))
    );
    setProjectConversationIds(conversationIds);
    setProjectConversations(conversations);
    setQuestionCases(questionRows);
    setQuestionConversationId((current) =>
      current && conversationIds.includes(current) ? current : (conversationIds[0] ?? '')
    );
  }, [projectId]);

  useEffect(() => {
    void loadProjectInvestigationData();
  }, [loadProjectInvestigationData]);

  const handleStartQuestion = async () => {
    if (!projectId || !questionConversationId || !question.trim()) return;
    setIsStartingQuestion(true);
    try {
      const investigation = await startQuestionInvestigation({
        projectId,
        conversationId: questionConversationId,
        question,
      });
      addToast('Investigation started');
      navigate(`/projects/${projectId}/investigate/questions/${investigation.id}`);
    } catch (error) {
      addToast(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      setIsStartingQuestion(false);
    }
  };

  const scopedConversationIds = projectScoped ? projectConversationIds : undefined;
  const {
    anchors,
    conversationInfo,
    isLoading,
    runBackfill,
    backfillProgress,
    backfillResult,
  } = useInvestigationAnchors(order, scopedConversationIds);

  const [caseStates, setCaseStates] = useState<Map<string, CaseState>>(new Map());
  useEffect(() => {
    void getCaseStatesByAnchor().then(setCaseStates);
  }, [anchors]);

  const conversationMeta = useMemo(
    () =>
      new Map(
        [...conversationInfo.entries()].map(([id, info]) => [
          id,
          { projectPath: info.projectPath },
        ])
      ),
    [conversationInfo]
  );

  const visible = useMemo(
    () => filterAnchors(anchors, filters, conversationMeta, caseStates),
    [anchors, filters, conversationMeta, caseStates]
  );

  const sessions = useMemo(
    () =>
      [...conversationInfo.entries()]
        .map(([id, info]) => ({ id, name: info.name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [conversationInfo]
  );

  const projects = useMemo(
    () =>
      [...new Set(
        [...conversationInfo.values()]
          .map((i) => i.projectPath)
          .filter((p): p is string => Boolean(p))
      )].sort(),
    [conversationInfo]
  );

  const set = (patch: Partial<AnchorBrowserFilters>) =>
    setFilters((f) => ({ ...f, ...patch }));

  return (
    <div>
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <FileSearch size={24} className="text-violet-500" />
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">
            {projectScoped ? 'Investigate History' : 'Investigate'}
          </h1>
        </div>
        <p className="text-gray-600 dark:text-gray-400">
          {projectScoped
            ? 'Read the project’s primary history and open mechanically derived code-change entry points. Nothing here is a generated conclusion.'
            : 'Every code-change event from your agent sessions, in chronological order. Anchors are mechanical entry points — not detected decisions.'}
        </p>
      </div>

      <div className="mb-4 flex gap-1" role="tablist" aria-label="Investigate views">
        {(
          projectScoped
            ? (['questions', 'workspaces', 'anchors', 'coverage'] as const)
            : (['anchors', 'coverage'] as const)
        ).map((v) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={view === v}
            onClick={() => setView(v)}
            className={`px-3 py-1.5 text-sm rounded-lg font-medium ${
              view === v
                ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400'
                : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
            }`}
          >
            {v === 'questions'
              ? 'Questions'
              : v === 'workspaces'
                ? 'Change workspaces'
              : v === 'anchors'
                ? 'Code-change anchors'
                : 'Coverage'}
          </button>
        ))}
      </div>

      {view === 'questions' && projectId ? (
        <QuestionInvestigations
          projectId={projectId}
          conversations={projectConversations}
          questionCases={questionCases}
          question={question}
          conversationId={questionConversationId}
          isStarting={isStartingQuestion}
          onQuestionChange={setQuestion}
          onConversationChange={setQuestionConversationId}
          onStart={() => void handleStartQuestion()}
        />
      ) : view === 'workspaces' && projectId ? (
        <ChangeWorkspaces projectId={projectId} />
      ) : view === 'coverage' ? (
        <CoverageView
          conversationIds={scopedConversationIds}
          onFilterByPath={(path) => {
            setFilters((f) => ({ ...f, filePathSubstring: path }));
            setView('anchors');
          }}
        />
      ) : (
        <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select
          className={inputClass}
          value={filters.conversationId ?? ''}
          onChange={(e) => set({ conversationId: e.target.value || undefined })}
          aria-label="Filter by session"
        >
          <option value="">All sessions</option>
          {sessions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>

        {!projectScoped && projects.length > 0 && (
          <select
            className={inputClass}
            value={filters.projectPath ?? ''}
            onChange={(e) =>
              set({ projectPath: e.target.value === '' ? undefined : e.target.value })
            }
            aria-label="Filter by project"
          >
            <option value="">All projects</option>
            {projects.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        )}

        <select
          className={inputClass}
          value={filters.kind ?? ''}
          onChange={(e) =>
            set({ kind: (e.target.value || undefined) as CodeChangeKind | undefined })
          }
          aria-label="Filter by change type"
        >
          <option value="">All change types</option>
          {Object.entries(KIND_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>

        <select
          className={inputClass}
          value={filters.caseState ?? ''}
          onChange={(e) =>
            set({
              caseState: (e.target.value || undefined) as AnchorCaseState | undefined,
            })
          }
          aria-label="Filter by case state"
        >
          <option value="">All states</option>
          <option value="uninvestigated">Uninvestigated</option>
          <option value="open">Open</option>
          <option value="adjudicated">Adjudicated</option>
        </select>

        <input
          type="text"
          className={inputClass}
          placeholder="File path contains…"
          value={filters.filePathSubstring ?? ''}
          onChange={(e) => set({ filePathSubstring: e.target.value || undefined })}
          aria-label="Filter by file path substring"
        />

        <input
          type="date"
          className={inputClass}
          value={toDateInput(filters.dateFrom)}
          onChange={(e) => set({ dateFrom: fromDateInput(e.target.value) })}
          aria-label="From date"
        />
        <input
          type="date"
          className={inputClass}
          value={toDateInput(filters.dateTo)}
          onChange={(e) => set({ dateTo: fromDateInput(e.target.value) })}
          aria-label="To date"
        />

        <button
          type="button"
          onClick={() => setOrder((o) => (o === 'asc' ? 'desc' : 'asc'))}
          className="flex items-center gap-1.5 px-2 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
          title="Toggle chronological order"
        >
          {order === 'asc' ? (
            <ArrowUpNarrowWide size={16} />
          ) : (
            <ArrowDownNarrowWide size={16} />
          )}
          {order === 'asc' ? 'Oldest first' : 'Newest first'}
        </button>

        <button
          type="button"
          onClick={() => void runBackfill()}
          disabled={backfillProgress !== null}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-60"
        >
          <RefreshCw size={16} className={backfillProgress ? 'animate-spin' : ''} />
          {backfillProgress
            ? `Deriving ${backfillProgress.current}/${backfillProgress.total}…`
            : 'Derive anchors'}
        </button>
      </div>

      {backfillResult && (
        <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
          Derived {backfillResult.anchorsDerived} anchor
          {backfillResult.anchorsDerived === 1 ? '' : 's'} across{' '}
          {backfillResult.conversationsProcessed} session
          {backfillResult.conversationsProcessed === 1 ? '' : 's'}
          {backfillResult.failures > 0 && `, ${backfillResult.failures} failed`}.
        </p>
      )}

      {isLoading ? (
        <p className="text-gray-500 dark:text-gray-400">Loading anchors…</p>
      ) : anchors.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 p-8 text-center">
          <p className="text-gray-700 dark:text-gray-300 mb-1">
            {projectScoped ? 'No code-change anchors in this project yet.' : 'No code-change anchors yet.'}
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {projectScoped
              ? 'Attach an imported Claude Code conversation from the project overview, then derive its structured Edit/Write events. You can still investigate any project source from the Questions tab.'
              : 'Anchors are derived from structured Edit/Write tool calls in imported Claude Code sessions. Import a session, or run “Derive anchors” to process sessions imported before this feature existed.'}
          </p>
        </div>
      ) : (
        <>
          <p className="mb-2 text-sm text-gray-500 dark:text-gray-400 tabular-nums">
            {visible.length} of {anchors.length} anchors
          </p>
          <ul className="space-y-2">
            {visible.map((anchor) => (
              <AnchorRow
                key={anchor.id}
                anchor={anchor}
                info={conversationInfo.get(anchor.conversationId)}
                state={anchorCaseState(anchor, caseStates)}
                investigateBasePath={
                  projectScoped && projectId
                    ? `/projects/${projectId}/investigate`
                    : '/investigate'
                }
              />
            ))}
          </ul>
        </>
      )}
        </>
      )}
    </div>
  );
}

const QUESTION_STATE: Record<CaseState, { label: string; tone: string }> = {
  draft: {
    label: 'Draft',
    tone: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  },
  open: {
    label: 'In progress',
    tone: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  },
  completed: {
    label: 'Completed',
    tone: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  },
  adjudicated: {
    label: 'Adjudicated',
    tone: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  },
  reopened: {
    label: 'Reopened',
    tone: 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  },
};

function QuestionInvestigations({
  projectId,
  conversations,
  questionCases,
  question,
  conversationId,
  isStarting,
  onQuestionChange,
  onConversationChange,
  onStart,
}: {
  projectId: string;
  conversations: StoredConversation[];
  questionCases: Array<{
    investigation: InvestigationCase;
    sourceName: string;
    findingCount: number;
  }>;
  question: string;
  conversationId: string;
  isStarting: boolean;
  onQuestionChange: (value: string) => void;
  onConversationChange: (value: string) => void;
  onStart: () => void;
}) {
  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-violet-200 bg-violet-50/60 p-5 dark:border-violet-900/60 dark:bg-violet-950/20">
        <div className="max-w-3xl">
          <p className="text-sm font-medium text-violet-700 dark:text-violet-300">
            Start from uncertainty, not a generated answer
          </p>
          <h2 className="mt-1 text-lg font-semibold text-gray-900 dark:text-white">
            What do you need to understand before changing the project?
          </h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Choose one primary source. Chatdex keeps the full chronology visible while you
            search literally, pin exact evidence, and write the finding yourself.
          </p>
        </div>

        {conversations.length === 0 ? (
          <div className="mt-4 rounded-lg border border-dashed border-violet-300 p-4 text-sm text-gray-600 dark:border-violet-800 dark:text-gray-400">
            This project has no accepted sources yet.{' '}
            <Link
              to={`/projects/${projectId}`}
              className="font-medium text-violet-700 hover:underline dark:text-violet-300"
            >
              Add a source from the project overview
            </Link>
            .
          </div>
        ) : (
          <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(15rem,0.45fr)_auto]">
            <input
              value={question}
              onChange={(event) => onQuestionChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  onStart();
                }
              }}
              placeholder="Should Slop Connoisseur use contestant-specific judging?"
              aria-label="Investigation question"
              className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
            />
            <select
              value={conversationId}
              onChange={(event) => onConversationChange(event.target.value)}
              aria-label="Primary source"
              className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
            >
              {conversations.map((conversation) => (
                <option key={conversation.id} value={conversation.id}>
                  {conversation.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={onStart}
              disabled={!question.trim() || !conversationId || isStarting}
              className="flex items-center justify-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
            >
              <Plus size={15} /> {isStarting ? 'Starting…' : 'Start'}
            </button>
          </div>
        )}
      </section>

      <section>
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 className="font-semibold text-gray-900 dark:text-white">Investigations</h2>
          <span className="text-sm tabular-nums text-gray-500 dark:text-gray-400">
            {questionCases.length} total
          </span>
        </div>
        {questionCases.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-300 p-7 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
            No project questions yet. Start with one decision you need evidence to clarify.
          </div>
        ) : (
          <ul className="space-y-2">
            {questionCases.map(({ investigation, sourceName, findingCount }) => {
              const chip = QUESTION_STATE[investigation.state];
              return (
                <li key={investigation.id}>
                  <Link
                    to={`/projects/${projectId}/investigate/questions/${investigation.id}`}
                    className="group flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-gray-200 bg-white px-4 py-3 hover:border-violet-300 dark:border-gray-800 dark:bg-gray-900 dark:hover:border-violet-800"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-gray-900 dark:text-white">
                        {investigation.title}
                      </p>
                      <p className="mt-1 truncate text-sm text-gray-500 dark:text-gray-400">
                        Source: {sourceName} · {findingCount} finding
                        {findingCount === 1 ? '' : 's'} · Updated{' '}
                        {investigation.updatedAt.toLocaleString()}
                      </p>
                    </div>
                    <span className={`rounded-full px-2 py-0.5 text-xs ${chip.tone}`}>
                      {chip.label}
                    </span>
                    <ArrowRight
                      size={16}
                      className="text-gray-300 group-hover:text-violet-500"
                    />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

const STATE_CHIP: Record<AnchorCaseState, { label: string; tone: string }> = {
  uninvestigated: {
    label: 'Uninvestigated',
    tone: 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
  },
  open: {
    label: 'Open',
    tone: 'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300',
  },
  adjudicated: {
    label: 'Adjudicated',
    tone: 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300',
  },
};

function AnchorRow({
  anchor,
  info,
  state,
  investigateBasePath,
}: {
  anchor: InvestigationAnchor;
  info: AnchorConversationInfo | undefined;
  state: AnchorCaseState;
  investigateBasePath: string;
}) {
  const navigate = useNavigate();
  const workbenchPath = `${investigateBasePath}/${encodeURIComponent(anchor.id)}`;

  const startAndOpen = async () => {
    await startInvestigation(anchor);
    navigate(workbenchPath);
  };

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-3">
      <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300">
        {KIND_LABELS[anchor.kind]}
      </span>
      <span
        className="font-mono text-sm text-gray-900 dark:text-gray-100 truncate max-w-md"
        title={anchor.filePaths.join('\n')}
      >
        {anchorFileLabel(anchor)}
      </span>
      <span className="text-sm text-gray-500 dark:text-gray-400 truncate max-w-48">
        {info?.name ?? info?.sourceFilename ?? anchor.conversationId}
      </span>
      <span className="text-sm text-gray-500 dark:text-gray-400 tabular-nums">
        {anchor.occurredAt.toLocaleString()}
      </span>
      {anchor.sourceProvenance === 'legacy' && (
        <span
          className="px-1.5 py-0.5 text-xs rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300"
          title="Imported before raw-source retention; re-import the session file to key this anchor to its source hash"
        >
          legacy
        </span>
      )}
      <span
        className={`ml-auto px-2 py-0.5 text-xs rounded-full ${STATE_CHIP[state].tone}`}
      >
        {STATE_CHIP[state].label}
      </span>
      {state === 'uninvestigated' ? (
        <button
          type="button"
          onClick={() => void startAndOpen()}
          className="text-sm font-medium text-violet-600 dark:text-violet-400 hover:underline"
        >
          Start investigation
        </button>
      ) : (
        <Link
          to={workbenchPath}
          className="text-sm font-medium text-violet-600 dark:text-violet-400 hover:underline"
        >
          Resume investigation
        </Link>
      )}
      <Link
        to={`/conversations/${anchor.conversationId}?scrollTo=${anchor.messageId}`}
        className="text-sm font-medium text-violet-600 dark:text-violet-400 hover:underline"
      >
        Open source
      </Link>
    </li>
  );
}

function toDateInput(d: Date | undefined): string {
  if (!d) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fromDateInput(value: string): Date | undefined {
  if (!value) return undefined;
  const [y, m, day] = value.split('-').map(Number);
  return new Date(y, m - 1, day);
}

/**
 * Every Change Workspace is part of Investigate History (SPEC-change-workspace
 * §14, PRD §18): intent → evidence → hypothesis → implementation →
 * verification → resulting understanding, reconstructed read-only.
 */
function ChangeWorkspaces({ projectId }: { projectId: string }) {
  const [changes, setChanges] = useState<PreparedChange[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    void listPreparedChangesForProject(projectId).then((rows) => !cancelled && setChanges(rows));
    return () => {
      cancelled = true;
    };
  }, [projectId]);
  if (!changes) return null;
  if (changes.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 p-6 text-sm text-gray-500 dark:text-gray-400">
        No change workspaces yet.{' '}
        <Link to={`/projects/${projectId}/prepare`} className="text-violet-600 dark:text-violet-400 hover:underline">
          Start one in Prepare Change
        </Link>
      </div>
    );
  }
  return (
    <ul className="space-y-2" data-testid="change-workspaces">
      {changes.map((change) => (
        <li key={change.id} className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-gray-900 dark:text-white">{change.title}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {change.state} · {change.implementation ? `implementation by ${change.implementation.provenance.replace('_', ' + ')}` : 'no implementation attached'} ·{' '}
              {(change.promotions?.length ?? 0)} promoted · {(change.questionIds?.length ?? 0)} open question(s) · updated {change.updatedAt.toLocaleDateString()}
            </p>
          </div>
          <Link
            to={`/projects/${projectId}/prepare?change=${encodeURIComponent(change.id)}&view=timeline`}
            className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200"
          >
            Reconstruct
          </Link>
        </li>
      ))}
    </ul>
  );
}

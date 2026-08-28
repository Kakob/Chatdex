// Change Workspace — Verification section (SPEC-change-workspace §12, PRD §14;
// CW-4). Criteria × evidence. Status is set by the human; the hint only
// suggests. A row backed only by AI inference cannot be "supported" (law
// §2.2). Test/runtime evidence is recorded by hand or picked from a tool
// event in an ingested Claude Code session — Chatdex runs nothing.

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, ClipboardCheck, Loader2, Plus, TerminalSquare } from 'lucide-react';
import { addEvidenceItems, markVerified, updateVerificationRow } from '../../lib/prepare/lifecycle';
import { editabilityOf } from '../../lib/prepare/editability';
import { evidenceLabel } from '../../lib/prepare/evidenceLabel';
import {
  VERIFICATION_STATUS_LABEL,
  deriveVerificationHint,
  findTestRunEvents,
  manualObservationEvidence,
  testRuntimeEvidenceFromEvent,
  verificationRows,
  verificationSummary,
  type TestRunEvent,
} from '../../lib/prepare/verification';
import { getAssociatedConversations } from '../../lib/understanding/reconcile';
import { generateId } from '../../lib/utils/ids';
import { useToastStore } from '../../stores/toastStore';
import type { PreparedChange, VerificationRow, VerificationStatus } from '../../types/preparedChange';
import type { EvidenceItem, TestRuntimeEvidence } from '../../types/evidence';

interface Props {
  change: PreparedChange;
  projectId: string;
  onChanged: (change: PreparedChange) => Promise<void>;
}

const STATUSES: VerificationStatus[] = ['unverified', 'partial', 'supported', 'contradicted'];
const STATUS_CHIP: Record<VerificationStatus, string> = {
  supported: 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300',
  partial: 'bg-sky-50 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300',
  contradicted: 'bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300',
  unverified: 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400',
};

export function VerificationSection({ change, projectId, onChanged }: Props) {
  const addToast = useToastStore((s) => s.addToast);
  const editable = editabilityOf(change, 'verification') === 'editable';
  const available = editabilityOf(change, 'verification') !== 'unavailable';
  const evidence = useMemo(() => change.evidence ?? [], [change.evidence]);
  const rows = verificationRows(change);
  const summary = verificationSummary(change);
  const criteriaById = new Map((change.criteria ?? []).map((c) => [c.id, c]));
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (key: string, fn: () => Promise<PreparedChange>, message?: string) => {
    setBusy(key);
    try {
      const updated = await fn();
      await onChanged(updated);
      if (message) addToast(message);
    } catch (err) {
      addToast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setBusy(null);
    }
  };

  const saveRow = (row: VerificationRow, patch: Partial<Pick<VerificationRow, 'evidenceIds' | 'status' | 'note'>>) =>
    run(`row:${row.criterionId}`, () =>
      updateVerificationRow(change.id, { criterionId: row.criterionId, evidenceIds: row.evidenceIds, status: row.status, note: row.note, ...patch })
    );

  const addEvidenceToRow = async (row: VerificationRow, item: EvidenceItem) => {
    await run(`row:${row.criterionId}`, async () => {
      await addEvidenceItems(change.id, [item]);
      return updateVerificationRow(change.id, { ...row, evidenceIds: [...row.evidenceIds, item.id] });
    }, 'Evidence attached');
  };

  return (
    <section className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
      <div className="flex flex-wrap items-center gap-3 px-5 py-4 border-b border-gray-100 dark:border-gray-800">
        <ClipboardCheck size={16} className="text-violet-600 dark:text-violet-400" />
        <h2 className="font-semibold text-gray-900 dark:text-white">Verification</h2>
        <span className="text-xs text-gray-400">
          {summary.total} criteri{summary.total === 1 ? 'on' : 'a'} · {summary.byStatus.supported} supported · {summary.byStatus.partial} partial · {summary.byStatus.contradicted} contradicted · {summary.byStatus.unverified} unverified
        </span>
        {editable && (
          <button
            type="button"
            onClick={() => void run('verify', () => markVerified(change.id), 'Workspace marked verified')}
            disabled={busy !== null || summary.blocking.length > 0}
            title={summary.blocking.length ? `${summary.blocking.length} criterion(s) unverified without a note` : 'Mark verified'}
            className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-emerald-600 text-white disabled:opacity-50"
          >
            {busy === 'verify' ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Mark verified
          </button>
        )}
      </div>

      <div className="p-5 space-y-4">
        {!available && (
          <p className="text-xs text-gray-400">Verification opens once an implementation is attached.</p>
        )}
        {available && rows.length === 0 && (
          <p className="text-xs text-gray-400">No acceptance criteria were recorded before this workspace became ready.</p>
        )}

        {available &&
          rows.map((row) => {
            const criterion = criteriaById.get(row.criterionId);
            const hint = deriveVerificationHint(row, evidence);
            const attached = evidence.filter((e) => row.evidenceIds.includes(e.id));
            return (
              <div key={row.criterionId} className="rounded-lg border border-gray-200 dark:border-gray-800 p-3 space-y-2" data-testid={`criterion-${row.criterionId}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="flex-1 min-w-48 text-sm text-gray-900 dark:text-white">{criterion?.text ?? row.criterionId}</p>
                  <span className={`px-1.5 py-0.5 rounded text-xs ${STATUS_CHIP[row.status]}`} data-testid="row-status">
                    {VERIFICATION_STATUS_LABEL[row.status]}
                  </span>
                  {editable && (
                    <select
                      value={row.status}
                      onChange={(e) => void saveRow(row, { status: e.target.value as VerificationStatus })}
                      aria-label={`Status for ${criterion?.text ?? row.criterionId}`}
                      disabled={busy === `row:${row.criterionId}`}
                      className="px-2 py-1 text-xs rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 text-gray-700 dark:text-gray-200"
                    >
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>{VERIFICATION_STATUS_LABEL[s]}</option>
                      ))}
                    </select>
                  )}
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Hint: <span className="font-medium">{VERIFICATION_STATUS_LABEL[hint.suggested]}</span> —{' '}
                  <span className={hint.aiOnly ? 'text-amber-700 dark:text-amber-300' : ''}>{hint.reason}</span>
                </p>
                <ul className="text-xs space-y-1">
                  {attached.map((item) => (
                    <li key={item.id} className="flex items-center gap-2 text-gray-700 dark:text-gray-300">
                      <span className={`px-1 rounded text-[10px] ${item.kind === 'ai_inference' ? 'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300' : 'bg-gray-100 dark:bg-gray-800'}`}>{item.kind}</span>
                      <span className="font-mono">{evidenceLabel(item)}</span>
                      {item.kind === 'test_runtime' && item.source === 'transcript' && item.conversationId && (
                        <Link to={`/conversations/${item.conversationId}${item.messageId ? `?scrollTo=${encodeURIComponent(item.messageId)}` : ''}`} className="text-violet-600 dark:text-violet-400 underline">
                          open in session
                        </Link>
                      )}
                      {editable && (
                        <button type="button" onClick={() => void saveRow(row, { evidenceIds: row.evidenceIds.filter((id) => id !== item.id) })} className="text-gray-400 hover:text-red-500" aria-label={`Detach ${evidenceLabel(item)}`}>
                          ×
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
                {editable && (
                  <div className="flex flex-wrap gap-3">
                    <AttachExisting row={row} evidence={evidence} onAttach={(id) => void saveRow(row, { evidenceIds: [...row.evidenceIds, id] })} />
                    <RecordObservation criterionText={criterion?.text ?? ''} onRecord={(item) => void addEvidenceToRow(row, item)} />
                  </div>
                )}
                {(editable || row.note) && (
                  <input
                    defaultValue={row.note ?? ''}
                    disabled={!editable}
                    onBlur={(e) => e.target.value.trim() !== (row.note ?? '') && void saveRow(row, { note: e.target.value.trim() || undefined })}
                    placeholder={row.status === 'unverified' ? 'note — required to accept this criterion as unverified' : 'note (optional)'}
                    aria-label={`Note for ${criterion?.text ?? row.criterionId}`}
                    className="w-full px-2 py-1 text-xs rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100"
                  />
                )}
              </div>
            );
          })}

        {editable && <SessionRuns change={change} projectId={projectId} rows={rows} criteriaById={criteriaById} onAttach={addEvidenceToRow} />}
      </div>
    </section>
  );
}

function AttachExisting({ row, evidence, onAttach }: { row: VerificationRow; evidence: EvidenceItem[]; onAttach: (id: string) => void }) {
  const candidates = evidence.filter((e) => !row.evidenceIds.includes(e.id) && e.kind !== 'human_hypothesis');
  if (candidates.length === 0) return null;
  return (
    <label className="text-xs text-gray-600 dark:text-gray-400 inline-flex items-center gap-1">
      Attach existing
      <select
        value=""
        onChange={(e) => e.target.value && onAttach(e.target.value)}
        aria-label={`Attach evidence to ${row.criterionId}`}
        className="px-2 py-1 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 text-gray-700 dark:text-gray-200"
      >
        <option value="">choose…</option>
        {candidates.map((item) => (
          <option key={item.id} value={item.id}>
            [{item.kind}] {evidenceLabel(item)}
          </option>
        ))}
      </select>
    </label>
  );
}

function RecordObservation({ criterionText, onRecord }: { criterionText: string; onRecord: (item: TestRuntimeEvidence) => void }) {
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState<TestRuntimeEvidence['outcome']>('observed');
  const [command, setCommand] = useState('');
  const [note, setNote] = useState('');
  const addToast = useToastStore((s) => s.addToast);
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1 text-xs text-violet-600 dark:text-violet-400" aria-label={`Record observation for ${criterionText}`}>
        <Plus size={12} /> Record observation
      </button>
    );
  }
  return (
    <div className="w-full flex flex-wrap items-center gap-2 rounded bg-gray-50 dark:bg-gray-950 p-2 text-xs">
      <select value={outcome} onChange={(e) => setOutcome(e.target.value as TestRuntimeEvidence['outcome'])} aria-label="Observation outcome" className="px-2 py-1 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200">
        <option value="observed">observed</option>
        <option value="pass">pass</option>
        <option value="fail">fail</option>
      </select>
      <input value={command} onChange={(e) => setCommand(e.target.value)} placeholder="command (optional)" aria-label="Observation command" className="w-44 px-2 py-1 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100" />
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="what you observed" aria-label="Observation note" className="flex-1 min-w-48 px-2 py-1 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100" />
      <button
        type="button"
        onClick={() =>
          void manualObservationEvidence({ id: generateId(), outcome, command, note })
            .then((item) => {
              onRecord(item);
              setOpen(false);
              setNote('');
              setCommand('');
            })
            .catch((err) => addToast(err instanceof Error ? err.message : String(err), 'error'))
        }
        className="px-2 py-1 rounded bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900"
      >
        Add
      </button>
      <button type="button" onClick={() => setOpen(false)} className="text-gray-500">Cancel</button>
    </div>
  );
}

function SessionRuns({
  change, projectId, rows, criteriaById, onAttach,
}: {
  change: PreparedChange;
  projectId: string;
  rows: VerificationRow[];
  criteriaById: Map<string, { id: string; text: string }>;
  onAttach: (row: VerificationRow, item: EvidenceItem) => Promise<void>;
}) {
  const [sessions, setSessions] = useState<{ id: string; name: string }[]>([]);
  const [sessionId, setSessionId] = useState(change.implementation?.conversationId ?? '');
  const [events, setEvents] = useState<TestRunEvent[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [target, setTarget] = useState<Record<number, string>>({});

  useEffect(() => {
    let cancelled = false;
    void getAssociatedConversations(projectId).then((convs) => {
      if (cancelled) return;
      const cc = convs.filter((c) => c.source === 'claude-code').map((c) => ({ id: c.id, name: c.name ?? c.id }));
      setSessions(cc);
      setSessionId((cur) => cur || cc[0]?.id || '');
    });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const scan = async () => {
    if (!sessionId) return;
    setLoading(true);
    try {
      setEvents(await findTestRunEvents(sessionId));
    } finally {
      setLoading(false);
    }
  };

  if (sessions.length === 0) return null;
  return (
    <div className="rounded-lg bg-gray-50 dark:bg-gray-950 p-3 space-y-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <TerminalSquare size={14} className="text-gray-400" />
        <span className="font-medium text-gray-700 dark:text-gray-300">Test / build runs from a Claude Code session</span>
        <select value={sessionId} onChange={(e) => { setSessionId(e.target.value); setEvents(null); }} aria-label="Session to scan" className="px-2 py-1 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200">
          {sessions.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        <button type="button" onClick={() => void scan()} disabled={loading} className="inline-flex items-center gap-1 px-2 py-1 rounded border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200">
          {loading ? <Loader2 size={12} className="animate-spin" /> : null} Find runs
        </button>
      </div>
      {events && events.length === 0 && <p className="text-gray-500">No test, typecheck, lint, or build commands found in that session.</p>}
      {events && events.length > 0 && (
        <ul className="space-y-1">
          {events.map((ev) => (
            <li key={ev.stepIndex} className="flex flex-wrap items-center gap-2">
              <span className={`px-1 rounded text-[10px] ${ev.outcome === 'fail' ? 'bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300' : ev.outcome === 'pass' ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300' : 'bg-gray-100 dark:bg-gray-800'}`}>{ev.outcome}</span>
              <code className="flex-1 min-w-40 truncate text-gray-700 dark:text-gray-300">{ev.command}</code>
              <select value={target[ev.stepIndex] ?? ''} onChange={(e) => setTarget({ ...target, [ev.stepIndex]: e.target.value })} aria-label={`Criterion for ${ev.command}`} className="px-2 py-1 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200">
                <option value="">criterion…</option>
                {rows.map((r) => (
                  <option key={r.criterionId} value={r.criterionId}>{criteriaById.get(r.criterionId)?.text ?? r.criterionId}</option>
                ))}
              </select>
              <button
                type="button"
                disabled={!target[ev.stepIndex]}
                onClick={() => {
                  const row = rows.find((r) => r.criterionId === target[ev.stepIndex]);
                  if (!row) return;
                  void testRuntimeEvidenceFromEvent(ev, { id: generateId() }).then(({ item }) => onAttach(row, item));
                }}
                className="px-2 py-1 rounded bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 disabled:opacity-50"
              >
                Attach
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

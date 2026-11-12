import type { LiveQueueSnapshot } from '../../lib/engineering/liveQueue';
import { button, muted } from './ui';

type QueueAction = 'enqueue' | 'claim' | 'complete' | 'fail' | 'expire' | 'reset';

interface Props {
  state: LiveQueueSnapshot;
  busy: boolean;
  error: string | null;
  onAction: (action: QueueAction) => void;
}

export function QueueLiveLab({ state, busy, error, onAction }: Props) {
  const last = state.events.at(-1);
  const canClaim = state.pendingCount > 0 && !state.currentClaimId;
  const canFinish = Boolean(state.currentClaimId);
  const canExpire = !canFinish && state.leasedCount > 0;
  const commands: { action: QueueAction; label: string; disabled?: boolean }[] = [
    { action: 'enqueue', label: '+ Job' },
    { action: 'claim', label: 'Claim', disabled: !canClaim },
    { action: 'complete', label: 'Complete', disabled: !canFinish },
    { action: 'fail', label: 'Fail worker', disabled: !canFinish },
    { action: 'expire', label: 'Advance clock', disabled: !canExpire },
    { action: 'reset', label: 'Reset' },
  ];
  return (
    <section className="shrink-0 rounded-xl border border-emerald-200 bg-emerald-50/50 p-2.5 text-gray-900 dark:border-emerald-900 dark:bg-emerald-950/20 dark:text-gray-100" aria-label="Live queue controls">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-1">
        <p className="text-xs font-semibold"><span className="mr-1 text-emerald-700 dark:text-emerald-400">●</span> Running actual EventQueue</p>
        <span className={'text-[10px] tabular-nums ' + muted}>t={state.atMs}ms · lease {state.leaseMs}ms</span>
      </div>
      <div className="mb-2 flex flex-wrap gap-1.5" role="group" aria-label="Queue commands">
        {commands.map(({ action, label, disabled }) => (
          <button
            key={action}
            type="button"
            disabled={busy || disabled}
            onClick={() => onAction(action)}
            className={button + ' !min-h-9 !px-2 !py-1 text-xs'}
          >{label}</button>
        ))}
      </div>
      <div aria-label="Observed queue state" className="flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className="rounded-md bg-white px-2 py-1 dark:bg-gray-800">Pending: <b>{state.pendingCount}</b></span>
        <span className="rounded-md bg-white px-2 py-1 dark:bg-gray-800">Leased: <b>{state.leasedCount}</b></span>
        <span className="rounded-md bg-white px-2 py-1 dark:bg-gray-800">Done: <b>{state.completedIds.length}</b></span>
        <span className="rounded-md bg-white px-2 py-1 dark:bg-gray-800">Dead: <b>{state.deadLetterCount}</b></span>
      </div>
      {state.jobs.length > 0 && (
        <div aria-label="Job observations" className="mt-1.5 flex max-h-16 flex-wrap gap-1.5 overflow-y-auto">
          {state.jobs.map((job) => (
            <span key={job.id} className="rounded bg-white px-2 py-0.5 font-mono text-[10px] dark:bg-gray-800">
              {job.id}: {job.state} · try {job.attempts}
            </span>
          ))}
        </div>
      )}
      <div className="mt-2 flex items-center justify-between gap-2">
        <p aria-live="polite" className="min-w-0 truncate text-xs" title={last?.detail}><b>{last?.label}</b> · {last?.detail}</p>
        <details className="group shrink-0 text-xs">
          <summary className="cursor-pointer text-violet-700 dark:text-violet-300">Trace ({state.events.length})</summary>
          <ol aria-label="Real execution trace" className="mt-1 max-h-32 w-full max-w-xs space-y-1 overflow-auto rounded-lg bg-white p-2 text-gray-900 shadow dark:bg-gray-800 dark:text-gray-100">
            {state.events.map((event) => <li key={event.number}>{event.number}. t={event.atMs}: {event.label} — {event.detail}</li>)}
          </ol>
        </details>
      </div>
      {error && <p role="alert" className="mt-1 text-xs text-red-700 dark:text-red-300">{error}</p>}
      <p className={'mt-1 text-[10px] ' + muted}>Real queue methods and inspected state; only the worker crash is simulated by abandoning its lease. Nothing is written to your projects.</p>
    </section>
  );
}

export type { QueueAction };

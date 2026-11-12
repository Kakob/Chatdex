import { useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import type { EngineeringEvidenceRun } from '../../types/engineering';
import { compareRuns, unmappedTests, type CriterionOutcome } from '../../lib/engineering/io/verification';
import { deliveryContract, QUEUE_CRITERIA } from '../../lib/engineering/rules';
import type { EngineeringSnapshot } from '../../lib/engineering/storage';
import { Badge, button, muted, panel, primaryButton, SectionTitle, type Tone } from './ui';
import { shortSha } from './helpers';

const OUTCOME_TONE: Record<CriterionOutcome, Tone> = { passed: 'green', failed: 'red', not_run: 'gray' };
const STATUS_TONE: Record<string, Tone> = { supported: 'green', contradicted: 'red', partial: 'amber', unverified: 'gray' };

export interface EvidenceActions {
  importFile: (text: string, fileName: string, proposalId?: string) => Promise<string[] | null>;
  accept: (proposalId: string, runId: string) => Promise<void>;
}

function RunSummary({ run }: { run: EngineeringEvidenceRun }) {
  const counts = run.manifest.tests.reduce<Record<string, number>>((acc, t) => ({ ...acc, [t.status]: (acc[t.status] ?? 0) + 1 }), {});
  const known = new Set(QUEUE_CRITERIA.map((c) => c.id));
  const unmapped = unmappedTests(run, known);
  return (
    <li className="rounded-lg border border-gray-200 p-2 text-sm dark:border-gray-800" data-testid={`run-${run.manifest.revision.sha.slice(0, 12)}`}>
      <div className="flex flex-wrap items-center gap-1.5">
        <code className="font-semibold">{shortSha(run.manifest.revision.sha)}</code>
        <Badge tone={run.role === 'implementation' ? 'violet' : 'gray'}>{run.role}</Badge>
        {run.pinned ? <Badge tone="green">pinned</Badge> : <Badge tone="amber" title="Captured from a dirty working tree">unpinned · does not count</Badge>}
        <span className={`text-xs ${muted}`}>
          {counts.passed ?? 0} passed · {counts.failed ?? 0} failed{counts.skipped ? ` · ${counts.skipped} skipped` : ''} · captured {run.manifest.capturedAt}
        </span>
      </div>
      <p className={`mt-1 text-xs ${muted}`}>
        <code>{run.manifest.command}</code> · {Object.entries(run.manifest.environment).map(([k, v]) => `${k} ${v}`).join(', ')} · imported from {run.fileName}
      </p>
      {run.manifest.revision.baseSha && (
        <p className={`text-xs ${muted}`}>
          Built on <code>{shortSha(run.manifest.revision.baseSha)}</code>; changed: {run.manifest.changedPaths.join(', ') || 'none'}
        </p>
      )}
      {unmapped.length > 0 && <p className={`text-xs ${muted}`}>{unmapped.length} tests carry no criterion id (shown in counts only).</p>}
      {run.manifest.notes.map((n, i) => (
        <p key={i} className="mt-1 text-xs">
          <Badge tone="amber">agent-reported</Badge> {n.text}
        </p>
      ))}
    </li>
  );
}

export function EvidencePanel({ snapshot, actions }: { snapshot: EngineeringSnapshot; actions: EvidenceActions }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const approved = snapshot.proposals.find((p) => p.state === 'approved');
  const latestAccepted = [...snapshot.proposals].reverse().find((p) => p.state === 'accepted');
  const focus = approved ?? latestAccepted;
  const [target, setTarget] = useState<'observation' | 'implementation'>('observation');

  const baseline = focus && snapshot.evidenceRuns.find((r) => r.pinned && r.manifest.revision.sha === focus.baseSha);
  const implementations = focus ? snapshot.evidenceRuns.filter((r) => r.role === 'implementation' && r.proposalId === focus.id) : [];
  const implementation = [...implementations].reverse().find((r) => r.pinned) ?? implementations.at(-1);
  const required = new Set(focus?.approvedImpact?.criterionIds ?? []);
  const rows = focus ? compareRuns(QUEUE_CRITERIA.map((c) => c.id), required, baseline, implementation) : [];

  const onFile = async (file: File) => {
    const result = await actions.importFile(await file.text(), file.name, target === 'implementation' ? approved?.id : undefined);
    setErrors(result ?? []);
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <section className={panel} aria-labelledby="evidence-title">
      <SectionTitle>
        <span id="evidence-title">Evidence and verification</span>
      </SectionTitle>
      <p className={`mb-3 text-xs ${muted}`}>
        Chatdex runs nothing. Capture a manifest outside Chatdex with <code>npm run queue:evidence</code> (add <code>-- --base &lt;sha&gt;</code> for
        an implementation) and import the file here. Dirty working trees import as unpinned and never count.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Import as" className="rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-950" value={target} onChange={(e) => setTarget(e.target.value as typeof target)}>
          <option value="observation">Observation of a revision</option>
          <option value="implementation" disabled={!approved}>
            Implementation of the approved change
          </option>
        </select>
        <button type="button" className={button} onClick={() => fileRef.current?.click()}>
          <Upload size={14} /> Import evidence manifest
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          aria-label="Evidence manifest file"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void onFile(file);
          }}
        />
      </div>
      {errors.length > 0 && (
        <ul role="alert" className="mt-2 list-disc pl-5 text-sm text-red-700 dark:text-red-300">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}

      {snapshot.evidenceRuns.length > 0 && (
        <ul className="mt-3 space-y-2">
          {[...snapshot.evidenceRuns].reverse().map((r) => (
            <RunSummary key={r.id} run={r} />
          ))}
        </ul>
      )}

      {focus && (
        <div className="mt-4 overflow-x-auto">
          <p className="mb-2 text-sm font-medium">
            Before → proposed → implemented → verified{' '}
            <span className={`text-xs font-normal ${muted}`}>
              ({deliveryContract.describe(focus.from)} → {deliveryContract.describe(focus.to)})
            </span>
          </p>
          <table className="w-full text-left text-sm">
            <thead className={`text-xs ${muted}`}>
              <tr>
                <th className="py-1 pr-3">Criterion</th>
                <th className="py-1 pr-3">Before {baseline ? <code>{shortSha(baseline.manifest.revision.sha)}</code> : ''}</th>
                <th className="py-1 pr-3">Proposed</th>
                <th className="py-1 pr-3">Implemented {implementation ? <code>{shortSha(implementation.manifest.revision.sha)}</code> : ''}</th>
                <th className="py-1">Verification</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.criterionId} className="border-t border-gray-100 align-top dark:border-gray-800" data-testid={`criterion-${r.criterionId}`}>
                  <td className="py-1.5 pr-3">
                    <code className="font-semibold">{r.criterionId}</code>
                    <p className={`text-xs ${muted}`}>{QUEUE_CRITERIA.find((c) => c.id === r.criterionId)?.text}</p>
                  </td>
                  <td className="py-1.5 pr-3">
                    <Badge tone={OUTCOME_TONE[r.before]}>{r.before.replace('_', ' ')}</Badge>
                  </td>
                  <td className="py-1.5 pr-3">{r.required ? <Badge tone="violet">required</Badge> : <span className={`text-xs ${muted}`}>not required</span>}</td>
                  <td className="py-1.5 pr-3">
                    <Badge tone={OUTCOME_TONE[r.after]}>{r.after.replace('_', ' ')}</Badge>
                    {r.failureMessage && <p className="mt-1 text-xs text-red-700 dark:text-red-300">{r.failureMessage}</p>}
                  </td>
                  <td className="py-1.5">
                    <Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className={`mt-2 text-xs ${muted}`}>
            A passing test supports one criterion at one revision. It does not prove the design. Criteria with no test run stay unverified.
          </p>
          {approved && implementation && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={primaryButton}
                disabled={!implementation.pinned}
                onClick={() => void actions.accept(approved.id, implementation.id)}
              >
                Accept new understanding at {shortSha(implementation.manifest.revision.sha)}
              </button>
              <span className={`text-xs ${muted}`}>
                Creates contract v-next and supersedes the current one. Unsupported criteria become open questions. Nothing is accepted
                automatically.
              </span>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

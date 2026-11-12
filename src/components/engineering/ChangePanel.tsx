import { useMemo, useState } from 'react';
import { ArrowRight, Download } from 'lucide-react';
import type { ChangeImpact, ContractChangeProposal, ContractValues } from '../../types/engineering';
import { conceptOfStatement, contractValuesOf, deriveImpact, describeStep } from '../../lib/engineering/impact';
import { renderHandoffJson, renderHandoffMarkdown } from '../../lib/engineering/io/handoff';
import { deliveryContract, queueDeliveryRules } from '../../lib/engineering/rules';
import { currentContract, type EngineeringSnapshot } from '../../lib/engineering/storage';
import { Badge, button, field, muted, panel, primaryButton, SectionTitle } from './ui';
import { downloadText, shortSha } from './helpers';

export interface ChangeActions {
  saveDraft: (to: ContractValues, rationale: string) => Promise<void>;
  approve: (proposalId: string, baseSha: string) => Promise<void>;
  withdraw: (proposalId: string) => Promise<void>;
}

export function ImpactView({
  impact,
  titleOf,
  onSelect,
}: {
  impact: ChangeImpact;
  titleOf: (id: string) => string;
  onSelect: (conceptId: string) => void;
}) {
  const unknown = impact.affectedConcepts.filter((c) => c.status === 'unknown');
  const byConcept = new Map<string, typeof impact.obligations>();
  for (const o of impact.obligations) byConcept.set(o.conceptId, [...(byConcept.get(o.conceptId) ?? []), o]);

  if (impact.obligations.length === 0) {
    return <p className={`text-sm ${muted}`}>No rule in {impact.rulePack.id}@{impact.rulePack.version} fires for this change.</p>;
  }
  return (
    <div className="space-y-3" aria-label="Impact">
      <p className={`text-xs ${muted}`}>
        {impact.obligations.length} obligations from authored rule pack <code>{impact.rulePack.id}@{impact.rulePack.version}</code>, placed
        through modeled relationships. Not AI-inferred.
      </p>
      {[...byConcept.entries()].map(([conceptId, obligations]) => {
        const path = obligations[0].path;
        return (
          <div key={conceptId} className="rounded-lg border border-gray-200 p-3 dark:border-gray-800">
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="text-sm font-semibold text-violet-700 hover:underline dark:text-violet-400" onClick={() => onSelect(conceptId)}>
                {titleOf(conceptId)}
              </button>
              <span className={`text-xs ${muted}`}>
                {path === null
                  ? 'model gap: no relationship reaches this concept'
                  : path.length === 0
                    ? 'the contract’s own concept'
                    : `via ${path.map((s) => describeStep(s, titleOf)).join(' → ')}`}
              </span>
            </div>
            <ul className="mt-2 space-y-2">
              {obligations.map((o) => (
                <li key={o.id} className="text-sm" data-testid={`obligation-${o.id}`}>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge tone={o.kind === 'verification' ? 'green' : 'violet'}>{o.kind}</Badge>
                    <span className="text-gray-900 dark:text-gray-100">{o.title}</span>
                  </div>
                  <details className={`mt-0.5 text-xs ${muted}`}>
                    <summary className="cursor-pointer">Why</summary>
                    <p>
                      {o.trigger.join('; ')} → rule <code>{o.ruleId}</code>: {o.because}
                    </p>
                  </details>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      {unknown.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-900/20">
          <p className="font-medium text-amber-900 dark:text-amber-200">Impact unknown</p>
          <p className="text-xs text-amber-800 dark:text-amber-300">The change reaches these concepts, but no rule says what must change. Unknown is not "no impact".</p>
          <ul className="mt-1 space-y-1">
            {unknown.map((c) => (
              <li key={c.conceptId}>
                <button type="button" className="font-medium hover:underline" onClick={() => onSelect(c.conceptId)}>
                  {titleOf(c.conceptId)}
                </button>{' '}
                <span className="text-xs">via {c.path.map((s) => describeStep(s, titleOf)).join(' → ') || 'the contract itself'}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ContractEditor({
  snapshot,
  draft,
  actions,
  onSelect,
}: {
  snapshot: EngineeringSnapshot;
  draft?: ContractChangeProposal;
  actions: ChangeActions;
  onSelect: (conceptId: string) => void;
}) {
  const statement = currentContract(snapshot)!;
  const current = contractValuesOf(statement);
  const [values, setValues] = useState<ContractValues>(draft?.to ?? current);
  const [rationale, setRationale] = useState(draft?.rationale ?? '');
  const invalid = deliveryContract.validate(values);
  const changed = deliveryContract.parameters.some((p) => values[p.key] !== current[p.key]);
  const impact = useMemo(() => {
    if (invalid || !changed) return null;
    return deriveImpact(snapshot, { statementId: statement.id, contractKey: deliveryContract.key, from: current, to: values }, deliveryContract, queueDeliveryRules);
    // current is derived from statement; values drive recomputation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot, statement.id, values, invalid, changed]);
  const titleOf = (id: string) => snapshot.concepts.find((c) => c.id === id)?.title ?? id;

  return (
    <div className="space-y-3">
      {deliveryContract.parameters.map((p) => (
        <fieldset key={p.key}>
          <legend className="text-sm font-medium text-gray-900 dark:text-gray-100">{p.label}</legend>
          <div className="mt-1 grid gap-2 sm:grid-cols-3">
            {p.options.map((o) => (
              <label
                key={o.value}
                className={`cursor-pointer rounded-lg border p-2 text-sm ${
                  values[p.key] === o.value ? 'border-violet-500 bg-violet-50 dark:bg-violet-900/20' : 'border-gray-200 dark:border-gray-800'
                }`}
              >
                <span className="flex items-center gap-2 font-medium">
                  <input type="radio" name={p.key} value={o.value} checked={values[p.key] === o.value} onChange={() => setValues({ ...values, [p.key]: o.value })} />
                  {o.label}
                  {current[p.key] === o.value && <Badge>current</Badge>}
                </span>
                <span className={`mt-1 block text-xs ${muted}`}>{o.description}</span>
              </label>
            ))}
          </div>
        </fieldset>
      ))}
      {invalid && changed && <p className="text-sm text-amber-700 dark:text-amber-300">{invalid}</p>}
      <label className="block text-sm font-medium">
        Rationale
        <textarea className={`${field} mt-1`} rows={2} value={rationale} onChange={(e) => setRationale(e.target.value)} placeholder="Why this guarantee should change" />
      </label>
      {impact && (
        <div>
          <p className="mb-2 text-sm text-gray-900 dark:text-gray-100">
            <span className={muted}>Proposed:</span> {deliveryContract.describe(values)}
          </p>
          <ImpactView impact={impact} titleOf={titleOf} onSelect={onSelect} />
        </div>
      )}
      <button type="button" className={primaryButton} disabled={Boolean(invalid) || !changed} onClick={() => void actions.saveDraft(values, rationale)}>
        {draft ? 'Update draft' : 'Save as draft change'}
      </button>
      <p className={`text-xs ${muted}`}>Saving a draft changes nothing about the model or the code.</p>
    </div>
  );
}

export function ChangePanel({
  snapshot,
  actions,
  onSelect,
}: {
  snapshot: EngineeringSnapshot;
  actions: ChangeActions;
  onSelect: (conceptId: string) => void;
}) {
  const statement = currentContract(snapshot);
  const open = snapshot.proposals.filter((p) => p.state === 'draft' || p.state === 'approved');
  const draft = open.find((p) => p.state === 'draft');
  const approved = open.find((p) => p.state === 'approved');
  const pinnedShas = [...new Set(snapshot.evidenceRuns.filter((r) => r.pinned).map((r) => r.manifest.revision.sha))];
  const [baseSha, setBaseSha] = useState('');
  const effectiveBase = baseSha || pinnedShas[0] || '';
  const titleOf = (id: string) => snapshot.concepts.find((c) => c.id === id)?.title ?? id;
  if (!statement) return null;
  const concept = conceptOfStatement(snapshot, statement.id);

  const handoffInput = (proposal: ContractChangeProposal) => ({
    project: snapshot.project,
    proposal,
    concepts: snapshot.concepts,
    bindings: snapshot.bindings,
    baselineRun: snapshot.evidenceRuns.find((r) => r.pinned && r.manifest.revision.sha === proposal.baseSha),
  });

  return (
    <section className={panel} aria-labelledby="change-title">
      <SectionTitle aside={concept && <span className={`text-xs ${muted}`}>Contract on “{concept.title}”</span>}>
        <span id="change-title">Change a guarantee</span>
      </SectionTitle>
      <p className="mb-3 text-sm">
        <span className={muted}>In force:</span> {statement.title}
      </p>

      {approved ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge tone="green">approved</Badge>
            <span>{deliveryContract.describe(approved.from)}</span>
            <ArrowRight size={14} />
            <span className="font-medium">{deliveryContract.describe(approved.to)}</span>
          </div>
          <p className={`text-xs ${muted}`}>
            Base <code>{approved.baseSha}</code> · approved {approved.approvedAt?.toISOString()} · impact frozen at approval. Nothing is
            implemented until you or an agent works on the code outside Chatdex.
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={button} onClick={() => downloadText(`change-${approved.id.slice(0, 8)}.md`, renderHandoffMarkdown(handoffInput(approved)), 'text/markdown')}>
              <Download size={14} /> Handoff .md
            </button>
            <button type="button" className={button} onClick={() => downloadText(`change-${approved.id.slice(0, 8)}.json`, renderHandoffJson(handoffInput(approved)), 'application/json')}>
              <Download size={14} /> Handoff .json
            </button>
            <button type="button" className={button} onClick={() => void actions.withdraw(approved.id)}>
              Withdraw
            </button>
          </div>
          <details>
            <summary className="cursor-pointer text-sm font-medium">Preview handoff</summary>
            <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-xs dark:bg-gray-950" data-testid="handoff-preview">
              {renderHandoffMarkdown(handoffInput(approved))}
            </pre>
          </details>
          {approved.approvedImpact && <ImpactView impact={approved.approvedImpact} titleOf={titleOf} onSelect={onSelect} />}
        </div>
      ) : (
        <>
          <ContractEditor key={draft?.id ?? statement.id} snapshot={snapshot} draft={draft} actions={actions} onSelect={onSelect} />
          {draft && (
            <div className="mt-4 space-y-2 border-t border-gray-200 pt-3 dark:border-gray-800">
              <p className="text-sm font-medium">Approve the draft</p>
              <p className={`text-xs ${muted}`}>
                Approval pins the revision the implementer starts from and freezes the derived impact. It needs pinned evidence imported at that
                revision, so the handoff carries a real “before”.
              </p>
              {pinnedShas.length === 0 ? (
                <p className="text-sm text-amber-700 dark:text-amber-300">Import pinned evidence for the base revision first (Evidence, below).</p>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <select aria-label="Base revision" className={`${field} w-auto`} value={effectiveBase} onChange={(e) => setBaseSha(e.target.value)}>
                    {pinnedShas.map((sha) => (
                      <option key={sha} value={sha}>
                        {shortSha(sha)}
                      </option>
                    ))}
                  </select>
                  <button type="button" className={primaryButton} onClick={() => void actions.approve(draft.id, effectiveBase)}>
                    Approve change
                  </button>
                  <button type="button" className={button} onClick={() => void actions.withdraw(draft.id)}>
                    Discard draft
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

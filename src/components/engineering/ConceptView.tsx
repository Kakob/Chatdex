import { ChevronRight } from 'lucide-react';
import type { EngineeringEvidenceRun } from '../../types/engineering';
import { bindingStatus, BINDING_STATE_LABEL, type BindingState } from '../../lib/engineering/bindings';
import { RELATION_PROPAGATION } from '../../lib/engineering/impact';
import type { EngineeringSnapshot } from '../../lib/engineering/storage';
import { Badge, button, muted, panel, SectionTitle, type Tone } from './ui';
import { shortSha } from './helpers';

const BINDING_TONE: Record<BindingState, Tone> = {
  unobserved: 'gray',
  missing: 'amber',
  observed: 'violet',
  current: 'green',
  stale: 'amber',
};

const STATUS_TONE: Record<string, Tone> = { current: 'violet', superseded: 'gray', resolved: 'green' };

export function ConceptTree({
  snapshot,
  selectedId,
  onSelect,
}: {
  snapshot: EngineeringSnapshot;
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const children = (parent: string | null) => snapshot.concepts.filter((c) => c.parentRegionId === parent);
  const render = (parent: string | null, depth: number): React.ReactNode =>
    children(parent).map((c) => (
      <li key={c.id}>
        <button
          type="button"
          onClick={() => onSelect(c.id)}
          aria-current={c.id === selectedId ? 'true' : undefined}
          className={`w-full rounded-md px-2 py-1 text-left text-sm ${
            c.id === selectedId
              ? 'bg-violet-100 font-medium text-violet-900 dark:bg-violet-900/40 dark:text-violet-100'
              : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
          }`}
          style={{ paddingLeft: 8 + depth * 14 }}
        >
          {c.title}
        </button>
        {children(c.id).length > 0 && <ul>{render(c.id, depth + 1)}</ul>}
      </li>
    ));
  return (
    <nav aria-label="Concepts" className={panel}>
      <p className={`mb-2 text-xs font-semibold uppercase tracking-wide ${muted}`}>System model</p>
      <ul className="space-y-0.5">{render(null, 0)}</ul>
    </nav>
  );
}

export function ConceptView({
  snapshot,
  conceptId,
  reference,
  onSelect,
  onConfirmBinding,
}: {
  snapshot: EngineeringSnapshot;
  conceptId: string;
  reference: EngineeringEvidenceRun | undefined;
  onSelect: (id: string) => void;
  onConfirmBinding: (bindingId: string, runId: string) => void;
}) {
  const concept = snapshot.concepts.find((c) => c.id === conceptId);
  if (!concept) return null;
  const titleOf = (id: string) => snapshot.concepts.find((c) => c.id === id)?.title ?? id;
  const path: string[] = [];
  for (let c: typeof concept | undefined = concept; c; c = snapshot.concepts.find((p) => p.id === c!.parentRegionId)) {
    path.unshift(c.id);
  }
  const statements = concept.memberObjectIds
    .map((id) => snapshot.statements.find((s) => s.id === id))
    .filter((s): s is NonNullable<typeof s> => Boolean(s))
    .sort((a, b) => Number(a.status !== 'current') - Number(b.status !== 'current'));
  const relationships = snapshot.relationships.filter((r) => r.from === concept.id || r.to === concept.id);
  const bindings = snapshot.bindings.filter((b) => b.targetId === concept.id);

  return (
    <section className={panel} aria-labelledby="concept-title">
      <nav aria-label="Breadcrumb" className={`mb-1 flex flex-wrap items-center gap-1 text-xs ${muted}`}>
        {path.map((id, i) => (
          <span key={id} className="inline-flex items-center gap-1">
            {i > 0 && <ChevronRight size={12} />}
            <button type="button" className="hover:underline" onClick={() => onSelect(id)}>
              {titleOf(id)}
            </button>
          </span>
        ))}
      </nav>
      <div className="flex flex-wrap items-center gap-2">
        <h1 id="concept-title" className="text-xl font-semibold text-gray-900 dark:text-gray-100">
          {concept.title}
        </h1>
        {concept.kind && <Badge>{concept.kind}</Badge>}
      </div>
      {concept.summary && <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">{concept.summary}</p>}
      {concept.body && <p className={`mt-1 text-sm ${muted}`}>{concept.body}</p>}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div>
          <SectionTitle>Statements</SectionTitle>
          {statements.length === 0 && <p className={`text-sm ${muted}`}>Nothing stated about this concept.</p>}
          <ul className="space-y-2">
            {statements.map((s) => (
              <li key={s.id} className="rounded-lg border border-gray-200 p-2 dark:border-gray-800">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge tone="violet">{s.type}</Badge>
                  <Badge tone={STATUS_TONE[s.status] ?? 'gray'}>{s.status}</Badge>
                  {s.meta?.authoredBy === 'fixture' && <Badge title="Shipped synthetic demo data">Authored fixture</Badge>}
                  {typeof s.meta?.version === 'number' && <Badge>v{s.meta.version}</Badge>}
                </div>
                <p className={`mt-1 text-sm ${s.status === 'current' ? 'text-gray-900 dark:text-gray-100' : `${muted} line-through`}`}>
                  {s.title}
                </p>
                {s.body && <p className={`text-xs ${muted}`}>{s.body}</p>}
                {typeof s.meta?.implementedAt === 'string' && (
                  <p className={`text-xs ${muted}`}>
                    Implemented at <code>{shortSha(s.meta.implementedAt)}</code>
                    {s.meta.unverifiedCriteria ? ` · still unverified: ${s.meta.unverifiedCriteria}` : ' · all required criteria supported'}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>

        <div>
          <SectionTitle>Relationships</SectionTitle>
          {relationships.length === 0 && <p className={`text-sm ${muted}`}>No modeled relationships.</p>}
          <ul className="space-y-2">
            {relationships.map((r) => {
              const other = r.from === concept.id ? r.to : r.from;
              return (
                <li key={r.id} className="text-sm">
                  <span className="font-medium">{titleOf(r.from)}</span>{' '}
                  <Badge tone="violet">{r.kind.replace('_', ' ')}</Badge>{' '}
                  <span className="font-medium">{titleOf(r.to)}</span>
                  <p className={`text-xs ${muted}`}>
                    {r.explanation} · changes flow {RELATION_PROPAGATION[r.kind] === 'forward' ? `${titleOf(r.from)} → ${titleOf(r.to)}` : `${titleOf(r.to)} → ${titleOf(r.from)}`}
                    {r.author === 'fixture' ? ' · authored fixture' : ''}
                  </p>
                  <button type="button" className="text-xs text-violet-700 hover:underline dark:text-violet-400" onClick={() => onSelect(other)}>
                    Open {titleOf(other)}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      <div className="mt-4">
        <SectionTitle aside={<span className={`text-xs ${muted}`}>Compared against {reference ? <code>{shortSha(reference.manifest.revision.sha)}</code> : 'no imported evidence'}</span>}>
          Source and tests
        </SectionTitle>
        {bindings.length === 0 && <p className={`text-sm ${muted}`}>No binding — where this lives in code is unknown.</p>}
        <ul className="space-y-1.5">
          {bindings.map((b) => {
            const status = bindingStatus(b, reference);
            return (
              <li key={b.id} className="flex flex-wrap items-center gap-2 text-sm" data-testid={`binding-${b.id}`}>
                <code className="text-xs">
                  {snapshot.project.repository.root}/{b.path}
                  {status.observation ? `:${status.observation.startLine}-${status.observation.endLine}` : ''}
                </code>
                <code className="text-xs font-semibold">{b.symbol}</code>
                <Badge>{b.role}</Badge>
                <Badge tone={BINDING_TONE[status.state]}>
                  {BINDING_STATE_LABEL[status.state]}
                  {status.state === 'stale' ? (status.contentChanged ? ' · text changed' : ' · text unchanged') : ''}
                </Badge>
                {b.confirmed && <span className={`text-xs ${muted}`}>confirmed at {shortSha(b.confirmed.sha)}</span>}
                {reference && status.observation && status.state !== 'current' && (
                  <button type="button" className={button} onClick={() => onConfirmBinding(b.id, reference.id)}>
                    Confirm at {shortSha(reference.manifest.revision.sha)}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

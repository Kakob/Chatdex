/**
 * Mobile-first, operation-oriented view of verified source structure.
 * One operation at a time replaces the unreadable all-symbols hairball.
 * Relationships and branch labels come from the source snapshot; names are
 * humanized for navigation, not AI-generated behavioral claims.
 */
import { useMemo, useState } from 'react';
import { ArrowDown, ArrowRight, Braces, Code2, GitBranch, Search } from 'lucide-react';
import type { DerivedGraph, SourceEntity, SourceFile } from '../../lib/engineering/core/contracts';
import { humanizeSymbol, inspectOperation, sourceOperations } from '../../lib/engineering/core/operationLens';

interface Props {
  graph: DerivedGraph;
  sourceFiles: readonly SourceFile[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

function EntityChip({ entity, onSelect, direction }: {
  entity: SourceEntity;
  onSelect: (id: string) => void;
  direction?: 'in' | 'out';
}) {
  return (
    <button type="button" onClick={() => onSelect(entity.id)}
      aria-label={'Explore ' + entity.kind + ' ' + entity.name}
      className="flex min-h-10 w-full items-center justify-between gap-2 rounded-lg border border-slate-700 bg-slate-800/70 px-3 py-2 text-left hover:border-violet-400">
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-slate-100">{humanizeSymbol(entity.name)}</span>
        <span className="block truncate text-[11px] text-slate-400">{entity.kind} · {entity.path.split('/').at(-1)}</span>
      </span>
      {direction === 'in' ? <ArrowDown size={16} className="shrink-0 text-sky-300"/> :
        <ArrowRight size={16} className="shrink-0 text-violet-300"/>}
    </button>
  );
}

export function OperationExplorer({ graph, sourceFiles, selectedId, onSelect }: Props) {
  const [query, setQuery] = useState('');
  const operations = useMemo(() => sourceOperations(graph), [graph]);
  const chosen = operations.find((op) => op.entity.id === selectedId) ?? operations[0];
  const detail = useMemo(() => chosen
    ? inspectOperation(graph, sourceFiles, chosen.entity.id)
    : null, [chosen, graph, sourceFiles]);

  const matches = operations.filter((op) => (op.entity.name + ' ' + op.entity.path)
    .toLowerCase().includes(query.trim().toLowerCase())).slice(0, 55);
  if (!chosen || !detail) return (
    <section className="rounded-xl border border-slate-700 bg-slate-950 p-4 text-sm text-slate-300">
      No implementation operations were discovered in this source selection.
      This does not imply the project has no behavior.
    </section>
  );

  return (
    <section aria-label="Operation behavior explorer"
      className="min-w-0 space-y-3 rounded-xl border border-violet-400/40 bg-slate-950 p-3 text-slate-100">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <GitBranch size={18} className="text-violet-300"/> Explore how operations connect
          </h2>
          <p className="mt-1 text-xs text-slate-400">
            {operations.length} source operations · direct calls and branch conditions
          </p>
        </div>
      </div>

      <label className="block">
        <span className="mb-1 block text-xs text-slate-300">Choose an operation</span>
        <span className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3">
          <Search size={16} className="text-slate-400"/>
          <input aria-label="Find operation" placeholder="Search actions and methods…"
            value={query} onChange={(event) => setQuery(event.target.value)}
            className="w-full bg-transparent py-2.5 text-sm text-slate-100 outline-none placeholder:text-slate-500"/>
        </span>
      </label>
      <div role="group" aria-label="Discovered operations"
        className="flex max-h-36 gap-2 overflow-auto pb-1 lg:max-h-44">
        {matches.map((op) => (
          <button key={op.entity.id} type="button" aria-pressed={op.entity.id === chosen.entity.id}
            onClick={() => onSelect(op.entity.id)}
            className={'min-w-32 max-w-56 shrink-0 rounded-lg border px-3 py-2 text-left text-xs ' +
              (op.entity.id === chosen.entity.id ? 'border-amber-300 bg-violet-900/50 text-white' :
                'border-slate-700 bg-slate-900 text-slate-200')}>
            <span className="block truncate font-semibold">{op.label}</span>
            <span className="mt-1 block text-[11px] text-slate-400">
              {op.callCount} calls · {op.callerCount} callers
            </span>
          </button>
        ))}
        {matches.length === 0 && <p className="p-2 text-sm text-slate-300">No matching operations in the analyzed scope.</p>}
      </div>

      <div role="group" aria-label="Selected operation flow"
        className="space-y-2 rounded-xl border border-slate-700 bg-slate-900/60 p-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-sky-300">
          Called by · {detail.calledBy.length}
        </div>
        <div className="grid gap-2 md:grid-cols-2">
          {detail.calledBy.length ? detail.calledBy.slice(0, 8).map((e) =>
            <EntityChip key={e.id} entity={e} direction="in" onSelect={onSelect}/>) :
            <p className="text-xs text-slate-400">No direct callers resolved in the analyzed files.</p>}
        </div>
        <div className="flex justify-center text-slate-500"><ArrowDown size={21}/></div>
        <div className="rounded-xl border-2 border-violet-400 bg-violet-900/40 px-3 py-3">
          <span className="block text-xs uppercase tracking-wide text-violet-200">{detail.entity.kind}</span>
          <h3 className="mt-1 text-lg font-semibold text-white">{humanizeSymbol(detail.entity.name)}</h3>
          <p className="mt-1 break-all font-mono text-[11px] text-slate-300">{detail.entity.path}:{detail.entity.location.startLine}</p>
        </div>
        <div className="flex justify-center text-slate-500"><ArrowDown size={21}/></div>
        <div className="text-xs font-semibold uppercase tracking-wide text-violet-300">
          Direct calls · {detail.calls.length}
        </div>
        <div className="grid gap-2 md:grid-cols-2">
          {detail.calls.length ? detail.calls.slice(0, 8).map((e) =>
            <EntityChip key={e.id} entity={e} direction="out" onSelect={onSelect}/>) :
            <p className="text-xs text-slate-400">No direct calls resolved in the analyzed files.</p>}
        </div>
        {(detail.calls.length > 8 || detail.calledBy.length > 8) && (
          <p className="text-xs text-amber-200">Only the first eight connections in each direction are shown.</p>
        )}
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <section className="space-y-2 rounded-lg border border-slate-700 p-3">
          <h4 className="flex items-center gap-2 text-sm font-semibold"><Code2 size={16}/> Inputs and outputs</h4>
          {detail.inputs.length > 0 ? detail.inputs.map((p, i) =>
            <p key={i} className="break-words rounded-md bg-slate-900 px-2 py-1 font-mono text-xs text-slate-200">{p}</p>) :
            <p className="text-xs text-slate-400">No declared parameters.</p>}
          <p className="text-xs text-slate-400">Declared return: <span className="font-mono text-slate-200">{detail.returnType ?? 'not explicit'}</span></p>
          {detail.dataTypes.length > 0 && <>
            <h5 className="pt-1 text-xs font-medium text-teal-200">Referenced data types</h5>
            <div className="flex flex-wrap gap-2">
              {detail.dataTypes.slice(0, 8).map((e) =>
                <button key={e.id} type="button" onClick={() => onSelect(e.id)}
                  className="rounded-full border border-teal-700 px-3 py-1 text-xs text-teal-100">{e.name}</button>)}
            </div>
          </>}
        </section>

        <section className="space-y-2 rounded-lg border border-slate-700 p-3">
          <h4 className="flex items-center gap-2 text-sm font-semibold"><Braces size={16}/> Decision points in the source</h4>
          {detail.decisions.length ? (
            <div className="space-y-1">
              {detail.decisions.map((decision, i) => (
                <div key={i} className="flex items-start gap-2 rounded-md bg-slate-900 px-2 py-1.5 text-xs">
                  <span className="shrink-0 rounded bg-slate-700 px-1 text-[10px] uppercase text-slate-200">{decision.kind}</span>
                  <span className="min-w-0 flex-1 break-words font-mono text-slate-200">{decision.expression}</span>
                  <span className="shrink-0 text-slate-500">L{decision.line}</span>
                </div>
              ))}
            </div>
          ) : <p className="text-xs text-slate-400">No explicit switch, if, or loop found in this operation.</p>}
          {detail.mentionedInTests.length > 0 && (
            <div>
              <h5 className="pt-1 text-xs font-medium text-emerald-200">Name occurs in these test files</h5>
              {detail.mentionedInTests.map((path) => (
                <p key={path} className="break-all text-xs text-slate-300">{path}</p>
              ))}
              <p className="mt-1 text-[11px] text-slate-400">A text match is not a test coverage claim.</p>
            </div>
          )}
        </section>
      </div>
      <p className="text-[11px] leading-5 text-slate-400">
        This view shows structural evidence and source-level branching—not an observed execution sequence or a proven software-concept definition. Dynamic calls and external packages may not be resolved.
      </p>
    </section>
  );
}

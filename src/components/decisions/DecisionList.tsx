import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { RecordedEdits } from './RecordedEdits';
import { SpanLinks, CodeEvidenceList } from './EvidenceLists';
import { ReviewButtons } from '../understanding/ReviewButtons';
import { BASIS_LABEL, MADE_BY_LABEL, type DecisionRow } from '../../lib/understanding/decisions/decisionMatrix';
import type { ReviewState } from '../../types/understanding';

import { PAGE_SIZE, normalizedPath, evidenceCue } from '../../lib/understanding/decisions/reviewBrowser';

export type DecisionGrouping = 'session' | 'path';

export function DecisionList({ rows, projectId, grouping, conversationNames, onReview, onOpenHistory, selectedId, onSelect, page, onPage }: {
  rows: DecisionRow[];
  projectId: string;
  grouping: DecisionGrouping;
  conversationNames: Map<string, string>;
  onReview: (objectId: string, state: ReviewState) => void;
  onOpenHistory: (objectId: string) => void;
  selectedId: string;
  onSelect: (id: string) => void;
  page: number;
  onPage: (page: number) => void;
}) {
  const [expandedCode, setExpandedCode] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const groups = useMemo(() => {
    const result = new Map<string, DecisionRow[]>();
    for (const row of rows) {
      const key = grouping === 'session' ? row.meta.conversationId ?? '' : normalizedPath(row.meta.primaryPath);
      const group = result.get(key) ?? [];
      group.push(row);
      result.set(key, group);
    }
    return [...result].flatMap(([key, items]) => items.map((row) => ({ key, row })));
  }, [rows, grouping]);
  const pages = Math.max(1, Math.ceil(groups.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages - 1);
  const visible = groups.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const selected = rows.find((r) => r.object.id === selectedId);
  const t = selected?.latestTrace;
  const label = (key: string, row: DecisionRow) => grouping === 'path' ? key : key
    ? `${conversationNames.get(key) ?? 'Session'} · ${(row.meta.decidedAt ?? row.object.createdAt.toISOString()).slice(0, 10)} · ${key}`
    : 'No session recorded';
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" data-testid="decision-list">
      <div className="min-w-0">
        <div className="mb-2 flex items-center justify-between gap-2 text-xs text-gray-500">
          <span>{rows.length ? `${currentPage * PAGE_SIZE + 1}–${Math.min((currentPage + 1) * PAGE_SIZE, rows.length)}` : '0'} of {rows.length} results</span>
          <div className="flex gap-3">
            <button disabled={currentPage === 0} onClick={() => onPage(currentPage - 1)} className="disabled:opacity-40">Previous page</button>
            <span>Page {currentPage + 1} of {pages}</span>
            <button disabled={currentPage + 1 >= pages} onClick={() => onPage(currentPage + 1)} className="disabled:opacity-40">Next page</button>
          </div>
        </div>
        <div key={currentPage} ref={listRef} className="max-h-[70vh] overflow-y-auto rounded-xl border border-gray-200 dark:border-gray-800" aria-label="Decision candidates">
          {visible.map(({ key, row }, index) => (
            <div key={row.object.id}>
              {(index === 0 || visible[index - 1].key !== key) && <h2 className="break-words bg-gray-50 dark:bg-gray-950 px-3 py-2 text-xs text-gray-500">{label(key, row)}</h2>}
              <button type="button" data-testid="decision-row" data-decision-id={row.object.id}
                tabIndex={selectedId === row.object.id || (!visible.some((item) => item.row.object.id === selectedId) && index === 0) ? 0 : -1}
                aria-pressed={selectedId === row.object.id} aria-controls="decision-evidence-panel"
                onClick={() => onSelect(row.object.id)}
                onKeyDown={(event) => {
                  const next = event.key === 'ArrowDown' ? index + 1 : event.key === 'ArrowUp' ? index - 1 : event.key === 'Home' ? 0 : event.key === 'End' ? visible.length - 1 : -1;
                  if (next < 0 || next >= visible.length) return;
                  event.preventDefault();
                  onSelect(visible[next].row.object.id);
                  listRef.current?.querySelectorAll<HTMLButtonElement>('[data-decision-id]')[next]?.focus();
                }}
                className={`block w-full border-t border-gray-100 dark:border-gray-800 px-3 py-3 text-left focus-visible:outline-2 focus-visible:outline-violet-500 ${selectedId === row.object.id ? 'bg-violet-50 dark:bg-violet-950/40' : 'bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800'}`}>
                <span className="block line-clamp-2 text-sm font-medium text-gray-900 dark:text-white" title={row.object.title}>{row.object.title}</span>
                <span className="mt-1 block truncate text-xs text-gray-500">{evidenceCue(row)}</span>
                <span className="mt-1 block truncate text-xs text-gray-500">{row.object.reviewState} · step {row.meta.firstStepIndex ?? 'unrecorded'} · {normalizedPath(row.meta.primaryPath)}</span>
              </button>
            </div>
          ))}
          {!rows.length && <p className="p-6 text-sm text-gray-500">No candidates match these filters. Clear filters to see all candidates.</p>}
        </div>
        <p className="mt-2 text-xs text-gray-500">Use ↑ / ↓ to select a row, then Tab to inspect evidence. Ordered by session and citing step; no importance ranking.</p>
      </div>
      <aside id="decision-evidence-panel" aria-label="Decision evidence" tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>('[data-decision-id]'); const button = Array.from(buttons ?? []).find((b) => b.dataset.decisionId === selectedId); button?.focus(); } }}
        className="min-w-0 text-gray-800 dark:text-gray-200 max-h-[76vh] overflow-y-auto rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 space-y-4 lg:sticky lg:top-4">
        {!selected ? <div className="py-12 text-center text-sm text-gray-500">Select a candidate to inspect its evidence.<br />Selection does not accept or reject anything.</div> : <>
          <div>{!visible.some((item) => item.row.object.id === selectedId) && <button className="mb-2 text-xs text-violet-600 dark:text-violet-400" onClick={() => onPage(Math.floor(groups.findIndex((item) => item.row.object.id === selectedId) / PAGE_SIZE))}>Show selected row on its page</button>}<p className="text-xs text-violet-600 dark:text-violet-400">{selected.object.origin === 'ai' ? 'AI reconstruction · verify against sources' : 'Recorded decision'}</p><h2 className="mt-2 text-lg font-semibold break-words text-gray-900 dark:text-white">{selected.object.title}</h2></div>
          <section><h3 className="font-medium text-sm">Recorded evidence</h3>
            <p className="text-xs text-gray-500">Quotes show what was recorded. Code edits alone do not establish rationale, user authorship, or adoption. Source links open in a new tab to keep your place.</p>
            {t?.transcriptEvidence.length ? <SpanLinks spans={t.transcriptEvidence} conversationNames={conversationNames} newTab /> : <p className="mt-2 text-sm text-gray-500">No trace quotes available for this record.</p>}
            {!t && selected.evidence.map((e, i) => <Link key={i} target="_blank" rel="noopener noreferrer" className="block text-xs text-violet-600" to={`/conversations/${e.conversationId}${e.messageIds?.[0] ? `?scrollTo=${encodeURIComponent(e.messageIds?.[0])}` : ''}`}>Open source · {conversationNames.get(e.conversationId) ?? e.conversationId}</Link>)}
          </section>
          <section><h3 className="font-medium text-sm">{selected.object.origin === 'ai' ? 'AI explanation' : 'Recorded explanation'}</h3><p className="whitespace-pre-wrap break-words text-sm text-gray-600 dark:text-gray-300">{t?.why ?? selected.object.body ?? 'No explanation recorded.'}</p></section>
          <details><summary className="cursor-pointer text-sm">Original classification and attribution</summary><p className="mt-2 text-sm">Basis: {BASIS_LABEL[selected.meta.basis]} · Made by: {MADE_BY_LABEL[selected.meta.madeBy]}</p><p className="text-xs text-gray-500">{selected.meta.source === 'investigation' ? 'Classification from your investigation verdict.' : 'Legacy derived labels: quote roles constrain these values but do not prove who requested or adopted the exact choice.'} Unsupported autonomous flag: {String(selected.meta.unsupportedAutonomous)}. Conflicts with direction flag: {String(selected.meta.conflictsWithUserDirection)}.</p></details>
          {t && <>
            <details key={t.id} onToggle={(e) => setExpandedCode(e.currentTarget.open ? t.id : '')}><summary className="cursor-pointer text-sm">Code evidence · {t.implEvidence.length} excerpts · {t.anchorStableKeys.length} edit anchors</summary><CodeEvidenceList items={t.implEvidence} repoKey={t.repoKey} sha={t.sha} />{expandedCode === t.id && <RecordedEdits key={t.id} keys={t.anchorStableKeys} projectId={projectId} />}</details>
            <details><summary className="cursor-pointer text-sm">AI alternatives and assumptions · {t.alternatives.length + t.assumptions.length}</summary>{t.alternatives.map((a, i) => <div key={`alt-${i}`} className="mt-2 text-sm"><p>{a.statement}</p><p>{a.rejectedBecause}</p><SpanLinks spans={a.transcriptEvidence} conversationNames={conversationNames} newTab /></div>)}{t.assumptions.map((a) => <div key={a.id} className="mt-2 text-sm"><p>{a.statement}</p><p>{a.rationale}</p><SpanLinks spans={a.transcriptEvidence} conversationNames={conversationNames} newTab /><CodeEvidenceList items={a.codeEvidence} repoKey={t.repoKey} sha={t.sha} /></div>)}</details>
            <details><summary className="cursor-pointer text-sm">Recovery provenance and warnings · {t.warnings.length} saved</summary><p className="mt-2 break-all text-xs">Run {t.runId} · {t.createdAt.toISOString()} · {t.provider} / {t.model}</p><p className="break-all text-xs">Recorded snapshot: {t.sha ? `${t.repoKey ?? 'Repository unrecorded'} @ ${t.sha}${t.sha === 'local' ? ' (working tree, not an immutable commit)' : ''}` : 'No repository snapshot recorded'}</p><p className="text-xs text-gray-500">This is the analysis snapshot, independent of the current repository binding. Saved warnings may apply to the session; they are not a complete run health report.</p><ul className="list-disc pl-4 text-xs">{t.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></details>
          </>}
          <section className="border-t border-gray-200 dark:border-gray-800 pt-3"><h3 className="font-medium text-sm">Review reconstruction · {selected.object.reviewState}</h3><p className="my-2 text-xs text-gray-500">Accept marks this object accepted in project understanding. Reject excludes it from this list; its stored record and traces remain. Neither action records a separate endorsement for future work or reviews pending events. Check whether this accurately describes the history.</p>{selected.object.reviewState === 'pending' && <ReviewButtons onReview={(state) => onReview(selected.object.id, state)} />}</section>
          <div className="flex flex-wrap gap-4 text-sm text-violet-600"><button onClick={() => onOpenHistory(selected.object.id)}>Review history</button><Link target="_blank" rel="noopener noreferrer" to={`/projects/${projectId}/decisions/${encodeURIComponent(selected.object.id)}`}>Full detail and actions ↗</Link></div>
        </>}
      </aside>
    </div>
  );
}

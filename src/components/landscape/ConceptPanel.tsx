// Editable landscape (docs/changes/editable-landscape): create, develop, and
// reorganize concepts directly on the map, with no imported conversation
// required. A concept is a LandscapeRegion; statements about it are ordinary
// user-origin UnderstandingObjects placed in it, so they also appear in
// Current Understanding, Prepare Change, and project chat context.
//
// Every write is an explicit user action (Enter, Save, a button). AI
// proposals are never applied here without Accept / Edit & accept.

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  addConceptStatement,
  createRegion,
  deleteRegion,
  moveRegion,
  renameRegion,
  setMembership,
  setRegionBody,
  setRegionKind,
  setRegionParent,
  setRegionSummary,
} from '../../lib/db/landscape';
import { reviewUnderstandingObject, reviseUnderstandingObject, setEventReviewState } from '../../lib/db/understanding';
import { CONCEPT_KINDS, wouldCreateCycle } from '../../lib/landscape/organize';
import { acceptedConceptIds, groupStatements, STATEMENT_SECTIONS, supportOf, type StatementSection } from '../../lib/landscape/concept';
import { regionPath, type Landscape, type LandscapeFinding, type LandscapeRegionNode } from '../../lib/landscape/projection';
import { formatDay, formatMoment } from '../../lib/landscape/lens';
import { toHref, withLocation, type ResolvedView } from '../../lib/landscape/route';
import type { LandscapeRegion, LandscapeRegionRevision } from '../../types/landscape';
import type { UnderstandingEvent } from '../../types/understanding';

type Run = (fn: () => Promise<unknown>) => Promise<boolean>;

/** Shared error-reporting wrapper: runs a write, reloads on success. */
function useRun(onChanged: () => void): [Run, string | null] {
  const [error, setError] = useState<string | null>(null);
  const run: Run = async (fn) => {
    setError(null);
    try {
      await fn();
      onChanged();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    }
  };
  return [run, error];
}

function flatten(nodes: LandscapeRegionNode[]): LandscapeRegionNode[] {
  return nodes.flatMap((n) => [n, ...flatten(n.children)]);
}

// --- inline add -----------------------------------------------------------------

/**
 * "+ Add" that turns into a one-line field: Enter saves (and stays open for
 * the next entry), Escape or an empty blur cancels.
 */
export function InlineAdd({
  label,
  placeholder,
  onSubmit,
  className = 'mini-button',
  autoOpen = false,
}: {
  label: string;
  placeholder: string;
  onSubmit: (text: string) => Promise<boolean>;
  className?: string;
  autoOpen?: boolean;
}) {
  const [open, setOpen] = useState(autoOpen);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<string | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  // Closing returns focus to the "+ Add" button that opened the field.
  useEffect(() => {
    if (!open && returnFocus.current) {
      returnFocus.current = false;
      button.current?.focus();
    }
  }, [open]);
  const close = () => {
    returnFocus.current = true;
    setOpen(false);
    setText('');
  };
  if (!open) {
    return (
      <button ref={button} type="button" className={className} onClick={() => setOpen(true)}>
        + {label}
      </button>
    );
  }
  const submit = async () => {
    const value = text.trim();
    if (!value || busy) return;
    setBusy(true);
    const ok = await onSubmit(value);
    setBusy(false);
    if (ok) {
      setLast(value);
      setText('');
    }
  };
  return (
    <div className="inline-add">
      <input
        type="text"
        autoFocus
        aria-label={label}
        placeholder={placeholder}
        value={text}
        // Not `disabled` while saving: a disabled field loses focus, and the
        // next Escape would then step the landscape out a level.
        aria-busy={busy}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void submit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            close();
          }
        }}
        onBlur={() => {
          if (!text.trim()) close();
        }}
      />
      <small>
        Enter to add · Esc to {last ? 'finish' : 'cancel'}
        {last ? ` · added “${last}”` : ''}
      </small>
    </div>
  );
}

/** Map overlay: add a concept at this level of the landscape. */
export function AddConceptControl({
  projectId,
  parent,
  onChanged,
}: {
  projectId: string;
  parent: LandscapeRegionNode | null;
  onChanged: () => void;
}) {
  const [run, error] = useRun(onChanged);
  return (
    <div className="map-actions">
      <InlineAdd
        className="add-button"
        label={parent ? `Add inside ${parent.title}` : 'Add concept'}
        placeholder={parent ? `New concept inside ${parent.title}` : 'New concept, e.g. Chart'}
        onSubmit={(title) => run(() => createRegion({ projectId, title, parentRegionId: parent?.id ?? null }))}
      />
      {error && (
        <span className="status-note" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

// --- editable fields ----------------------------------------------------------------

function EditableLine({
  value,
  label,
  placeholder,
  onSave,
  list,
}: {
  value: string;
  label: string;
  placeholder: string;
  onSave: (v: string) => Promise<boolean>;
  list?: string;
}) {
  const [draft, setDraft] = useState(value);
  // Saved elsewhere (or reloaded): adopt the stored value.
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setDraft(value);
  }
  const commit = () => {
    if (draft.trim() !== value.trim()) void onSave(draft);
  };
  return (
    <input
      type="text"
      aria-label={label}
      placeholder={placeholder}
      value={draft}
      list={list}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          setDraft(value);
        }
      }}
    />
  );
}

function EditableText({ value, label, placeholder, onSave }: { value: string; label: string; placeholder: string; onSave: (v: string) => Promise<boolean> }) {
  const [draft, setDraft] = useState(value);
  const [saved, setSaved] = useState(false);
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setDraft(value);
  }
  const dirty = draft.trim() !== value.trim();
  const save = async () => {
    if (!dirty) return;
    if (await onSave(draft)) setSaved(true);
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void save();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setDraft(value);
    }
  };
  return (
    <div className="edit-block">
      <textarea
        aria-label={label}
        placeholder={placeholder}
        value={draft}
        rows={Math.min(12, Math.max(3, draft.split('\n').length + 1))}
        onChange={(e) => {
          setDraft(e.target.value);
          setSaved(false);
        }}
        onKeyDown={onKey}
      />
      <div className="edit-row">
        <button type="button" className="mini-button" disabled={!dirty} onClick={() => void save()}>
          Save
        </button>
        {dirty && (
          <button type="button" className="mini-button" onClick={() => setDraft(value)}>
            Discard
          </button>
        )}
        <small>{dirty ? '⌘/Ctrl+Enter to save · Esc discards' : saved ? 'Saved' : ''}</small>
      </div>
    </div>
  );
}

// --- statements -------------------------------------------------------------------

/** Rewording / review controls for one statement. */
export function StatementControls({ finding, onChanged }: { finding: LandscapeFinding; onChanged: () => void }) {
  const [run, error] = useRun(onChanged);
  const o = finding.object;
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(o.title);
  const [body, setBody] = useState(o.body ?? '');
  const pending = o.reviewState === 'pending';
  const begin = () => {
    setTitle(o.title);
    setBody(o.body ?? '');
    setEditing(true);
  };
  if (editing) {
    const save = async () => {
      const ok = pending
        ? await run(() => reviewUnderstandingObject(o.id, 'edited', { title, body }))
        : await run(() => reviseUnderstandingObject(o.id, { title, body }));
      if (ok) setEditing(false);
    };
    return (
      <div className="edit-block statement-edit">
        <input type="text" aria-label="Statement" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), setEditing(false))} />
        <textarea aria-label="Details" placeholder="Optional details" value={body} rows={3} onChange={(e) => setBody(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), setEditing(false))} />
        <div className="edit-row">
          <button type="button" className="mini-button" disabled={!title.trim()} onClick={() => void save()}>
            {pending ? 'Accept with edits' : 'Save'}
          </button>
          <button type="button" className="mini-button" onClick={() => setEditing(false)}>
            Cancel
          </button>
          <small>{pending ? 'The AI wording stays in history.' : 'The previous wording stays in history.'}</small>
        </div>
        {error && <p className="status-note" role="alert">{error}</p>}
      </div>
    );
  }
  if (o.reviewState === 'rejected') return null;
  return (
    <div className="edit-row statement-actions">
      {pending ? (
        <>
          <button type="button" className="mini-button" onClick={() => void run(() => reviewUnderstandingObject(o.id, 'accepted'))}>
            Accept
          </button>
          <button type="button" className="mini-button" onClick={begin}>
            Edit & accept
          </button>
          <button type="button" className="mini-button danger" onClick={() => void run(() => reviewUnderstandingObject(o.id, 'rejected'))}>
            Reject
          </button>
        </>
      ) : (
        <button type="button" className="mini-button" onClick={begin}>
          Edit wording
        </button>
      )}
      {error && <span className="status-note" role="alert">{error}</span>}
    </div>
  );
}

/** A pending proposed change to a statement (e.g. an AI rewording). */
export function ProposedEventControls({ event, onChanged }: { event: UnderstandingEvent; onChanged: () => void }) {
  const [run, error] = useRun(onChanged);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(event.revision?.title ?? '');
  const [body, setBody] = useState(event.revision?.body ?? '');
  if (event.reviewState !== 'pending') return null;
  return (
    <div className="edit-block">
      {editing && event.revision ? (
        <>
          <input type="text" aria-label="Proposed statement" value={title} onChange={(e) => setTitle(e.target.value)} />
          <textarea aria-label="Proposed details" value={body} rows={3} onChange={(e) => setBody(e.target.value)} />
          <div className="edit-row">
            <button type="button" className="mini-button" disabled={!title.trim()} onClick={() => void run(() => setEventReviewState(event.id, 'edited', { title, body }))}>
              Accept with edits
            </button>
            <button type="button" className="mini-button" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </>
      ) : (
        <div className="edit-row">
          <button type="button" className="mini-button" onClick={() => void run(() => setEventReviewState(event.id, 'accepted'))}>
            Accept
          </button>
          {event.revision && (
            <button type="button" className="mini-button" onClick={() => setEditing(true)}>
              Edit & accept
            </button>
          )}
          <button type="button" className="mini-button danger" onClick={() => void run(() => setEventReviewState(event.id, 'rejected'))}>
            Reject
          </button>
        </div>
      )}
      {error && <p className="status-note" role="alert">{error}</p>}
    </div>
  );
}

function StatementRow({ finding, href, onChanged }: { finding: LandscapeFinding; href: string; onChanged: () => void }) {
  const support = supportOf(finding);
  const proposals = finding.events.filter((e) => e.reviewState === 'pending');
  return (
    <div className={`statement ${support.level}`}>
      <Link to={href} className="statement-title">
        {finding.object.title}
      </Link>
      {finding.object.body && <p className="statement-body">{finding.object.body}</p>}
      <small>
        {support.label}
        {finding.evidence.length ? ` · ${finding.evidence.length} source${finding.evidence.length === 1 ? '' : 's'}` : ''}
      </small>
      <StatementControls finding={finding} onChanged={onChanged} />
      {proposals.map((e) => (
        <div key={e.id} className="proposal">
          <small>
            {e.origin === 'ai' ? 'AI' : 'You'} proposed: {e.revision ? `“${e.revision.title}”` : e.op}
            {e.detail ? ` — ${e.detail}` : ''}
          </small>
          <ProposedEventControls event={e} onChanged={onChanged} />
        </div>
      ))}
    </div>
  );
}

function StatementSectionBlock({
  section,
  findings,
  region,
  hrefFor,
  onChanged,
}: {
  section: StatementSection;
  findings: LandscapeFinding[];
  region: LandscapeRegion;
  hrefFor: (id: string) => string;
  onChanged: () => void;
}) {
  const [run, error] = useRun(onChanged);
  if (!section.type && findings.length === 0) return null;
  return (
    <section className="concept-section" aria-label={section.label}>
      <div className="section-label">
        {section.label}
        {findings.length ? ` · ${findings.length}` : ''}
      </div>
      <p className="hint">{section.hint}</p>
      {findings.map((f) => (
        <StatementRow key={f.object.id} finding={f} href={hrefFor(f.object.id)} onChanged={onChanged} />
      ))}
      {section.type && (
        <InlineAdd
          label={`Add ${section.label.toLowerCase()}`}
          placeholder={section.placeholder}
          onSubmit={(title) => run(() => addConceptStatement(region.id, { type: section.type!, title }))}
        />
      )}
      {error && <p className="status-note" role="alert">{error}</p>}
    </section>
  );
}

// --- link existing understanding ------------------------------------------------------

function LinkExisting({ node, landscape, onChanged }: { node: LandscapeRegionNode; landscape: Landscape; onChanged: () => void }) {
  const [run, error] = useRun(onChanged);
  const [q, setQ] = useState('');
  const project = landscape.projects.find((p) => p.key === node.projectKey)!;
  const candidates = useMemo(() => {
    const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return project.findingIds
      .map((id) => landscape.findings.get(id)!)
      .filter((f) => !node.directIds.includes(f.object.id))
      .filter((f) => terms.every((t) => `${f.object.title} ${f.object.body ?? ''} ${f.object.type}`.toLowerCase().includes(t)));
  }, [q, project, landscape, node.directIds]);
  return (
    <section aria-label="Link existing understanding">
      <div className="section-label">Link existing understanding</div>
      <p className="hint">Place a record that already exists in {project.name} here. It is linked, not copied; its history and other placements are kept.</p>
      <div className="edit-row">
        <input type="text" aria-label="Find existing understanding" placeholder={`Search ${project.findingIds.length} records in ${project.name}`} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {q.trim() &&
        (candidates.length ? (
          candidates.slice(0, 8).map((f) => (
            <div key={f.object.id} className="edit-block edit-row">
              <span style={{ flex: 1 }}>
                {f.object.title}
                <small className="sub">
                  {f.object.type} · {supportOf(f).label}
                  {f.regionIds.length ? ` · also in ${f.regionIds.map((id) => landscape.regions.get(id)?.title).filter(Boolean).join(', ')}` : ' · uncategorized'}
                </small>
              </span>
              <button type="button" className="mini-button" onClick={() => void run(() => setMembership(node.id, f.object.id, true))}>
                Place here
              </button>
            </div>
          ))
        ) : (
          <p className="note">No other record in {project.name} matches.</p>
        ))}
      {candidates.length > 8 && q.trim() && <p className="hint">{candidates.length - 8} more match — refine the search.</p>}
      {error && <p className="status-note" role="alert">{error}</p>}
    </section>
  );
}

// --- history ---------------------------------------------------------------------------

function revisionText(r: LandscapeRegionRevision, titleOf: (id: string | null | undefined) => string): ReactNode {
  const quote = (v: string | null | undefined, max = 90) => (v ? `“${v.length > max ? `${v.slice(0, max)}…` : v}”` : 'nothing');
  switch (r.field) {
    case 'created':
      return <>Created as {quote(r.to)}</>;
    case 'title':
      return <>Renamed from {quote(r.from)} to {quote(r.to)}</>;
    case 'summary':
      return <>Summary changed from {quote(r.from)} to {quote(r.to)}</>;
    case 'body':
      return r.to ? (r.from ? <>Description edited (was {quote(r.from, 60)})</> : <>Description written</>) : <>Description cleared (was {quote(r.from, 60)})</>;
    case 'kind':
      return <>Kind set from {quote(r.from)} to {quote(r.to)}</>;
    case 'parent':
      return <>Moved from {titleOf(r.from)} to {titleOf(r.to)}</>;
  }
}

// --- the panel -------------------------------------------------------------------------

export function ConceptPanel({ view, landscape, onChanged }: { view: ResolvedView; landscape: Landscape; onChanged: () => void }) {
  const navigate = useNavigate();
  const [run, error] = useRun(onChanged);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const project = view.project!;
  const node = view.region!;
  const region = node.region!;
  const params = view.params;
  const projectId = project.key;
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, [region.id]);

  const own = node.directIds.map((id) => landscape.findings.get(id)!).filter(Boolean);
  const grouped = groupStatements(own);
  const hrefFor = (id: string) => toHref(withLocation(params, { project: projectId, region: node.id, finding: id }));
  const all = flatten(project.regions).filter((n) => n.region);
  const rows = all.map((n) => n.region!);
  const parentOptions = all.filter((other) => other.id !== region.id && !wouldCreateCycle(rows, region.id, other.id));
  const accepted = acceptedConceptIds(landscape, node);
  const pendingCount = own.filter((f) => f.object.reviewState === 'pending').length + own.reduce((n, f) => n + f.pendingEventCount, 0);
  const titleOf = (id: string | null | undefined) => (id ? `“${landscape.regions.get(id)?.title ?? 'a deleted concept'}”` : 'the top level');
  const revisions = [...(region.revisions ?? [])].reverse();
  const path = regionPath(landscape, node);

  return (
    <>
      <Link className="close" to={toHref({ ...params, panel: undefined })} aria-label="Close concept">
        ×
      </Link>
      <span className="pill reviewed">Concept</span>
      {region.kind && <span className="pill">{region.kind}</span>}
      {pendingCount > 0 && <span className="pill">{pendingCount} to review</span>}
      <h2 ref={heading} tabIndex={-1}>
        {region.title}
      </h2>
      <div className="meta">
        <span>{[project.name, ...path.map((n) => n.title)].join(' › ')}</span>
        <span>Created {formatDay(region.createdAt)}</span>
        <span>
          {node.children.length} sub-concept{node.children.length === 1 ? '' : 's'} · {node.allIds.length} record{node.allIds.length === 1 ? '' : 's'}
        </span>
      </div>
      <p className="note">A concept names something you want to understand or work on. Creating it does not claim the software does it; statements below say what you intend, believe, and still ask.</p>

      <div className="section-label">Name, kind, and summary</div>
      <div className="edit-row">
        <EditableLine value={region.title} label="Concept name" placeholder="Name" onSave={(v) => run(() => renameRegion(region.id, v))} />
      </div>
      <div className="edit-row" style={{ marginTop: 6 }}>
        <EditableLine value={region.kind ?? ''} label="Kind (optional)" placeholder="Kind (optional), e.g. feature" list="ldx-concept-kinds" onSave={(v) => run(() => setRegionKind(region.id, v))} />
        <datalist id="ldx-concept-kinds">
          {CONCEPT_KINDS.map((k) => (
            <option key={k} value={k} />
          ))}
        </datalist>
      </div>
      <div className="edit-row" style={{ marginTop: 6 }}>
        <EditableLine value={region.summary ?? ''} label="One-line summary" placeholder="One-line summary shown on the map" onSave={(v) => run(() => setRegionSummary(region.id, v))} />
      </div>

      <div className="section-label">Description</div>
      <EditableText value={region.body ?? ''} label="Description" placeholder="What is this? What does it cover? Write as much or as little as you like." onSave={(v) => run(() => setRegionBody(region.id, v))} />

      {STATEMENT_SECTIONS.map((section) => (
        <StatementSectionBlock key={section.label} section={section} findings={grouped.get(section)!} region={region} hrefFor={hrefFor} onChanged={onChanged} />
      ))}

      <div className="section-label">Sub-concepts · {node.children.length}</div>
      {node.children.map((child) => (
        <Link key={child.id} className="list-row" to={toHref(withLocation(params, { project: projectId, region: child.id }))}>
          {child.title}
          <small>
            {child.children.length ? `${child.children.length} sub-concepts · ` : ''}
            {child.allIds.length} record{child.allIds.length === 1 ? '' : 's'}
          </small>
        </Link>
      ))}
      <InlineAdd label="Add sub-concept" placeholder={`New concept inside ${region.title}`} onSubmit={(title) => run(() => createRegion({ projectId, title, parentRegionId: region.id }))} />

      <LinkExisting node={node} landscape={landscape} onChanged={onChanged} />

      <div className="section-label">Work with it</div>
      <Link className="external primary" to={`/chat?project=${encodeURIComponent(projectId)}&concept=${encodeURIComponent(region.id)}`}>
        Discuss with AI →
      </Link>
      {accepted.length > 0 ? (
        <Link className="external" to={`/projects/${projectId}/prepare?understanding=${accepted.map(encodeURIComponent).join(',')}`}>
          Prepare a change from {accepted.length} accepted record{accepted.length === 1 ? '' : 's'} →
        </Link>
      ) : (
        <p className="hint">Prepare Change uses accepted, current records. Add or accept a statement here to start one.</p>
      )}
      <p className="hint">Discussing shows you exactly what is sent and asks before the first message goes to a provider.</p>

      <div className="section-label">Move</div>
      <div className="edit-row">
        <select aria-label={`Move ${region.title} into`} value={region.parentRegionId ?? ''} onChange={(e) => void run(() => setRegionParent(region.id, e.target.value || null))}>
          <option value="">Top level of {project.name}</option>
          {parentOptions.map((other) => (
            <option key={other.id} value={other.id}>
              {'— '.repeat(other.depth)}Inside {other.title}
            </option>
          ))}
        </select>
        <button type="button" className="mini-button" aria-label={`Move ${region.title} earlier`} onClick={() => void run(() => moveRegion(region.id, -1))}>
          ↑
        </button>
        <button type="button" className="mini-button" aria-label={`Move ${region.title} later`} onClick={() => void run(() => moveRegion(region.id, 1))}>
          ↓
        </button>
      </div>

      <div className="section-label">History of this concept</div>
      {revisions.length ? (
        revisions.map((r, i) => (
          <div key={i} className="history-row">
            {revisionText(r, titleOf)}
            <small>{formatMoment(r.at)}</small>
          </div>
        ))
      ) : (
        <p className="hint">Created before edit history was kept. Statements keep their own history — open one to see it.</p>
      )}

      <div className="section-label">Delete</div>
      {confirmDelete ? (
        <div className="edit-row">
          <button
            type="button"
            className="mini-button danger"
            onClick={() =>
              void run(async () => {
                await deleteRegion(region.id);
                navigate(toHref(withLocation(params, { project: projectId, region: region.parentRegionId ?? undefined })));
              })
            }
          >
            Delete “{region.title}”
          </button>
          <button type="button" className="mini-button" onClick={() => setConfirmDelete(false)}>
            Keep it
          </button>
          <small>Sub-concepts move up a level. Statements are not deleted; unplaced ones go to Uncategorized.</small>
        </div>
      ) : (
        <button type="button" className="mini-button danger" onClick={() => setConfirmDelete(true)}>
          Delete concept…
        </button>
      )}
      {error && <p className="status-note" role="alert">{error}</p>}
    </>
  );
}

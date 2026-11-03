// Right-hand inspector of the Understanding Landscape (reference atlas.js
// findingPanel / sourcePanel / edgePanel, recent.js resume panel), plus the
// complete-list and organize panels the prototype lacked. The map stays
// visible beside it. Review and rewording happen only through explicit
// buttons (editable landscape, ConceptPanel.tsx); viewing changes nothing.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { db } from '../../lib/db/schema';
import {
  createRegion,
  deleteRegion,
  moveRegion,
  renameRegion,
  setMembership,
  setPinned,
  setRegionParent,
  setRegionSummary,
} from '../../lib/db/landscape';
import { wouldCreateCycle } from '../../lib/landscape/organize';
import {
  UNCATEGORIZED_ID,
  type Landscape,
  type LandscapeEvidence,
  type LandscapeFinding,
  type LandscapeProjectNode,
  type LandscapeRegionNode,
} from '../../lib/landscape/projection';
import type { ProjectResume, LandscapeVisit } from '../../lib/landscape/resume';
import { formatDay, formatMoment, visitVerb } from '../../lib/landscape/lens';
import { toHref, withLocation, type LandscapeParams, type ResolvedView } from '../../lib/landscape/route';
import type { StoredConversation, StoredMessage } from '../../types';
import type { UnderstandingEvent } from '../../types/understanding';
import { edgeLabel, reviewLabel } from './sceneModel';
import { ProposedEventControls, StatementControls } from './ConceptPanel';

const PAGE = 25;

function Heading({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, [children]);
  return (
    <h2 ref={ref} tabIndex={-1}>
      {children}
    </h2>
  );
}

function CloseLink({ to, label }: { to: string; label: string }) {
  return (
    <Link className="close" to={to} aria-label={label}>
      ×
    </Link>
  );
}

const pillClass = (f: LandscapeFinding) =>
  f.object.status !== 'current' ? 'historical' : f.object.reviewState === 'pending' ? '' : 'reviewed';

function ReviewPills({ finding, sample }: { finding: LandscapeFinding; sample: boolean }) {
  const review =
    finding.object.reviewState === 'pending'
      ? 'Pending review'
      : finding.object.reviewState === 'edited'
        ? 'Accepted (edited)'
        : 'Accepted';
  return (
    <div>
      <span className={`pill ${finding.object.reviewState === 'pending' ? '' : 'reviewed'}`}>{review}</span>
      <span className={`pill ${pillClass(finding)}`}>
        {finding.object.status === 'current' ? 'Current' : finding.object.status === 'superseded' ? 'Superseded' : 'Resolved'}
      </span>
      {finding.object.type === 'question' && finding.object.status === 'current' && <span className="pill open">Open question</span>}
      {sample && <span className="pill sample">Built-in sample</span>}
    </div>
  );
}

const OP_LABEL: Record<UnderstandingEvent['op'], string> = {
  introduced: 'Introduced',
  supported: 'Supported',
  refined: 'Refined',
  superseded: 'Superseded',
  contradicted: 'Contradicted',
  reopened: 'Reopened',
  resolved: 'Resolved',
};

function EventRow({ event, landscape, onChanged }: { event: UnderstandingEvent; landscape: Landscape; onChanged?: () => void }) {
  const replacement = event.supersededByObjectId ? landscape.findings.get(event.supersededByObjectId) : undefined;
  const review = event.reviewState === 'pending' ? 'proposed, awaiting review' : event.reviewState === 'edited' ? 'accepted (edited)' : 'accepted';
  return (
    <div className={`history-row ${event.op === 'contradicted' ? 'contradicted' : ''}`}>
      <strong>{OP_LABEL[event.op]}</strong>
      {event.detail ? ` — ${event.detail}` : ''}
      {replacement ? ` → “${replacement.object.title}”` : ''}
      {event.revision && (
        <span className="revision">
          {' '}
          “{event.revision.previousTitle}” → “{event.revision.title}”
          {event.revision.body !== event.revision.previousBody ? ' (details changed)' : ''}
        </span>
      )}
      {event.originalRevision && (
        <details>
          <summary>Original proposal before your edits</summary>
          <p>“{event.originalRevision.previousTitle}” → “{event.originalRevision.title}”</p>
          {event.originalRevision.previousBody && <p>Previous details: {event.originalRevision.previousBody}</p>}
          {event.originalRevision.body && <p>Proposed details: {event.originalRevision.body}</p>}
        </details>
      )}
      <small>
        {event.origin === 'ai' ? 'AI' : 'You'} · {review} · in source {formatDay(event.occurredAt)} · recorded {formatDay(event.createdAt)}
        {event.evidence.length ? ` · ${event.evidence.length} citation${event.evidence.length === 1 ? '' : 's'}` : ''}
      </small>
      {onChanged && event.reviewState === 'pending' && <ProposedEventControls event={event} onChanged={onChanged} />}
    </div>
  );
}

function supportText(e: LandscapeEvidence): string {
  if (e.conversationName === null) return 'Not available on this device';
  return e.support === 'reviewed' ? 'Reviewed support · you accepted this record' : 'Proposed support · not yet reviewed';
}

// --- finding -------------------------------------------------------------------

export function FindingPanel({
  finding,
  view,
  landscape,
  resume,
  onChanged,
  editable = true,
}: {
  finding: LandscapeFinding;
  view: ResolvedView;
  landscape: Landscape;
  resume?: ProjectResume;
  onChanged: () => void;
  /** False in the read-only synthetic lab. */
  editable?: boolean;
}) {
  const project = view.project!;
  const params = view.params;
  const o = finding.object;
  const projectId = project.project?.id;
  const eligibleForChange = o.status === 'current' && (o.reviewState === 'accepted' || o.reviewState === 'edited');
  const workspaces = (resume?.workspaces ?? []).filter((w) => w.understandingPointIds.includes(o.id));
  const sourceAt = finding.sourceAt;
  return (
    <>
      <CloseLink to={toHref({ ...params, finding: undefined, source: undefined })} label="Close finding" />
      <ReviewPills finding={finding} sample={project.sample} />
      <Heading>{o.title}</Heading>
      <div className="meta">
        <span style={{ textTransform: 'capitalize' }}>{o.type}</span>
        <span>{sourceAt ? `Latest in source ${formatDay(sourceAt)}` : 'No dated source event'}</span>
        <span>Recorded in Chatdex {formatDay(finding.recordedAt)}</span>
        <span>{o.origin === 'ai' ? 'AI-synthesized' : 'Written by you'}</span>
      </div>
      {o.body ? <p>{o.body}</p> : <p className="status-note">No longer description was recorded for this finding.</p>}
      {o.reviewState === 'pending' && (
        <p className="status-note">AI-proposed and not yet accepted. Viewing it changes nothing; accept, edit, or reject it here or in Current Understanding.</p>
      )}
      {projectId && editable && !project.sample && <StatementControls finding={finding} onChanged={onChanged} />}
      {finding.pendingEventCount > 0 && (
        <p className="status-note">
          {finding.pendingEventCount} proposed change{finding.pendingEventCount === 1 ? '' : 's'} to this finding await review.
        </p>
      )}

      <div className="section-label">
        Evidence · {finding.evidence.length} linked conversation{finding.evidence.length === 1 ? '' : 's'}
      </div>
      {finding.evidence.length ? (
        finding.evidence.map((e) => (
          <Link key={e.conversationId} className="source-item" to={toHref({ ...params, source: e.conversationId })}>
            {e.conversationName ?? 'Conversation not on this device'} <span className="arrow">→</span>
            <small>
              {supportText(e)} · {e.messageIds.length ? `${e.messageIds.length} anchored message${e.messageIds.length === 1 ? '' : 's'}` : 'whole conversation'}
            </small>
          </Link>
        ))
      ) : (
        <div className="source-empty">No conversation evidence is attached to this record{o.origin === 'user' ? ' — you wrote it directly' : ''}.</div>
      )}
      <p className="note">Evidence shows where this was discussed. It is not proof the statement is true or that code does this.</p>

      <div className="section-label">How understanding changed</div>
      {finding.events.length ? (
        finding.events.map((event) => <EventRow key={event.id} event={event} landscape={landscape} onChanged={projectId && editable ? onChanged : undefined} />)
      ) : (
        <p>No events recorded. No replacement or conflict is asserted.</p>
      )}
      {finding.contradictionCount > 0 && (
        <p className="note">Contradiction events are shown as recorded with their evidence. Chatdex does not mark a disagreement resolved on its own.</p>
      )}

      {projectId && <MembershipEditor finding={finding} project={project} onChanged={onChanged} />}

      {workspaces.length > 0 && (
        <>
          <div className="section-label">Active change workspaces using this finding</div>
          {workspaces.map((w) => (
            <Link key={w.id} className="source-item" to={`/projects/${projectId}/prepare?change=${encodeURIComponent(w.id)}`}>
              {w.title || 'Untitled change'} <span className="arrow">→</span>
              <small>{w.state} · workspace edited {formatDay(w.updatedAt)}</small>
            </Link>
          ))}
        </>
      )}

      <div className="section-label">Continue</div>
      {projectId ? (
        <>
          <Link className="external" to={`/projects/${projectId}/understanding`}>
            Open Current Understanding →
          </Link>
          {eligibleForChange ? (
            <Link className="external" to={`/projects/${projectId}/prepare?understanding=${encodeURIComponent(o.id)}`}>
              Prepare a change from this →
            </Link>
          ) : (
            <p className="note">
              Prepare Change uses accepted, current findings only. This one is {reviewLabel(finding)}
              {o.reviewState === 'pending' ? ' — accept it in Current Understanding first' : ''}.
            </p>
          )}
        </>
      ) : (
        <Link className="external" to="/projects/unassigned">
          Open unassigned understanding →
        </Link>
      )}
    </>
  );
}

function MembershipEditor({ finding, project, onChanged }: { finding: LandscapeFinding; project: LandscapeProjectNode; onChanged: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const all = flatten(project.regions).filter((n) => n.region);
  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <>
      <div className="section-label">Which concepts it is about · organization only</div>
      {all.length === 0 ? (
        <p className="note">This project has no concepts yet. Add one on the project landscape; records stay in Uncategorized until placed.</p>
      ) : (
        all.map((node) => {
          const member = node.directIds.includes(finding.object.id);
          const pinned = node.region!.pinnedObjectIds.includes(finding.object.id);
          return (
            <div key={node.id} className="edit-block edit-row">
              <label style={{ flex: 1, paddingLeft: node.depth * 14 }}>
                <input type="checkbox" checked={member} onChange={(e) => void run(() => setMembership(node.id, finding.object.id, e.target.checked))} />
                {node.title}
              </label>
              <button
                type="button"
                className="mini-button"
                aria-pressed={pinned}
                onClick={() => void run(() => setPinned(node.id, finding.object.id, !pinned))}
                title="Show this statement on the concept's terrain"
              >
                {pinned ? 'Pinned' : 'Pin as summary'}
              </button>
            </div>
          );
        })
      )}
      {error && <p className="status-note" role="alert">{error}</p>}
      <p className="note">Placing or pinning a record never changes its statement, review state, or evidence. One record can sit in several concepts without being copied.</p>
    </>
  );
}

// --- source --------------------------------------------------------------------

export function SourcePanel({ finding, source, view }: { finding: LandscapeFinding; source: LandscapeEvidence; view: ResolvedView }) {
  const params = view.params;
  const [state, setState] = useState<{ conversation?: StoredConversation; messages: StoredMessage[]; loaded: boolean }>({ messages: [], loaded: false });
  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      db.conversations.get(source.conversationId),
      source.messageIds.length ? db.messages.bulkGet(source.messageIds) : Promise.resolve<(StoredMessage | undefined)[]>([]),
    ]).then(([conversation, messages]) => {
      if (cancelled) return;
      setState({
        conversation,
        messages: messages.filter((m): m is StoredMessage => Boolean(m)),
        loaded: true,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [source.conversationId, source.messageIds]);

  const first = state.messages[0];
  const target = first ? `/conversations/${source.conversationId}?scrollTo=${first.id}` : `/conversations/${source.conversationId}`;
  const speaker = (m: StoredMessage) => (m.sender === 'assistant' ? 'Assistant' : m.sender === 'user' ? 'You' : m.sender === 'tool' ? 'Tool output' : 'System');
  const excerpt = (text: string) => (text.length > 700 ? `${text.slice(0, 700).trimEnd()}…` : text);
  return (
    <>
      <Link className="small-back" to={toHref({ ...params, source: undefined })}>
        ← Back to finding
      </Link>
      <div className="section-label">Source inspection{view.project?.sample ? ' · built-in sample' : ''}</div>
      <Heading>{state.conversation?.name ?? source.conversationName ?? 'Conversation not on this device'}</Heading>
      <div className="meta">
        {state.conversation && <span>{state.conversation.source}</span>}
        {state.conversation && <span>Conversation dated {formatDay(state.conversation.createdAt)}</span>}
        <span>{supportText(source)}</span>
      </div>
      <p>
        Cited for: <em>{finding.object.title}</em>
      </p>
      {!state.loaded ? (
        <p>Loading source…</p>
      ) : !state.conversation ? (
        <div className="source-empty">
          This conversation is not stored on this device. It may live on another device that has not synced, or it was deleted after analysis. Missing here is not the same as no evidence, and it is not verified support.
        </div>
      ) : state.messages.length ? (
        state.messages.slice(0, 3).map((m) => (
          <div key={m.id}>
            <div className="meta">
              <span>{speaker(m)}</span>
              <span>{formatMoment(m.createdAt)}</span>
            </div>
            <blockquote>{excerpt(m.text)}</blockquote>
          </div>
        ))
      ) : (
        <div className="source-empty">
          {source.messageIds.length
            ? 'The cited messages are not stored on this device. Open the conversation to inspect it.'
            : 'This citation points at the whole conversation, not an exact message. Open it to inspect the evidence.'}
        </div>
      )}
      {state.messages.some((m) => m.sender === 'assistant') && (
        <p className="note">This excerpt includes an assistant explanation captured from the conversation. It is not independent verification of current code behavior.</p>
      )}
      {source.note && (
        <>
          <div className="section-label">Why it was cited</div>
          <p className="note">{source.note}</p>
        </>
      )}
      {state.conversation && (
        <Link className="external" to={target}>
          Open original conversation →
        </Link>
      )}
      {state.messages.length > 3 && <p className="note">{state.messages.length - 3} more cited messages are in the conversation.</p>}
    </>
  );
}

// --- connection ----------------------------------------------------------------

export function ConnectionPanel({ landscape, view }: { landscape: Landscape; view: ResolvedView }) {
  const edge = view.edge!;
  const params = view.params;
  const a = landscape.projects.find((p) => p.key === edge.a)!;
  const b = landscape.projects.find((p) => p.key === edge.b)!;
  return (
    <>
      <CloseLink to={toHref(withLocation(params, {}))} label="Close connection" />
      <span className="pill reviewed">Shared source</span>
      {edge.weak && <span className="pill">Pending association</span>}
      <Heading>
        {a.name} and {b.name}
      </Heading>
      <p>
        {edge.conversationIds.length === 1 ? 'One conversation is' : `${edge.conversationIds.length} conversations are`} associated with both projects.
      </p>
      <p className="note">
        This line means the projects share sources. It is not a dependency, and Chatdex has not inferred any other relationship.
        {edge.weak ? ' At least one of these associations is AI-proposed and still pending review.' : ''}
      </p>
      <div className="section-label">Sources behind the connection</div>
      {edge.conversationIds.map((id, i) =>
        edge.conversationNames[i] ? (
          <Link key={id} className="source-item" to={`/conversations/${id}`}>
            {edge.conversationNames[i]} <span className="arrow">→</span>
            <small>Open original conversation</small>
          </Link>
        ) : (
          <div key={id} className="source-item">
            Conversation not on this device
            <small>It may be on another device or deleted</small>
          </div>
        )
      )}
      <div className="section-label">Explore either landscape</div>
      {[a, b].map((p) => (
        <Link key={p.key} className="source-item" to={toHref(withLocation(params, { project: p.key }))}>
          {p.name} →
        </Link>
      ))}
    </>
  );
}

// --- where you left off ----------------------------------------------------------

function visitHref(visit: LandscapeVisit, params: LandscapeParams, landscape: Landscape): string {
  const region = visit.regionId && (visit.regionId === UNCATEGORIZED_ID || landscape.regions.has(visit.regionId)) ? visit.regionId : undefined;
  return toHref(
    withLocation(
      { ...params, lens: 'whole' },
      { project: visit.projectId, region, finding: visit.objectId, source: visit.kind === 'source' ? visit.conversationId : undefined }
    )
  );
}

function visitTitle(visit: LandscapeVisit, landscape: Landscape): string {
  if (visit.objectId) return landscape.findings.get(visit.objectId)?.object.title ?? 'A finding';
  if (visit.regionId === UNCATEGORIZED_ID) return 'Uncategorized';
  return (visit.regionId && landscape.regions.get(visit.regionId)?.title) || 'A region';
}

export function ResumePanel({ landscape, view, resume }: { landscape: Landscape; view: ResolvedView; resume?: ProjectResume }) {
  const project = view.resume!;
  const params = view.params;
  const last = resume?.last;
  return (
    <>
      <CloseLink to={toHref(withLocation(params, {}))} label="Close work thread" />
      <span className="pill reviewed">{last ? visitVerb(last) : 'No visits recorded'}</span>
      <Heading>{last ? visitTitle(last, landscape) : project.name}</Heading>
      <div className="meta">
        <span>{project.name}</span>
        {last && <span>You were here {formatMoment(last.at)}</span>}
      </div>
      {last ? (
        <>
          <p>
            {visitVerb(last)} in <strong>{project.name}</strong>
            {last.objectId && last.regionId ? ` · ${visitTitle({ ...last, objectId: undefined, kind: 'region' }, landscape)}` : ''}.
          </p>
          <Link className="external primary" to={visitHref(last, params, landscape)}>
            Resume where you left off →
          </Link>
        </>
      ) : (
        <p>Chatdex has no record of you opening anything in this project’s landscape on this device yet.</p>
      )}

      {resume && resume.recent.length > 1 && (
        <>
          <div className="section-label">Recently opened here</div>
          {resume.recent.slice(1).map((v, i) => (
            <Link key={i} className="source-item" to={visitHref(v, params, landscape)}>
              {visitTitle(v, landscape)} <span className="arrow">→</span>
              <small>
                {visitVerb(v)} · {formatMoment(v.at)}
              </small>
            </Link>
          ))}
        </>
      )}

      {resume && resume.workspaces.length > 0 && (
        <>
          <div className="section-label">Active change workspaces</div>
          {resume.workspaces.map((w) => (
            <Link key={w.id} className="source-item" to={`/projects/${project.key}/prepare?change=${encodeURIComponent(w.id)}`}>
              {w.title || 'Untitled change'} <span className="arrow">→</span>
              <small>
                {w.state} · workspace edited {formatMoment(w.updatedAt)}
              </small>
            </Link>
          ))}
        </>
      )}

      <div className="section-label">What this is based on</div>
      <p className="note">
        Visits are what you opened in this landscape, recorded on this device only and never synced.
        {resume?.workspaces.length ? ' Workspace dates are your last edit of that workspace.' : ''}
        {project.latestSourceAt ? ` The latest dated source activity in this project is ${formatDay(project.latestSourceAt)} (conversation time, not your activity).` : ''}
        {' '}Re-importing a growing conversation may not refresh its stored messages, so source dates can lag your external work.
      </p>
      <Link className="external" to={toHref(withLocation({ ...params, lens: 'whole' }, { project: project.key }))}>
        Enter the understanding landscape →
      </Link>
    </>
  );
}

// --- complete list ---------------------------------------------------------------

function flatten(nodes: LandscapeRegionNode[]): LandscapeRegionNode[] {
  return nodes.flatMap((n) => [n, ...flatten(n.children)]);
}

function Paged<T>({ items, render, label }: { items: T[]; render: (item: T) => ReactNode; label: string }) {
  const [limit, setLimit] = useState(PAGE);
  return (
    <>
      {items.slice(0, limit).map(render)}
      {items.length > limit && (
        <button type="button" className="external" onClick={() => setLimit((l) => l + PAGE)}>
          Show {Math.min(PAGE, items.length - limit)} more {label} ({items.length - limit} remaining)
        </button>
      )}
    </>
  );
}

export function ListPanel({ landscape, view, matches, filtering }: { landscape: Landscape; view: ResolvedView; matches: (f: LandscapeFinding) => boolean; filtering: boolean }) {
  const params = view.params;
  const close = toHref({ ...params, panel: undefined });
  if (!view.project) {
    return (
      <>
        <CloseLink to={close} label="Close list" />
        <div className="section-label">Everything on this landscape</div>
        <Heading>All projects</Heading>
        <Paged
          label="projects"
          items={landscape.projects}
          render={(p) => (
            <Link key={p.key} className="list-row" to={toHref(withLocation(params, { project: p.key }))}>
              {p.name}
              <small>
                {p.counts.current} findings · {p.regionCount} regions · {p.sourceCount} sources
              </small>
            </Link>
          )}
        />
        <div className="section-label">Shared-source connections · {landscape.connections.length}</div>
        <Paged
          label="connections"
          items={landscape.connections}
          render={(c) => (
            <Link key={c.id} className="list-row" to={toHref(withLocation(params, { edge: c.id }))}>
              {landscape.projects.find((p) => p.key === c.a)?.name} ↔ {landscape.projects.find((p) => p.key === c.b)?.name}
              <small>{edgeLabel(c)}</small>
            </Link>
          )}
        />
      </>
    );
  }
  const project = view.project;
  const region = view.region;
  const ids = region ? region.allIds : project.findingIds;
  const visible = ids.map((id) => landscape.findings.get(id)!).filter((f) => !filtering || matches(f));
  const subregions = region ? flatten(region.children) : flatten(project.regions);
  const eligible = visible.filter((f) => f.object.status === 'current' && (f.object.reviewState === 'accepted' || f.object.reviewState === 'edited'));
  return (
    <>
      <CloseLink to={close} label="Close list" />
      <div className="section-label">Complete list{filtering ? ' · matching filters' : ''}</div>
      <Heading>{region ? region.title : project.name}</Heading>
      <p>
        {visible.length} of {ids.length} finding{ids.length === 1 ? '' : 's'}
        {subregions.length ? ` · ${subregions.length} region${subregions.length === 1 ? '' : 's'}` : ''}. Every record is listed here even when the map shows a subset.
      </p>
      {subregions.length > 0 && (
        <>
          <div className="section-label">Regions</div>
          {subregions.map((n) => (
            <Link key={n.id} className="list-row" to={toHref(withLocation(params, { project: project.key, region: n.id }))} style={{ paddingLeft: (n.depth - (region?.depth ?? -1) - 1) * 14 }}>
              {n.title}
              <small>{n.counts.current} findings</small>
            </Link>
          ))}
        </>
      )}
      <div className="section-label">Findings</div>
      <Paged
        label="findings"
        items={visible}
        render={(f) => {
          // resolveView reveals it in the region inside this one that holds it directly.
          return (
            <Link key={f.object.id} className="list-row" to={toHref(withLocation(params, { project: project.key, region: region?.id, finding: f.object.id }))}>
              {f.object.title}
              <small>
                {f.object.type} · {reviewLabel(f)} · {f.evidence.length} source{f.evidence.length === 1 ? '' : 's'}
              </small>
            </Link>
          );
        }}
      />
      {project.project && eligible.length > 0 && (
        <>
          <div className="section-label">Prepare a change</div>
          <Link className="external" to={`/projects/${project.key}/prepare?understanding=${eligible.map((f) => encodeURIComponent(f.object.id)).join(',')}`}>
            Preselect {eligible.length} accepted, current finding{eligible.length === 1 ? '' : 's'} →
          </Link>
          <p className="note">Opens Prepare Change with these selected. Nothing is created until you choose to create it there.</p>
        </>
      )}
    </>
  );
}

// --- organize --------------------------------------------------------------------

export function OrganizePanel({ view, onChanged }: { view: ResolvedView; onChanged: () => void }) {
  const project = view.project!;
  const params = view.params;
  const [title, setTitle] = useState('');
  const [parent, setParent] = useState<string>(view.region?.region ? view.region.id : '');
  const [error, setError] = useState<string | null>(null);
  const regions = flatten(project.regions).filter((n) => n.region);
  const rows = regions.map((n) => n.region!);
  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <>
      <CloseLink to={toHref({ ...params, panel: undefined })} label="Close organize" />
      <div className="section-label">Organize · {project.name}</div>
      <Heading>Regions</Heading>
      <p>Regions are places you define to group this project’s findings. They hold references only: renaming, reordering, or deleting a region never changes or deletes a finding.</p>
      <form
        className="edit-block"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            await createRegion({ projectId: project.key, title, parentRegionId: parent || null });
            setTitle('');
          });
        }}
      >
        <div className="edit-row">
          <input type="text" aria-label="New region name" placeholder="New region name" value={title} onChange={(e) => setTitle(e.target.value)} />
          <button type="submit" className="mini-button" disabled={!title.trim()}>
            Create
          </button>
        </div>
        <div className="edit-row" style={{ marginTop: 6 }}>
          <select aria-label="Parent of new region" value={parent} onChange={(e) => setParent(e.target.value)}>
            <option value="">Top level</option>
            {regions.map((n) => (
              <option key={n.id} value={n.id}>
                {'— '.repeat(n.depth)}
                {n.title}
              </option>
            ))}
          </select>
        </div>
      </form>
      {regions.length === 0 && <p className="note">No regions yet. Every finding is in Uncategorized.</p>}
      {regions.map((n) => (
        <RegionEditor key={`${n.id}:${n.region!.updatedAt.getTime()}`} node={n} rows={rows} regions={regions} run={run} />
      ))}
      {error && <p className="status-note" role="alert">{error}</p>}
      <p className="note">Place findings from each finding’s detail panel. Regions sync encrypted like your other records; if two devices edit the same region, the later edit wins.</p>
    </>
  );
}

function RegionEditor({
  node,
  rows,
  regions,
  run,
}: {
  node: LandscapeRegionNode;
  rows: NonNullable<LandscapeRegionNode['region']>[];
  regions: LandscapeRegionNode[];
  run: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const region = node.region!;
  // Keyed on updatedAt by the caller, so a saved edit remounts with fresh values.
  const [name, setName] = useState(region.title);
  const [summary, setSummary] = useState(region.summary ?? '');
  return (
    <div className="edit-block" style={{ paddingLeft: node.depth * 14 }}>
      <div className="edit-row">
        <input type="text" aria-label={`Name of ${region.title}`} value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== region.title && void run(() => renameRegion(region.id, name))} />
        <button type="button" className="mini-button" aria-label={`Move ${region.title} up`} onClick={() => void run(() => moveRegion(region.id, -1))}>
          ↑
        </button>
        <button type="button" className="mini-button" aria-label={`Move ${region.title} down`} onClick={() => void run(() => moveRegion(region.id, 1))}>
          ↓
        </button>
        <button
          type="button"
          className="mini-button danger"
          aria-label={`Delete region ${region.title}`}
          onClick={() => void run(() => deleteRegion(region.id))}
        >
          Delete
        </button>
      </div>
      <div className="edit-row" style={{ marginTop: 6 }}>
        <input type="text" aria-label={`Description of ${region.title}`} placeholder="Optional one-line description" value={summary} onChange={(e) => setSummary(e.target.value)} onBlur={() => summary !== (region.summary ?? '') && void run(() => setRegionSummary(region.id, summary))} />
      </div>
      <div className="edit-row" style={{ marginTop: 6 }}>
        <select aria-label={`Parent of ${region.title}`} value={region.parentRegionId ?? ''} onChange={(e) => void run(() => setRegionParent(region.id, e.target.value || null))}>
          <option value="">Top level</option>
          {regions
            .filter((other) => other.id !== region.id && !wouldCreateCycle(rows, region.id, other.id))
            .map((other) => (
              <option key={other.id} value={other.id}>
                Inside {other.title}
              </option>
            ))}
        </select>
      </div>
      <small style={{ color: '#8b9886', fontSize: 10 }}>
        {node.directIds.length} placed here · {node.allIds.length} including subregions
      </small>
    </div>
  );
}

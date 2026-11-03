// Understanding Landscape (docs/changes/understanding-landscape): a
// click-through map of projects → concepts → findings → evidence, with the
// reference atlas's visual language. All navigation state is in the URL.
// Viewing never writes understanding records or calls a provider; the only
// writes are explicit edits (docs/changes/editable-landscape: adding and
// developing concepts and statements, reviewing proposals) and the
// local-only visit log.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import '../components/landscape/landscape.css';
import { loadLandscape, type LoadedLandscape } from '../lib/landscape/load';
import { recentLens, wholeLens } from '../lib/landscape/lens';
import { recordLandscapeVisit } from '../lib/landscape/resume';
import { isFiltering, LANDSCAPE_FILTERS, makeMatcher, searchLandscape } from '../lib/landscape/search';
import {
  depthOf,
  parentParams,
  parseParams,
  resolveView,
  toHref,
  withLocation,
  type LandscapeParams,
  type ResolvedView,
} from '../lib/landscape/route';
import { UNCATEGORIZED_ID, type Landscape } from '../lib/landscape/projection';
import {
  AllProjectsScene,
  MiniOverview,
  ProjectScene,
  RegionScene,
} from '../components/landscape/LandscapeScene';
import {
  ConnectionPanel,
  FindingPanel,
  ListPanel,
  OrganizePanel,
  ResumePanel,
  SourcePanel,
} from '../components/landscape/LandscapeInspector';
import { AddConceptControl, ConceptPanel } from '../components/landscape/ConceptPanel';

const LEVELS = ['Projects', 'Project landscape', 'Concept', 'Finding detail', 'Source'];
const RESULTS_PAGE = 12;

/**
 * Pixel size of the map pane. A callback ref, because the pane remounts on
 * every scene change and an effect-bound observer would keep watching the
 * old, detached element.
 */
function usePaneSize() {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 1100, height: 600 });
  useLayoutEffect(() => {
    if (!el) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setSize((prev) =>
          prev.width === Math.round(rect.width) && prev.height === Math.round(rect.height)
            ? prev
            : { width: Math.round(rect.width), height: Math.round(rect.height) }
        );
      }
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [el]);
  return [setEl, size] as const;
}

export interface LandscapePageProps {
  /** Alternate in-memory source (the dev-only synthetic lab). */
  source?: () => Promise<LoadedLandscape>;
  /** Disables organization edits and visit recording (synthetic lab). */
  readOnly?: boolean;
  /** Base path for links; the lab passes its own route. */
  label?: string;
}

export function LandscapePage({ source, readOnly = false, label }: LandscapePageProps = {}) {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [loaded, setLoaded] = useState<LoadedLandscape | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let cancelled = false;
    (source ?? loadLandscape)()
      .then((result) => {
        if (!cancelled) setLoaded(result);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [source, version]);

  const params = useMemo(() => parseParams(searchParams), [searchParams]);

  if (error) {
    return (
      <div className="ldx">
        <div className="workspace">
          <h1>Landscape unavailable</h1>
          <p className="subhead">{error}</p>
        </div>
      </div>
    );
  }
  if (!loaded) {
    return (
      <div className="ldx">
        <div className="workspace">
          <div className="eyebrow">Your connected work</div>
          <h1>A landscape of your projects</h1>
          <p className="subhead">Loading your understanding…</p>
        </div>
      </div>
    );
  }
  return (
    <LandscapeView
      loaded={loaded}
      params={params}
      navigate={navigate}
      onChanged={reload}
      readOnly={readOnly}
      label={label}
    />
  );
}

function LandscapeView({
  loaded,
  params,
  navigate,
  onChanged,
  readOnly,
  label,
}: {
  loaded: LoadedLandscape;
  params: LandscapeParams;
  navigate: ReturnType<typeof useNavigate>;
  onChanged: () => void;
  readOnly: boolean;
  label?: string;
}) {
  const { landscape, resume } = loaded;
  const view = useMemo(() => resolveView(landscape, params), [landscape, params]);
  const lens = useMemo(() => (params.lens === 'recent' ? recentLens(resume) : wholeLens), [params.lens, resume]);
  const matches = useMemo(() => makeMatcher(landscape, params.q, params.filter), [landscape, params.q, params.filter]);
  const filtering = isFiltering(params.q, params.filter);
  const [paneRef, size] = usePaneSize();
  const [aboutOpen, setAboutOpen] = useState(false);
  const [draft, setDraft] = useState(params.q);
  const [resultLimit, setResultLimit] = useState(RESULTS_PAGE);
  const [renderMs, setRenderMs] = useState<number | null>(null);

  useEffect(() => setDraft(params.q), [params.q]);
  useEffect(() => setResultLimit(RESULTS_PAGE), [params.q, params.filter]);

  // Stale, deleted, or foreign ids: replace the URL with the canonical view.
  useEffect(() => {
    if (view.corrected) navigate(toHref(view.params), { replace: true });
  }, [view, navigate]);

  // Local-only visit log for "Where you left off" — one row per arrival.
  const visitKey = [view.project?.key, view.region?.id, view.finding?.object.id, view.source?.conversationId].join('|');
  useEffect(() => {
    if (readOnly || view.corrected || !view.project?.project || !view.region) return;
    const base = { projectId: view.project.key, regionId: view.region.id };
    const visit = view.source
      ? { ...base, kind: 'source' as const, objectId: view.finding!.object.id, conversationId: view.source.conversationId }
      : view.finding
        ? { ...base, kind: 'finding' as const, objectId: view.finding.object.id }
        : { ...base, kind: 'region' as const };
    void recordLandscapeVisit(visit).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps -- visitKey captures the view identity
  }, [visitKey, readOnly]);

  // Escape steps out one level (not while typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      if (e.key !== 'Escape' || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (depthOf(view) === 0 && !view.edge && !view.resume && !view.panel) return;
      navigate(toHref(parentParams(view)));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view, navigate]);

  // Closing a finding returns focus to its marker on the map.
  const lastFinding = useRef<string | null>(null);
  useEffect(() => {
    const current = view.finding?.object.id ?? null;
    if (!current && lastFinding.current) {
      const el = document.querySelector<SVGAElement>(`[data-finding="${CSS.escape(lastFinding.current)}"]`);
      el?.focus({ preventScroll: true });
    }
    lastFinding.current = current;
  }, [view.finding]);

  // Render-budget instrumentation (ACCEPTANCE: keep rendering bounded).
  const renderStart = useRef(0);
  renderStart.current = performance.now();
  useEffect(() => {
    setRenderMs(performance.now() - renderStart.current);
  }, [visitKey, size.width, size.height, params.q, params.filter, params.lens]);

  const results = useMemo(
    () => (filtering ? searchLandscape(landscape, params.q, params.filter) : []),
    [filtering, landscape, params.q, params.filter]
  );
  const projectHits = useMemo(() => {
    const q = params.q.trim().toLowerCase();
    if (!q || params.filter !== 'all') return [];
    return landscape.projects.filter((p) => `${p.name} ${p.description ?? ''}`.toLowerCase().includes(q));
  }, [landscape, params.q, params.filter]);

  const go = (next: LandscapeParams, replace = false) => navigate(toHref(next), { replace });
  const onSearch = (e: FormEvent) => {
    e.preventDefault();
    go({ ...params, q: draft.trim() });
  };

  const depth = depthOf(view);
  const project = view.project;
  const scope = project ?? null;
  const counts = scope ? scope.counts : landscape.totals;
  // The virtual "No project" place is not a project (matches the Projects page count).
  const realProjectCount = landscape.projects.filter((p) => p.project).length;
  const title = project ? project.name : params.lens === 'recent' ? 'Where you left things' : 'A landscape of your projects';
  const subhead = project
    ? [
        `${project.sourceCount} conversation source${project.sourceCount === 1 ? '' : 's'}`,
        `${project.counts.current} understanding object${project.counts.current === 1 ? '' : 's'}`,
        project.counts.historical ? `${project.counts.historical} superseded or resolved` : '',
        project.regionCount ? `${project.regionCount} concept${project.regionCount === 1 ? '' : 's'}` : 'no concepts yet',
        project.sample ? 'Synthetic sample supplied by Chatdex' : project.project?.reviewState === 'pending' ? 'Project awaiting review' : '',
      ]
        .filter(Boolean)
        .join(' · ')
    : params.lens === 'recent'
      ? 'The same projects, seen through what you last opened here. Read what was happening before you click in.'
      : 'See what each project is about, where it connects, and what sits underneath. Click a place to enter it.';

  const hasInspector = Boolean(view.finding || view.edge || view.resume || view.panel);
  const sceneWidth = size.width;
  const sceneHeight = size.height;
  const sceneProps = { landscape, view, lens, matches, filtering, width: sceneWidth, height: sceneHeight };
  const cornerText = view.region
    ? 'Every mark is a statement or sub-concept'
    : project
      ? 'Click a concept to enter it'
      : `${landscape.projects.length} place${landscape.projects.length === 1 ? '' : 's'} · ${landscape.connections.length} shared-source connection${landscape.connections.length === 1 ? '' : 's'}`;

  const announce = [project?.name ?? 'All projects', ...view.regionTrail.map((r) => r.title), view.finding?.object.title, view.source ? 'Source' : undefined]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="ldx" data-render-ms={renderMs?.toFixed(1)} data-projection-ms={loaded.projectionMs.toFixed(1)}>
      <main className="workspace">
        <div className="intro">
          <div>
            <div className="eyebrow">
              {label ?? (project ? 'Inside a project' : params.lens === 'recent' ? 'Pick up the thread' : 'Your connected work')}
            </div>
            <h1>{title}</h1>
            <p className="subhead">{subhead}</p>
          </div>
          <div className="countbar" aria-label="Counts">
            <div>
              <strong>{scope ? counts.current : realProjectCount}</strong>
              <span>{scope ? (counts.current === 1 ? 'finding' : 'findings') : realProjectCount === 1 ? 'project' : 'projects'}</span>
            </div>
            <div>
              <strong>{counts.toReview}</strong>
              <span>to review</span>
            </div>
            <div>
              <strong>{counts.open}</strong>
              <span>open questions</span>
            </div>
          </div>
        </div>

        <nav className="lensbar" aria-label="Lens">
          <Link to={toHref({ ...withLocation(params, { project: params.project, region: params.region }), lens: 'whole' })} aria-current={params.lens === 'whole' ? 'page' : undefined}>
            Whole landscape
          </Link>
          <Link to={toHref({ ...withLocation(params, { project: params.project, region: params.region }), lens: 'recent' })} aria-current={params.lens === 'recent' ? 'page' : undefined}>
            Where you left off
          </Link>
          {project?.project && !readOnly && (
            <Link to={toHref({ ...withLocation(params, { project: project.key, region: view.region?.id }), panel: 'organize' })} aria-current={view.panel === 'organize' ? 'page' : undefined}>
              Organize
            </Link>
          )}
          <Link to={toHref({ ...withLocation(params, { project: params.project, region: params.region }), panel: 'list' })} aria-current={view.panel === 'list' ? 'page' : undefined}>
            Complete list
          </Link>
          {project?.project && !readOnly && (
            <Link className="quiet-link" to={`/projects/${project.key}/understanding`}>
              Current Understanding & history map ↗
            </Link>
          )}
        </nav>

        <div className="navrow">
          {depth === 0 && !view.edge && !view.resume && !view.panel ? (
            <span className="back" aria-disabled="true">
              ← Back
            </span>
          ) : (
            <Link className="back" to={toHref(parentParams(view))}>
              ← Back
            </Link>
          )}
          <nav className="crumbs" aria-label="Breadcrumb">
            <Breadcrumbs view={view} />
          </nav>
          <span className="level">
            {LEVELS[depth].toUpperCase()} · {depth + 1} / 5
          </span>
        </div>

        <div className="controls">
          <form className="search" role="search" onSubmit={onSearch}>
            <input
              type="search"
              aria-label="Search all projects and findings"
              placeholder="Search across your understanding…"
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                if (!e.target.value && params.q) go({ ...params, q: '' }, true);
              }}
            />
            <button type="submit" aria-label="Search">
              ⌕
            </button>
          </form>
          <div className="filters" role="group" aria-label="Review filter">
            {LANDSCAPE_FILTERS.map((f) => (
              <button key={f.id} type="button" aria-pressed={params.filter === f.id} onClick={() => go({ ...params, filter: f.id })}>
                {f.label}
              </button>
            ))}
          </div>
          <div className="instruction">Click to enter · Back to step out · no scroll-to-zoom</div>
          <div className="legend" aria-hidden="true">
            <span>
              <i className="dot" />
              Pending
            </span>
            <span>
              <i className="dot reviewed" />
              Accepted
            </span>
            <span>
              <i className="dot open" />
              Open
            </span>
            <span>
              <i className="dot historical" />
              Historical
            </span>
          </div>
        </div>

        {filtering && (
          <section className="search-results" aria-label="Search results">
            <div className="summary">
              <strong role="status">
                {results.length} matching finding{results.length === 1 ? '' : 's'}
              </strong>
              {projectHits.map((p) => (
                <Link key={p.key} to={toHref(withLocation(params, { project: p.key }))}>
                  Project: {p.name} →
                </Link>
              ))}
              <button type="button" className="clear" onClick={() => go({ ...params, q: '', filter: 'all' })}>
                Clear
              </button>
            </div>
            <ol>
              {results.slice(0, resultLimit).map((r) => (
                <li key={r.finding.object.id}>
                  <Link to={toHref(withLocation(params, { project: r.finding.projectKey, region: r.regionPath[r.regionPath.length - 1]?.id ?? UNCATEGORIZED_ID, finding: r.finding.object.id }))}>
                    <span className="path">
                      {r.projectName}
                      {r.regionPath.map((n) => ` / ${n.title}`)}
                      {r.alsoInCount ? ` (+${r.alsoInCount})` : ''} ·{' '}
                    </span>
                    {r.finding.object.title}
                  </Link>
                </li>
              ))}
              {results.length > resultLimit && (
                <li>
                  <button type="button" className="linkish" onClick={() => setResultLimit((n) => n + RESULTS_PAGE * 2)}>
                    Show {Math.min(RESULTS_PAGE * 2, results.length - resultLimit)} more of {results.length - resultLimit} remaining
                  </button>
                </li>
              )}
            </ol>
          </section>
        )}

        <section className={`stage ${hasInspector ? 'has-inspector' : ''}`}>
          <div className="map-pane route-fade" key={`${view.project?.key ?? ''}/${view.region?.id ?? ''}`} ref={paneRef}>
            <div className="map-corner">{cornerText}</div>
            {landscape.projects.length === 0 ? (
              <EmptyLandscape />
            ) : view.region ? (
              <RegionScene {...sceneProps} />
            ) : project ? (
              <ProjectScene {...sceneProps} />
            ) : (
              <AllProjectsScene {...sceneProps} />
            )}
            <div className="map-footer">
              {project
                ? project.sample
                  ? 'Built-in synthetic sample'
                  : 'Live from your Chatdex records'
                : 'Lines show shared sources, not product dependencies.'}
            </div>
            {project && <MiniOverview landscape={landscape} current={project.key} params={params} />}
            {project?.project && !readOnly && !project.sample && (!view.region || view.region.region) && (
              <div className="map-toolbar">
                <AddConceptControl key={view.region?.id ?? 'top'} projectId={project.key} parent={view.region ?? null} onChanged={onChanged} />
                {view.region?.region && view.panel !== 'concept' && (
                  <Link className="add-button" to={toHref({ ...withLocation(params, { project: project.key, region: view.region.id }), panel: 'concept' })}>
                    Develop “{view.region.title}” →
                  </Link>
                )}
              </div>
            )}
          </div>
          {hasInspector && (
            <aside className="inspector" aria-label={view.source ? 'Source inspection' : view.finding ? 'Finding detail' : view.edge ? 'Connection detail' : view.resume ? 'Where you left off' : 'Details'}>
              <Inspector view={view} landscape={landscape} loaded={loaded} matches={matches} filtering={filtering} onChanged={onChanged} readOnly={readOnly} />
            </aside>
          )}
        </section>

        <footer className="foot">
          <span>
            Counts match the Projects page: current findings, counted once even when in two concepts. To review means a finding or a change to it is not yet accepted; superseded and resolved findings stay on the map but are not counted. Viewing and navigating never change a record or a review.
          </span>
          <button type="button" className="about" onClick={() => setAboutOpen((v) => !v)} aria-expanded={aboutOpen}>
            About this view
          </button>
          <Link to="/projects">Projects →</Link>
        </footer>
        {aboutOpen && <AboutNotice />}
        <div className="sr-only" aria-live="polite">
          {announce}
        </div>
      </main>
    </div>
  );
}

function Inspector({
  view,
  landscape,
  loaded,
  matches,
  filtering,
  onChanged,
  readOnly,
}: {
  view: ResolvedView;
  landscape: Landscape;
  loaded: LoadedLandscape;
  matches: ReturnType<typeof makeMatcher>;
  filtering: boolean;
  onChanged: () => void;
  readOnly: boolean;
}) {
  if (view.source && view.finding) return <SourcePanel finding={view.finding} source={view.source} view={view} />;
  if (view.finding) {
    return (
      <FindingPanel
        finding={view.finding}
        view={view}
        landscape={landscape}
        resume={view.project ? loaded.resume.get(view.project.key) : undefined}
        onChanged={readOnly ? () => {} : onChanged}
        editable={!readOnly}
      />
    );
  }
  if (view.edge) return <ConnectionPanel landscape={landscape} view={view} />;
  if (view.resume) return <ResumePanel landscape={landscape} view={view} resume={loaded.resume.get(view.resume.key)} />;
  if (view.panel === 'organize' && !readOnly) return <OrganizePanel view={view} onChanged={onChanged} />;
  if (view.panel === 'concept' && !readOnly && view.region?.region) return <ConceptPanel view={view} landscape={landscape} onChanged={onChanged} />;
  return <ListPanel landscape={landscape} view={view} matches={matches} filtering={filtering} />;
}

function Breadcrumbs({ view }: { view: ResolvedView }) {
  const p = view.params;
  const items: { label: string; href?: string }[] = [
    { label: p.lens === 'recent' && !view.project ? 'Recent work' : 'All projects', href: toHref(withLocation(p, {})) },
  ];
  if (view.edge) items.push({ label: 'Connection' });
  if (view.resume) items.push({ label: view.resume.name });
  if (view.project) items.push({ label: view.project.name, href: toHref(withLocation(p, { project: view.project.key })) });
  for (const r of view.regionTrail) {
    items.push({ label: r.title, href: toHref(withLocation(p, { project: view.project!.key, region: r.id })) });
  }
  if (view.finding) items.push({ label: 'Finding', href: toHref({ ...p, source: undefined }) });
  if (view.source) items.push({ label: 'Source' });
  return (
    <>
      {items.map((item, i) => {
        const last = i === items.length - 1;
        return (
          <span key={i} style={{ display: 'contents' }}>
            {i > 0 && <span className="separator">/</span>}
            {last || !item.href ? (
              <span className={last ? 'current' : undefined} aria-current={last ? 'page' : undefined}>
                {item.label}
              </span>
            ) : (
              <Link to={item.href}>{item.label}</Link>
            )}
          </span>
        );
      })}
    </>
  );
}

function EmptyLandscape() {
  return (
    <div className="empty-state">
      <div>
        <h2>No projects yet</h2>
        <p>
          The landscape draws the projects and understanding Chatdex already holds. Import conversations and run project discovery, or create a project, and it will appear here. Nothing is invented to fill the map.
        </p>
        <p>
          <Link className="external" to="/projects">
            Go to Projects →
          </Link>
        </p>
      </div>
    </div>
  );
}

function AboutNotice() {
  return (
    <section className="notice">
      <h3>What is on this map</h3>
      <p>
        Projects, findings, review states, sources, and dates are read live from the records on this device. Pending findings are AI proposals you have not accepted; superseded and resolved ones are history, shown hollow. Connections are conversations associated with two projects — shared sources, not dependencies.
      </p>
      <p>
        Concepts are your own organization: add them with “+ Add concept”, click one to enter it, and open “Develop” to describe it and record what you intend, believe, decided, and still ask. A concept can be just a name; it never claims the software does something. When a project has none, its findings sit in Uncategorized. Statements on the terrain are ones you pinned, or else the concept’s own accepted records in a fixed order — never generated text. Places keep their positions across filters and lenses.
      </p>
      <p>
        Back steps out one level; breadcrumbs jump to any ancestor; browser Back retraces your route. “Where you left off” uses visits recorded on this device only. Nothing on this page calls an AI provider; “Discuss with AI” opens native chat, which shows what it will send and asks first.
      </p>
    </section>
  );
}

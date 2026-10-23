import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BookOpen, ChevronRight, Database, Download, ExternalLink, FileText, FolderOpen,
  GraduationCap, Loader2, MessageSquare, Search, Sparkles, Users,
} from 'lucide-react';
import { fetchAwardOutputs, searchOpenAlex } from './openalex';
import { exportAtlas, initializeAtlas, loadAtlas, saveImport, saveInvestigation } from './storage';
import type { AtlasSnapshot } from './storage';
import type {
  AtlasTab, Investigation, InvestigationStatus, ResearchPaper, ResearchProject, Researcher,
} from './types';

const tabs: { key: AtlasTab; label: string; icon: typeof FolderOpen }[] = [
  { key: 'projects', label: 'Projects', icon: FolderOpen },
  { key: 'researchers', label: 'Researchers', icon: Users },
  { key: 'papers', label: 'Papers', icon: BookOpen },
  { key: 'investigations', label: 'My investigations', icon: MessageSquare },
];

const panel = 'rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900';
const secondary = 'text-gray-500 dark:text-gray-400';
const chip = 'rounded-full bg-violet-50 px-2.5 py-1 text-xs text-violet-700 dark:bg-violet-900/30 dark:text-violet-300';
const field = 'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:ring-2 focus:ring-violet-400 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100';

function TagList({ tags }: { tags: string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {tags.map((tag) => <span key={tag} className={chip}>{tag}</span>)}
    </div>
  );
}

function SourceLink({ href, label = 'View source' }: { href: string; label?: string }) {
  if (!/^https:\/\//i.test(href)) return null;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-sm font-medium text-violet-600 hover:underline dark:text-violet-400">
      {label} <ExternalLink size={13} />
    </a>
  );
}

function OriginLabel({ origin, checkedAt }: { origin: string; checkedAt?: string }) {
  return (
    <span className={secondary + ' text-xs'}>
      {origin === 'curated' ? 'Institutional source checked ' + (checkedAt ?? '') : 'OpenAlex index · affiliation not independently verified'}
    </span>
  );
}

function ResearchLink({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className="text-left text-sm font-medium text-violet-700 hover:underline dark:text-violet-400">
      {children} <ChevronRight size={12} className="inline" />
    </button>
  );
}

function InvestigationEditor({
  project, initial, onSaved,
}: {
  project: ResearchProject;
  initial?: Investigation;
  onSaved: () => Promise<void>;
}) {
  const [status, setStatus] = useState<InvestigationStatus>(initial?.status ?? 'saved');
  const [note, setNote] = useState(initial?.note ?? '');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState('');

  useEffect(() => {
    setStatus(initial?.status ?? 'saved');
    setNote(initial?.note ?? '');
    setFeedback('');
  }, [project.id, initial?.status, initial?.note]);

  const save = async () => {
    setSaving(true);
    setFeedback('');
    try {
      await saveInvestigation(project.id, status, note);
      await onSaved();
      setFeedback('Saved locally in this browser.');
    } catch {
      setFeedback('Could not save. Check browser storage permissions.');
    } finally {
      setSaving(false);
    }
  };

  const copyPrep = async () => {
    const text = [
      'Research contact prep', 'Research project: ' + project.title,
      'Source: ' + project.sourceUrl,
      'My reproduction or extension: ' + (note.trim() || '[Describe work you actually completed]'),
      'One specific technical question: [Write a concrete question]',
      'Researcher contact: [Find and verify an official university email]',
    ].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setFeedback('Contact preparation copied. Verify claims before reaching out.');
    } catch {
      setFeedback('Clipboard unavailable. Save your notes instead.');
    }
  };

  return (
    <section className="mt-6 rounded-xl border border-violet-200 bg-violet-50/50 p-4 dark:border-violet-900/60 dark:bg-violet-950/20">
      <div className="mb-1 flex items-center gap-2">
        <Sparkles size={17} className="text-violet-600" />
        <h3 className="font-semibold text-gray-900 dark:text-white">Investigate and contribute</h3>
      </div>
      <p className={secondary + ' mb-3 text-xs'}>
        Independent experiment idea—not a posted opening or invitation to collaborate.
      </p>
      <p className="mb-4 text-sm text-gray-800 dark:text-gray-200">
        {project.suggestedContribution ?? 'Start with a publicly available paper or dataset and document a reproducible result.'}
      </p>
      <div className="mb-2 flex items-center justify-between gap-3">
        <label htmlFor="atlas-status" className="text-sm font-medium text-gray-700 dark:text-gray-200">
          Your progress
        </label>
        <select id="atlas-status" value={status}
          onChange={(e) => setStatus(e.target.value as InvestigationStatus)}
          className={field + ' max-w-48'}>
          <option value="saved">Saved for later</option>
          <option value="reproducing">Reproducing / extending</option>
          <option value="contacted">Contacted researcher</option>
          <option value="completed">Completed</option>
        </select>
      </div>
      <label htmlFor="atlas-notes" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-200">
        Evidence, experiment, notes, and next question
      </label>
      <textarea id="atlas-notes" rows={5} className={field + ' resize-y'}
        placeholder="Which result could you reproduce? What code or dataset is public? What have you tried, and what happened?"
        value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={() => void save()} disabled={saving}
          className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50">
          {saving ? 'Saving…' : 'Save investigation'}
        </button>
        <button type="button" onClick={() => void copyPrep()}
          className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200">
          Copy contact prep
        </button>
      </div>
      {feedback && <p role="status" className={secondary + ' mt-2 text-xs'}>{feedback}</p>}
      <p className={secondary + ' mt-3 text-xs'}>
        Notes stay in this browser. No emails are sent and no private conversation history is accessed.
      </p>
    </section>
  );
}

function ProjectDetail({
  project, snapshot, onPerson, onPaper, onRefresh, onOutputs, outputsBusy,
}: {
  project: ResearchProject; snapshot: AtlasSnapshot;
  onPerson: (id: string) => void; onPaper: (id: string) => void;
  onRefresh: () => Promise<void>; onOutputs: (project: ResearchProject) => Promise<void>;
  outputsBusy: boolean;
}) {
  const people = project.researcherIds.map((id) => snapshot.researchers.find((p) => p.id === id))
    .filter((p): p is Researcher => !!p);
  const papers = project.paperIds.map((id) => snapshot.papers.find((p) => p.id === id))
    .filter((p): p is ResearchPaper => !!p);
  return (
    <>
      <p className={secondary + ' mb-2 text-xs uppercase tracking-wider'}>{project.kind === 'grant' ? 'Research grant / institute' : 'Research strand'} · {project.institution}</p>
      <h2 className="mb-3 text-xl font-semibold text-gray-900 dark:text-white">{project.title}</h2>
      <p className="mb-4 text-sm leading-6 text-gray-700 dark:text-gray-300">{project.description}</p>
      <TagList tags={project.topics} />
      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
        <SourceLink href={project.sourceUrl} label={project.origin === 'openalex' ? 'Open project record' : 'View institutional source'} />
        {project.awardNumber && <span className={secondary + ' text-xs'}>{project.funder ?? 'Award'} #{project.awardNumber}</span>}
        <OriginLabel origin={project.origin} checkedAt={project.verifiedAt} />
      </div>
      {(project.startDate || project.endDate) && (
        <p className={secondary + ' mt-2 text-xs'}>
          Reported grant period: {project.startDate ?? 'unknown'} → {project.endDate ?? 'unknown'} (not a verified active status)
        </p>
      )}
      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <section>
          <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-800 dark:text-gray-200">
            <Users size={16} /> Researchers · {people.length}
          </h3>
          <div className="space-y-2">
            {people.length ? people.map((p) => (
              <div key={p.id}>
                <ResearchLink onClick={() => onPerson(p.id)}>{p.name}</ResearchLink>
                <p className={secondary + ' text-xs'}>{p.role}</p>
              </div>
            )) : <p className={secondary + ' text-sm'}>No verified researcher links in this record.</p>}
          </div>
        </section>
        <section>
          <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-800 dark:text-gray-200">
            <BookOpen size={16} /> Linked publications · {papers.length}
          </h3>
          <div className="space-y-2">
            {papers.length ? papers.slice(0, 8).map((p) => (
              <div key={p.id}><ResearchLink onClick={() => onPaper(p.id)}>{p.title}</ResearchLink></div>
            )) : <p className={secondary + ' text-sm'}>No linked papers imported yet. This is not evidence of no publications.</p>}
          </div>
          {project.kind === 'grant' && project.awardNumber && (
            <button type="button" onClick={() => void onOutputs(project)} disabled={outputsBusy}
              className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-violet-600 hover:underline disabled:opacity-50 dark:text-violet-400">
              {outputsBusy ? <Loader2 size={14} className="animate-spin" /> : <Database size={14} />}
              Find grant-linked papers in OpenAlex
            </button>
          )}
        </section>
      </div>
      <InvestigationEditor key={project.id} project={project}
        initial={snapshot.investigations.find((item) => item.projectId === project.id)}
        onSaved={onRefresh} />
    </>
  );
}

function ResearcherDetail({
  person, snapshot, onProject,
}: { person: Researcher; snapshot: AtlasSnapshot; onProject: (id: string) => void }) {
  const projects = person.projectIds.map((id) => snapshot.projects.find((p) => p.id === id))
    .filter((p): p is ResearchProject => !!p);
  return (
    <>
      <p className={secondary + ' mb-2 text-xs uppercase tracking-wider'}>{person.institution}</p>
      <h2 className="mb-2 text-xl font-semibold text-gray-900 dark:text-white">{person.name}</h2>
      <p className={secondary + ' mb-3 text-sm'}>{person.role}</p>
      <TagList tags={person.topics} />
      <div className="mt-4 flex flex-wrap items-center gap-4">
        <SourceLink href={person.sourceUrl} label="Verify researcher profile" />
        {person.orcid && <SourceLink href={person.orcid} label="ORCID" />}
      </div>
      <p className={secondary + ' mt-2 text-xs'}>
        {person.origin === 'openalex'
          ? 'OpenAlex authors and affiliations come from publication metadata—not a verified faculty directory.'
          : 'Institutional profile or institute role verified from the linked source.'}
      </p>
      <h3 className="mb-3 mt-7 text-sm font-semibold text-gray-800 dark:text-gray-200">Associated projects</h3>
      <div className="space-y-3">
        {projects.length ? projects.map((p) => (
          <div key={p.id} className="rounded-lg border border-gray-200 p-3 dark:border-gray-800">
            <ResearchLink onClick={() => onProject(p.id)}>{p.title}</ResearchLink>
            <p className={secondary + ' mt-1 text-xs'}>{p.institution}</p>
          </div>
        )) : <p className={secondary + ' text-sm'}>No project association established. Search their work in OpenAlex or check their laboratory website.</p>}
      </div>
    </>
  );
}

function PaperDetail({
  paper, snapshot, onProject, onPerson,
}: {
  paper: ResearchPaper; snapshot: AtlasSnapshot;
  onProject: (id: string) => void; onPerson: (id: string) => void;
}) {
  const projects = paper.projectIds.map((id) => snapshot.projects.find((p) => p.id === id))
    .filter((p): p is ResearchProject => !!p);
  const researchers = paper.researcherIds.map((id) => snapshot.researchers.find((p) => p.id === id))
    .filter((p): p is Researcher => !!p);
  return (
    <>
      <p className={secondary + ' mb-2 text-xs uppercase tracking-wider'}>Scholarly publication · {paper.year || 'Year unverified'}</p>
      <h2 className="mb-3 text-xl font-semibold text-gray-900 dark:text-white">{paper.title}</h2>
      <p className={secondary + ' mb-4 text-sm'}>
        {paper.authors.length ? paper.authors.join(', ') : 'Authors: follow source link to verify.'}
      </p>
      <SourceLink href={paper.sourceUrl} label={paper.openAccess ? 'Read open-access work' : 'View publication source'} />
      {paper.doi && <p className={secondary + ' mt-2 break-all text-xs'}>DOI: {paper.doi}</p>}
      <h3 className="mb-3 mt-7 font-semibold text-gray-900 dark:text-white">Research connections</h3>
      <div className="space-y-3">
        {projects.map((p) => (
          <div key={p.id}><ResearchLink onClick={() => onProject(p.id)}>{p.title}</ResearchLink></div>
        ))}
        {researchers.map((p) => (
          <div key={p.id}><ResearchLink onClick={() => onPerson(p.id)}>{p.name} · {p.institution}</ResearchLink></div>
        ))}
        {!projects.length && !researchers.length && (
          <p className={secondary + ' text-sm'}>No grant or researcher connection verified yet.</p>
        )}
      </div>
      <p className={secondary + ' mt-6 text-xs'}>
        A publication's authorship does not prove an author is a professor, and a topical match does not establish grant funding.
      </p>
    </>
  );
}

export function ResearchAtlasPage() {
  const [snapshot, setSnapshot] = useState<AtlasSnapshot | null>(null);
  const [tab, setTab] = useState<AtlasTab>('projects');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<'search' | 'outputs' | null>(null);
  const [notice, setNotice] = useState('');

  const refresh = useCallback(async () => setSnapshot(await loadAtlas()), []);

  useEffect(() => {
    void initializeAtlas().then(refresh).catch(() => {
      setNotice('Could not open local research storage. Enable IndexedDB and refresh.');
    });
  }, [refresh]);

  const findProject = useCallback((id: string) => {
    setTab('projects'); setActiveId(id); setQuery('');
  }, []);
  const findPerson = useCallback((id: string) => {
    setTab('researchers'); setActiveId(id); setQuery('');
  }, []);
  const findPaper = useCallback((id: string) => {
    setTab('papers'); setActiveId(id); setQuery('');
  }, []);

  const listing = useMemo(() => {
    if (!snapshot) return [];
    const q = query.trim().toLocaleLowerCase();
    const records = tab === 'projects' ? snapshot.projects.map((p) => ({
      id: p.id, title: p.title, description: p.description,
      institution: p.institution, tags: p.topics, origin: p.origin,
    })) : tab === 'researchers' ? snapshot.researchers.map((p) => ({
      id: p.id, title: p.name, description: p.role,
      institution: p.institution, tags: p.topics, origin: p.origin,
    })) : tab === 'papers' ? snapshot.papers.map((p) => ({
      id: p.id, title: p.title, description: p.authors.slice(0, 3).join(', '),
      institution: p.year ? String(p.year) : 'Year unverified',
      tags: [], origin: p.origin,
    })) : snapshot.investigations.map((inv) => {
      const p = snapshot.projects.find((project) => project.id === inv.projectId);
      return { id: inv.projectId, title: p?.title ?? inv.projectId,
        description: inv.status, institution: p?.institution ?? '', tags: p?.topics ?? [],
        origin: p?.origin ?? 'curated' };
    });
    return records.filter((record) =>
      !q || [record.title, record.description, record.institution, ...record.tags].join(' ').toLocaleLowerCase().includes(q))
      .sort((a, b) => {
        if (a.origin !== b.origin) return a.origin === 'curated' ? -1 : 1;
        return a.title.localeCompare(b.title);
      });
  }, [snapshot, tab, query]);

  const selectedId = activeId && listing.some((item) => item.id === activeId)
    ? activeId : listing[0]?.id;
  const selectedProject = snapshot?.projects.find((p) => p.id === selectedId);
  const selectedResearcher = snapshot?.researchers.find((p) => p.id === selectedId);
  const selectedPaper = snapshot?.papers.find((p) => p.id === selectedId);

  const runSearch = async () => {
    if (tab === 'investigations') return;
    setBusy('search'); setNotice('');
    try {
      const result = await searchOpenAlex(tab, query);
      await saveImport(result);
      await refresh();
      setNotice('Imported ' + result.matched + ' ' + tab + ' from OpenAlex (first 25 matches; duplicate IDs updated).');
      const first = tab === 'projects' ? result.projects[0]?.id :
        tab === 'researchers' ? result.researchers[0]?.id : result.papers[0]?.id;
      // Clear the text filter to show the imported records, including variants
      // whose titles differ from the original search phrase.
      setQuery('');
      if (first) setActiveId(first);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'OpenAlex search failed. Check your connection.');
    } finally {
      setBusy(null);
    }
  };

  const runOutputs = async (project: ResearchProject) => {
    setBusy('outputs'); setNotice('');
    try {
      const result = await fetchAwardOutputs(project);
      await saveImport(result);
      await refresh();
      setNotice('Linked ' + result.papers.length + ' returned works to the selected grant. OpenAlex grant-to-work matching can be incomplete.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not fetch grant outputs.');
    } finally {
      setBusy(null);
    }
  };

  const counts = {
    projects: snapshot?.projects.length ?? 0,
    researchers: snapshot?.researchers.length ?? 0,
    papers: snapshot?.papers.length ?? 0,
    investigations: snapshot?.investigations.length ?? 0,
  };

  return (
    <div className="mx-auto max-w-7xl pb-12">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-violet-600 dark:text-violet-400">Chatdex / Discovery</p>
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">Research Atlas</h1>
          <p className={secondary + ' mt-2 max-w-2xl text-sm'}>
            Discover U.S. research, connect projects and people, and turn an unanswered question into a reproducible contribution.
          </p>
        </div>
        <button type="button" onClick={() => void exportAtlas()} disabled={!snapshot}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-40 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800">
          <Download size={16} /> Export atlas JSON
        </button>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ['Projects & strands', counts.projects, FolderOpen],
          ['Researcher profiles', counts.researchers, GraduationCap],
          ['Publications', counts.papers, FileText],
          ['Investigations', counts.investigations, MessageSquare],
        ].map(([label, value, Icon]) => {
          const Symbol = Icon as typeof FolderOpen;
          return <div key={label as string} className={panel + ' p-3'}>
            <Symbol size={17} className="mb-2 text-violet-500" />
            <p className="text-xl font-semibold tabular-nums text-gray-900 dark:text-white">{value as number}</p>
            <p className={secondary + ' text-xs'}>{label as string}</p>
          </div>;
        })}
      </div>

      <div className={panel + ' mb-5 p-4'}>
        <div className="mb-3 flex flex-wrap gap-2">
          {tabs.map(({ key, label, icon: Icon }) => (
            <button type="button" key={key}
              onClick={() => { setTab(key); setActiveId(null); setQuery(''); setNotice(''); }}
              className={tab === key
                ? 'flex items-center gap-2 rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium text-white'
                : 'flex items-center gap-2 rounded-lg bg-gray-100 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700'}>
              <Icon size={15} /> {label}
            </button>
          ))}
        </div>
        <form onSubmit={(e) => { e.preventDefault(); if (tab !== 'investigations') void runSearch(); }}
          className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-48 flex-1">
            <Search size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder={tab === 'investigations' ? 'Filter saved investigations' : 'Search locally, or import more from OpenAlex'}
              aria-label="Search research atlas" className={field + ' pl-10'} />
          </div>
          {tab !== 'investigations' && (
            <button type="submit" disabled={busy !== null || query.trim().length < 3}
              className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-40">
              {busy === 'search' ? <Loader2 size={16} className="animate-spin" /> : <Database size={16} />}
              Import from OpenAlex
            </button>
          )}
        </form>
        <p className={secondary + ' mt-2 text-xs'}>
          Search filters this browser's catalog instantly. Import retrieves up to 25 additional U.S.-affiliated records from OpenAlex.
          OpenAlex authors are not automatically verified professors; grant descriptions are not advertised openings.
        </p>
      </div>

      {notice && <p role="status" className="mb-4 rounded-lg border border-gray-200 p-3 text-sm text-gray-700 dark:border-gray-800 dark:text-gray-300">{notice}</p>}
      {!snapshot ? (
        <div className={panel + ' p-10 text-center'}><Loader2 className="mx-auto animate-spin text-violet-600" /><p className={secondary + ' mt-3 text-sm'}>Opening the atlas…</p></div>
      ) : (
        <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(270px,380px)_minmax(0,1fr)]">
          <section className={panel + ' max-h-[720px] overflow-auto p-2'} aria-label="Research results">
            <div className="px-2 py-2 text-xs font-medium uppercase tracking-wide text-gray-400">{listing.length} visible records</div>
            {!listing.length ? (
              <div className="px-4 py-10 text-center">
                <Search className="mx-auto mb-3 text-gray-400" />
                <p className={secondary + ' text-sm'}>{tab === 'investigations' ? 'No saved investigations yet. Save a project to begin.' : 'No matches in your local atlas. Try another query or import results from OpenAlex.'}</p>
              </div>
            ) : listing.map((item) => (
              <button key={item.id} type="button" onClick={() => setActiveId(item.id)}
                className={selectedId === item.id
                  ? 'mb-1 w-full rounded-lg border border-violet-200 bg-violet-50 px-3 py-3 text-left dark:border-violet-900 dark:bg-violet-900/20'
                  : 'mb-1 w-full rounded-lg border border-transparent px-3 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-800'}>
                <p className="font-medium leading-5 text-gray-900 dark:text-gray-100">{item.title}</p>
                <p className={secondary + ' mt-1 text-xs'}>{item.institution}</p>
                {item.tags.length > 0 && <p className={secondary + ' mt-2 truncate text-xs'}>{item.tags.slice(0, 3).join(' · ')}</p>}
              </button>
            ))}
          </section>
          <section className={panel + ' min-h-96 p-5 sm:p-7'} aria-label="Research detail">
            {(tab === 'projects' || tab === 'investigations') && selectedProject ? (
              <ProjectDetail project={selectedProject} snapshot={snapshot}
                onPerson={findPerson} onPaper={findPaper} onRefresh={refresh}
                onOutputs={runOutputs} outputsBusy={busy === 'outputs'} />
            ) : tab === 'researchers' && selectedResearcher ? (
              <ResearcherDetail person={selectedResearcher} snapshot={snapshot} onProject={findProject} />
            ) : tab === 'papers' && selectedPaper ? (
              <PaperDetail paper={selectedPaper} snapshot={snapshot} onProject={findProject} onPerson={findPerson} />
            ) : (
              <div className="flex min-h-64 flex-col items-center justify-center gap-3 text-center">
                <BookOpen size={32} className="text-gray-400" />
                <p className={secondary + ' text-sm'}>Select a record to examine its evidence and connections.</p>
              </div>
            )}
          </section>
        </div>
      )}
      <p className={secondary + ' mt-5 text-xs'}>
        Source-backed starter catalog checked October 23, 2026; new imports are direct OpenAlex metadata.
        OpenAlex coverage, grant–paper matching and author identification can be incomplete. Nothing here establishes that an investigator is accepting collaborators.
      </p>
    </div>
  );
}

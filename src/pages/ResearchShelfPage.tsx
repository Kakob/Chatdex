import { SourceTextReader } from '../components/research/SourceTextReader';
import { timeLabel } from '../components/research/format';
import { createSyntheticWalkthrough } from '../lib/research/synthetic';
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { db } from '../lib/db/schema';
import { MIT_QUESTION, SECOND_QUESTION, unknownTime, registerSource, importText, parseRegistry, registerConversation, startResearchCase } from '../lib/research/service';
import type { ResearchSource, ResearchSnapshot } from '../types/research';
import type { InvestigationCase } from '../types/investigation';
import type { StoredConversation } from '../types';
import { Panel, Field, TimeField, inputClass, buttonClass } from '../components/research/shared';

export function ResearchShelfPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [sources, setSources] = useState<ResearchSource[]>([]);
  const [snapshots, setSnapshots] = useState<ResearchSnapshot[]>([]);
  const [cases, setCases] = useState<InvestigationCase[]>([]);
  const [conversations, setConversations] = useState<StoredConversation[]>([]);
  const [question, setQuestion] = useState(MIT_QUESTION);
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState('document');
  const [attribution, setAttribution] = useState('');
  const [uri, setUri] = useState('');
  const [notes, setNotes] = useState('');
  const [locator, setLocator] = useState('');
  const [authored, setAuthored] = useState(unknownTime);
  const [eventTime, setEventTime] = useState(unknownTime);
  const [target, setTarget] = useState('');
  const [pasteText, setPasteText] = useState('');
  const [pasteFilename, setPasteFilename] = useState('export.txt');
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState<{ filename: string; text: string } | null>(null);
  const [registry, setRegistry] = useState<ReturnType<typeof parseRegistry> | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const rows = await db.researchSources.where('projectId').equals(id).toArray();
    setSources(rows);
    setSnapshots((await Promise.all(rows.map(s => db.researchSnapshots.where('sourceId').equals(s.id).toArray()))).flat());
    setCases((await db.investigationCases.where('projectId').equals(id).toArray()).filter(c => c.research));
    const links = await db.projectAssociations.where('projectId').equals(id).toArray();
    setConversations((await db.conversations.bulkGet(links.filter(l => ['accepted', 'edited'].includes(l.reviewState)).map(l => l.conversationId))).filter((c): c is StoredConversation => !!c));
  }, [id]);
  useEffect(() => { void load().catch(e => setError(String(e))); }, [load]);
  const run = async (action: () => Promise<unknown>) => { setBusy(true); setError(''); try { await action(); await load(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } };
  const metadata = { projectId: id, title, kind, attribution, uri, authored, eventTime, notes, locator };
  return <div className="space-y-5 text-gray-900 dark:text-gray-100 max-w-6xl">
    <Link className="text-violet-600" to={`/projects/${id}/investigate`}>← Investigate History</Link>
    <header><h1 className="text-2xl font-semibold">Research sources & questions</h1><p className="text-gray-500 mt-2">Private on this device. Register leads, import your exports, and investigate what the sources actually say. No account fetching or AI interpretation.</p><a href="#source-shelf" className="inline-block mt-3 text-violet-600 underline">Read sources · {sources.filter(s => snapshots.some(v => v.sourceId === s.id)).length} imported</a></header>
    {notice && <p role="status" className="text-green-700 dark:text-green-300">{notice}</p>}
    {error && <p role="alert" className="text-red-600">{error}</p>}
    <fieldset disabled={busy} className="space-y-5">
    <Panel title="Try a private synthetic walkthrough"><p className="text-sm">Creates a separate, clearly marked Fern Harbor project with two fabricated documents, a ChatGPT-format conversation, pinned excerpts and a tentative example relation. No personal material or MIT conclusions.</p><button className={buttonClass} onClick={() => void run(async () => { const c = await createSyntheticWalkthrough(); navigate(`/projects/${c.projectId}/investigate/questions/${c.id}`); })}>Open synthetic walkthrough</button></Panel>
    <Panel title="Start with a question"><Field label="Investigation question"><input className={inputClass} value={question} onChange={e => setQuestion(e.target.value)} /></Field><div className="flex gap-2 flex-wrap"><button className={buttonClass} onClick={() => void run(async () => { const c = await startResearchCase(id, question); navigate(`/projects/${id}/investigate/questions/${c.id}`); })}>Start investigation · no conversation required</button><button className={buttonClass} onClick={() => setQuestion(SECOND_QUESTION)}>Use coordination question</button></div>{cases.map(c => <div key={c.id}><Link className="text-violet-600 hover:underline" to={`/projects/${id}/investigate/questions/${c.id}`}>{c.title}</Link> <span className="text-xs">{c.state}</span></div>)}</Panel>
    <div className="grid gap-5 lg:grid-cols-2">
    <Panel title="Register or import a source">
      <Field label="Import into"><select className={inputClass} value={target} onChange={e => setTarget(e.target.value)}><option value="">New source using metadata below</option>{sources.filter(s => !s.conversationId).map(s => <option key={s.id} value={s.id}>{s.title} — add immutable version</option>)}</select></Field>
      {!target && <><Field label="Source title"><input className={inputClass} value={title} onChange={e => setTitle(e.target.value)} /></Field><Field label="Source kind"><select className={inputClass} value={kind} onChange={e => setKind(e.target.value)}>{['document', 'contemporary record', 'recollection', 'interview', 'institutional statement', 'published media', 'AI output', 'analyst hypothesis', 'email', 'video'].map(k => <option key={k}>{k}</option>)}</select></Field><Field label="Author / speaker / group attribution (unknown allowed)"><input className={inputClass} value={attribution} onChange={e => setAttribution(e.target.value)} /></Field><Field label="Original URL or reference (not fetched)"><input className={inputClass} value={uri} onChange={e => setUri(e.target.value)} /></Field><TimeField label="Source authored date" value={authored} onChange={setAuthored} /><TimeField label="Described event date or range" value={eventTime} onChange={setEventTime} /><Field label="Page, section or video timestamp (unverified)"><input className={inputClass} value={locator} onChange={e => setLocator(e.target.value)} /></Field><Field label="Research lead notes (not evidence)"><textarea className={inputClass} value={notes} onChange={e => setNotes(e.target.value)} /></Field><button className={buttonClass} onClick={() => void run(() => registerSource(metadata))}>Register reference only</button></>}
      <Field label="Choose UTF-8 text or Markdown export"><input type="file" accept=".txt,.md,text/plain,text/markdown" onChange={e => { const f = e.target.files?.[0]; if (f) void run(async () => { if (!/\.(txt|md)$/i.test(f.name)) throw new Error('Choose .txt or .md'); const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await f.arrayBuffer()); setPending({ filename: f.name, text }); if (!title) setTitle(f.name); }); e.target.value = ''; }} /></Field>
      <p className="text-xs text-gray-500">Google Docs: download .txt or Markdown. Email/PDF: export or transcribe to UTF-8 text; record the original locator and any transcription uncertainty. Video: register a timestamped reference.</p>
      <details><summary className="cursor-pointer text-violet-600">Paste text instead (if file selection fails)</summary>
        <div className="space-y-3 mt-3">
          <p className="text-sm">Paste the document export, then preview before saving. Clipboard text may normalize line endings; use a file when exact original bytes matter.</p>
          <Field label="Export filename"><input className={inputClass} value={pasteFilename} onChange={e => setPasteFilename(e.target.value)} /></Field>
          <Field label="Document text"><textarea className={`${inputClass} min-h-40`} value={pasteText} onChange={e => setPasteText(e.target.value)} /></Field>
          <button className={buttonClass} disabled={!pasteText.trim()} onClick={() => void run(async () => {
            if (!/\.(txt|md)$/i.test(pasteFilename)) throw new Error('Use a .txt or .md export filename');
            setPending({ filename: pasteFilename, text: pasteText });
            if (!title) setTitle(pasteFilename);
          })}>Preview pasted text</button>
        </div>
      </details>
      {pending && <div className="space-y-2 border rounded p-3"><p>Preview: {pending.filename} · {pending.text.length} characters · exact text stored locally. Repeated content is deduplicated within this source.</p><pre className="max-h-48 overflow-auto whitespace-pre-wrap text-xs">{pending.text}</pre><button className={buttonClass} onClick={() => void run(async () => { const s = target ? sources.find(s => s.id === target)! : await registerSource(metadata); await importText(id, s.id, pending.filename, pending.text); setPending(null); setPasteText(''); setNotice(`Imported into ${s.title}. Open Read imported text on its source card below.`); })}>Confirm local import</button><button className={buttonClass} onClick={() => setPending(null)}>Cancel</button></div>}
    </Panel>
    <div className="space-y-5"><Panel title="Private registry leads"><p className="text-sm">Select the companion .private.json file. This registers metadata only; it does not import evidence or visit links.</p><input aria-label="Private source registry" type="file" accept=".json" onChange={e => { const f = e.target.files?.[0]; if (f) void run(async () => setRegistry(parseRegistry(await f.text()))); e.target.value = ''; }} />{registry && <><ul className="text-sm space-y-2">{registry.map((r, i) => <li key={i}>{r.title} · reference-only / import needed · date claim: {timeLabel(r.authored)}</li>)}</ul><button className={buttonClass} onClick={() => void run(async () => { for (const lead of registry) await registerSource({ ...lead, projectId: id }); setRegistry(null); })}>Register {registry.length} leads locally</button><button className={buttonClass} onClick={() => setRegistry(null)}>Cancel</button></>}</Panel>
    <Panel title="Accepted project conversations"><p className="text-sm">Import ChatGPT/Claude ZIP or JSON through <Link className="text-violet-600" to="/import">Import</Link>, then accept its association in the <Link className="text-violet-600" to={`/projects/${id}`}>project overview</Link>.</p>{conversations.map(c => <div key={c.id} className="flex gap-2 justify-between items-center"><span className="text-sm">{c.name}</span><button className={buttonClass} onClick={() => void run(() => registerConversation(id, c.id))}>Add to shelf</button></div>)}</Panel></div></div>
    <div id="source-shelf" className="scroll-mt-5"><Panel title={`Source shelf · ${sources.length}`}>
      {!sources.length && <p>No sources registered. A reference establishes a lead, not the truth of its contents.</p>}
      {sources.map(s => <article key={s.id} className="border-t border-gray-200 dark:border-gray-800 pt-3 space-y-1"><h3 className="font-medium">{s.title}</h3><p className="text-sm">{s.kind} · {s.attribution || 'attribution unknown'} · {s.access === 'reference-only' ? 'reference-only / import needed' : `${snapshots.filter(v => v.sourceId === s.id).length} imported version(s)`}</p><SourceTextReader versions={snapshots.filter(v => v.sourceId === s.id)} /><p className="text-xs text-gray-500">Authored: {timeLabel(s.authored)} · Event: {timeLabel(s.eventTime)} · Registered: {s.registeredAt.toLocaleString()}</p><details><summary className="text-sm cursor-pointer">Lead metadata and versions</summary><p className="text-sm break-all">{s.uri}</p><p className="text-sm whitespace-pre-wrap">{s.notes}</p>{snapshots.filter(v => v.sourceId === s.id).map(v => <p className="text-xs break-all" key={v.id}>Imported {v.importedAt.toLocaleString()} · {v.filename} · SHA-256 {v.contentHash}</p>)}</details></article>)}
    </Panel></div></fieldset>
  </div>;
}

import { db } from '../db/schema';
import { generateId } from '../utils/ids';
import { sha256Hex } from '../utils/hash';
import { createUnderstandingObject } from '../db/understanding';
import { getMessagesForConversation } from '../db/messages';
import { normalizeSession } from '../detection/normalize';
import { stepDisplayText } from '../investigation/search';
import type { InvestigationCase, InvestigationFinding } from '../../types/investigation';
import { RELATIONS, type ResearchSource, type ResearchSnapshot, type ResearchExhibit, type ResearchTime, type QuestionRelation } from '../../types/research';

export const unknownTime = (): ResearchTime => ({ value: '', precision: 'unknown' });
export const MIT_QUESTION = 'How has my question about MIT, and my method for investigating it, changed?';
export const SECOND_QUESTION = 'How was Steer Roast 2016 coordinated across people, places, and organizations?';
async function projectExists(id: string) {
  const p = await db.understandingProjects.get(id);
  if (!p || !['accepted', 'edited'].includes(p.reviewState)) throw new Error('An accepted project is required');
}
export async function ensureMITProject() {
  const existing = await db.understandingProjects.where('name').equals('MIT Investigations').first();
  if (existing) { await projectExists(existing.id); return existing; }
  const now = new Date();
  const p = { id: generateId(), name: 'MIT Investigations', origin: 'user' as const, reviewState: 'accepted' as const, createdAt: now, updatedAt: now };
  await db.understandingProjects.add(p);
  return p;
}
export async function registerSource(input: Omit<ResearchSource, 'id' | 'registeredAt' | 'access' | 'privacy'>) {
  await projectExists(input.projectId);
  if (!input.title.trim()) throw new Error('Source title is required');
  if (input.registryId) {
    const old = await db.researchSources.where('[projectId+registryId]').equals([input.projectId, input.registryId]).first();
    if (old) return old;
  }
  const row: ResearchSource = { ...input, id: generateId(), access: 'reference-only', privacy: 'private-local', registeredAt: new Date() };
  await db.researchSources.add(row);
  return row;
}
export async function requireSource(projectId: string, sourceId: string) {
  await projectExists(projectId);
  const source = await db.researchSources.get(sourceId);
  if (!source || source.projectId !== projectId) throw new Error('Source unavailable for this project');
  return source;
}
export async function importText(projectId: string, sourceId: string, filename: string, text: string) {
  const source = await requireSource(projectId, sourceId);
  if (source.conversationId) throw new Error('Use the conversation importer for conversation sources');
  if (!/\.(txt|md)$/i.test(filename)) throw new Error('Export this document as UTF-8 .txt or .md first. PDF and EML are not supported.');
  return saveSnapshot(source, { text, filename, format: 'text' });
}
async function saveSnapshot(source: ResearchSource, input: Pick<ResearchSnapshot, 'text' | 'filename' | 'format' | 'segments'>) {
  const contentHash = await sha256Hex(input.text);
  // Hash before transaction: WebCrypto must not auto-close an IDB transaction.
  return db.transaction('rw', [db.researchSources, db.researchSnapshots], async () => {
    const old = await db.researchSnapshots.where('[sourceId+contentHash]').equals([source.id, contentHash]).first();
    if (old) return old;
    const snapshot: ResearchSnapshot = { ...input, id: generateId(), sourceId: source.id, contentHash, importedAt: new Date() };
    await db.researchSnapshots.add(snapshot);
    await db.researchSources.update(source.id, { access: 'imported' });
    return snapshot;
  });
}
/** Explicitly attach an already accepted conversation; never discover or fetch accounts. */
export async function registerConversation(projectId: string, conversationId: string) {
  await projectExists(projectId);
  const association = await db.projectAssociations.where('[projectId+conversationId]').equals([projectId, conversationId]).first();
  const conversation = await db.conversations.get(conversationId);
  if (!conversation || !association || !['accepted', 'edited'].includes(association.reviewState)) throw new Error('Accept this conversation in the project overview first');
  const source = await registerSource({ projectId, title: conversation.name, kind: `conversation (${conversation.source})`, attribution: 'Per-message roles', uri: '', authored: unknownTime(), eventTime: unknownTime(), notes: '', locator: '', conversationId, registryId: `conversation:${conversationId}` });
  const messages = await getMessagesForConversation(conversationId);
  let text = '';
  const segments: NonNullable<ResearchSnapshot['segments']> = [];
  for (const step of normalizeSession(conversationId, messages).steps) {
    const body = stepDisplayText(step);
    const message = messages.find(m => m.id === step.messageId);
    const role = step.kind === 'user_msg' ? 'user' : step.kind === 'agent_text' ? 'assistant' : 'tool';
    const expressedAt = message?.createdAt?.toISOString() ?? '';
    text += `[${role} · ${expressedAt || 'date unknown'}]\n`;
    const start = text.length;
    text += body;
    segments.push({ start, end: text.length, role, messageId: step.messageId, expressedAt });
    text += '\n\n';
  }
  await saveSnapshot(source, { text, segments, format: 'conversation', filename: conversation.name });
  return source;
}
export async function startResearchCase(projectId: string, question: string): Promise<InvestigationCase> {
  await projectExists(projectId);
  if (!question.trim()) throw new Error('Write an investigation question');
  const now = new Date();
  const row: InvestigationCase = { id: generateId(), projectId, conversationId: '', research: true, researchSourceIds: [], linkedAnchorStableKeys: [], kind: 'question', title: question.trim(), notes: '', state: 'open', searchRecords: [], createdAt: now, updatedAt: now };
  await db.investigationCases.add(row);
  return row;
}
export async function requireResearchCase(caseId: string, editable = false) {
  const row = await db.investigationCases.get(caseId);
  if (!row?.research || !row.projectId) throw new Error('Research investigation unavailable');
  await projectExists(row.projectId);
  if (editable && ['completed', 'adjudicated'].includes(row.state)) throw new Error('Reopen this investigation first');
  return row;
}
export async function attachSource(caseId: string, sourceId: string, attached: boolean) {
  const row = await requireResearchCase(caseId, true);
  await requireSource(row.projectId!, sourceId);
  const ids = new Set(row.researchSourceIds ?? []);
  if (attached) ids.add(sourceId); else ids.delete(sourceId);
  await db.investigationCases.update(caseId, { researchSourceIds: [...ids], updatedAt: new Date() });
}
export async function pinResearchExhibit(caseId: string, sourceId: string, input: { snapshotId?: string; start?: number; end?: number; note: string; locator?: string }) {
  const row = await requireResearchCase(caseId, true);
  const source = await requireSource(row.projectId!, sourceId);
  if (!row.researchSourceIds?.includes(sourceId)) throw new Error('Attach this source before pinning');
  let exhibit: ResearchExhibit = { id: generateId(), caseId, sourceId, quote: '', role: source.attribution || 'unknown', expressedAt: source.authored, note: input.note, createdAt: new Date() };
  if (!input.snapshotId) {
    if (!input.locator?.trim()) throw new Error('Write an unverified page, section or timestamp locator');
    exhibit.locator = input.locator;
  } else {
    const snapshot = await db.researchSnapshots.get(input.snapshotId);
    if (!snapshot || snapshot.sourceId !== sourceId) throw new Error('Source unavailable');
    if (await sha256Hex(snapshot.text) !== snapshot.contentHash) throw new Error('Source mismatch');
    const { start, end } = input;
    if (start === undefined || end === undefined || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > snapshot.text.length) throw new Error('Select a nonempty exact span');
    const segment = snapshot.segments?.find(s => start >= s.start && end <= s.end);
    if (snapshot.format === 'conversation' && !segment) throw new Error('Select text within one message, excluding its role/date heading');
    const quote = snapshot.text.slice(start, end);
    exhibit = { ...exhibit, snapshotId: snapshot.id, sourceHash: snapshot.contentHash, start, end, quote, quoteHash: await sha256Hex(quote), ...(segment ? { role: segment.role, expressedAt: segment.expressedAt ? { value: segment.expressedAt, precision: 'exact' } : unknownTime() } : {}) };
  }
  await db.researchExhibits.add(exhibit);
  return exhibit;
}
export async function resolveExhibit(exhibit: ResearchExhibit): Promise<{ status: 'exact' | 'reference-only' | 'source unavailable' | 'source mismatch'; snapshot?: ResearchSnapshot }> {
  const source = await db.researchSources.get(exhibit.sourceId);
  if (!source) return { status: 'source unavailable' };
  if (!exhibit.snapshotId) return { status: 'reference-only' };
  const snapshot = await db.researchSnapshots.get(exhibit.snapshotId);
  if (!snapshot) return { status: 'source unavailable' };
  if (snapshot.sourceId !== exhibit.sourceId || snapshot.contentHash !== exhibit.sourceHash || await sha256Hex(snapshot.text) !== exhibit.sourceHash || !Number.isInteger(exhibit.start) || !Number.isInteger(exhibit.end) || exhibit.start! < 0 || exhibit.end! <= exhibit.start! || exhibit.end! > snapshot.text.length || snapshot.text.slice(exhibit.start, exhibit.end) !== exhibit.quote || await sha256Hex(exhibit.quote) !== exhibit.quoteHash) return { status: 'source mismatch' };
  return { status: 'exact', snapshot };
}
export async function saveResearchFinding(caseId: string, input: { id?: string; title: string; body: string; support: string[]; conflict: string[] }) {
  const row = await requireResearchCase(caseId, true);
  if (!input.title.trim()) throw new Error('Write your finding or unresolved question');
  const ids = [...new Set([...input.support, ...input.conflict])];
  if (!ids.length) throw new Error('Select supporting or conflicting exhibits');
  const exhibits = await db.researchExhibits.bulkGet(ids);
  if (exhibits.some(e => !e || e.caseId !== caseId)) throw new Error('Evidence must belong to this case');
  const old = input.id ? await db.investigationFindings.get(input.id) : undefined;
  if (input.id && (!old || old.caseId !== caseId)) throw new Error('Finding unavailable for this case');
  const now = new Date();
  const finding: InvestigationFinding = { id: old?.id ?? generateId(), caseId, projectId: row.projectId!, type: 'question', title: input.title.trim(), body: input.body, confidence: 'low', state: 'draft', exhibitIds: [], reviewScopeIds: [], researchExhibitIds: input.support, conflictingExhibitIds: input.conflict, createdAt: old?.createdAt ?? now, updatedAt: now, revisions: [...(old?.revisions ?? []), ...(old ? [{ title: old.title, body: old.body, exhibitIds: old.researchExhibitIds ?? [], conflictingExhibitIds: old.conflictingExhibitIds ?? [], revisedAt: old.updatedAt }] : [])] };
  await db.investigationFindings.put(finding);
  return finding;
}
export async function finalizeResearchFinding(id: string) {
  const finding = await db.investigationFindings.get(id);
  if (!finding) throw new Error('Finding unavailable');
  await requireResearchCase(finding.caseId, true);
  await db.investigationFindings.update(id, { state: 'finalized', finalizedAt: new Date(), updatedAt: new Date() });
}
export async function createQuestionNode(projectId: string, exhibitId: string) {
  const exhibit = await db.researchExhibits.get(exhibitId);
  if (!exhibit) throw new Error('Exhibit unavailable');
  const row = await requireResearchCase(exhibit.caseId);
  if (row.projectId !== projectId) throw new Error('Question evidence belongs to another project');
  if ((await resolveExhibit(exhibit)).status !== 'exact') throw new Error('An exact, available source excerpt is required');
  return createUnderstandingObject({ projectId, type: 'question', title: exhibit.quote, origin: 'user', evidence: [],
    // This event records the human's adoption, NOT an invented historical date.
    occurredAt: new Date(), meta: { researchExhibitId: exhibit.id, researchCaseId: exhibit.caseId, expressedAt: exhibit.expressedAt.value, expressedPrecision: exhibit.expressedAt.precision, speaker: exhibit.role, eventClock: 'human-adoption' } });
}
export async function addRelation(projectId: string, input: Pick<QuestionRelation, 'from' | 'to' | 'kind' | 'explanation' | 'tentative'>) {
  await projectExists(projectId);
  if (!RELATIONS.includes(input.kind) || input.from === input.to || !input.explanation.trim()) throw new Error('Choose two different questions and explain your relation');
  const nodes = await db.understandingObjects.bulkGet([input.from, input.to]);
  if (nodes.some(n => !n || n.projectId !== projectId || n.type !== 'question' || !n.meta?.researchExhibitId)) throw new Error('Both questions must belong to this project lineage');
  const row: QuestionRelation = { ...input, id: generateId(), projectId, action: 'add', createdAt: new Date() };
  await db.questionRelations.add(row);
  return row;
}
export async function removeRelation(projectId: string, id: string, explanation: string) {
  const old = await db.questionRelations.get(id);
  if (!old || old.projectId !== projectId || old.action !== 'add' || !explanation.trim()) throw new Error('Select a relation and provide a correction reason');
  await db.questionRelations.add({ ...old, id: generateId(), action: 'remove', replacesId: id, explanation, createdAt: new Date() });
}

export function parseRegistry(text: string): Omit<ResearchSource, 'id' | 'projectId' | 'registeredAt' | 'access' | 'privacy'>[] {
  const data: unknown = JSON.parse(text);
  if (!data || typeof data !== 'object' || !('sources' in data) || !Array.isArray(data.sources)) throw new Error('Registry must contain a sources array');
  return data.sources.map((s: unknown) => {
    if (!s || typeof s !== 'object' || !('title' in s) || typeof s.title !== 'string') throw new Error('Every registry lead needs a title');
    const v = s as Record<string, unknown>;
    const str = (key: string) => typeof v[key] === 'string' ? v[key] as string : '';
    const precision = str('authored_precision');
    return { title: str('title'), kind: str('kind') || 'document', attribution: '', uri: str('locator'), authored: { value: str('authored_at'), precision: (['exact', 'day', 'month', 'year', 'range', 'approximate'].includes(precision) ? precision : str('authored_at') ? 'approximate' : 'unknown') as ResearchTime['precision'] }, eventTime: unknownTime(), locator: '', notes: [str('notes'), str('suggested_import')].filter(Boolean).join('\n'), registryId: str('id') || str('title') };
  });
}
export async function exportPacket(caseId: string, options = { includeBodies: false, includeUrls: false }) {
  const investigation = await requireResearchCase(caseId);
  const exhibits = await db.researchExhibits.where('caseId').equals(caseId).toArray();
  const sources = await db.researchSources.bulkGet([...new Set([...(investigation.researchSourceIds ?? []), ...exhibits.map(e => e.sourceId)])]);
  const snapshots = (await Promise.all(sources.filter(Boolean).map(s => db.researchSnapshots.where('sourceId').equals(s!.id).toArray()))).flat();
  const questions = (await db.understandingObjects.where('projectId').equals(investigation.projectId!).toArray()).filter(n => n.type === 'question' && n.meta?.researchExhibitId && exhibits.some(e => e.id === n.meta!.researchExhibitId));
  const relations = await db.questionRelations.where('projectId').equals(investigation.projectId!).toArray();
  const packet = { format: 'chatdex-private-research-v1', exportedAt: new Date(), privacy: 'Private inspection packet. Quotes and human notes may identify people. Not a public/redacted publication.', options, investigation, sources: sources.map(s => s ? { ...s, uri: options.includeUrls ? s.uri : undefined } : { access: 'source unavailable' }), snapshots: snapshots.map(s => ({ ...s, text: options.includeBodies ? s.text : undefined })), exhibits: await Promise.all(exhibits.map(async e => ({ ...e, integrity: (await resolveExhibit(e)).status }))), findings: await db.investigationFindings.where('caseId').equals(caseId).toArray(), questions, relations: relations.filter(r => questions.some(q => q.id === r.from || q.id === r.to)) };
  // URLs can also occur in notes, quotes, locators, titles and historical revisions.
  const json = JSON.stringify(packet, null, 2);
  return options.includeUrls ? json : json.replace(/https?:\/\/[^\s"<>\\]+/gi, '[URL omitted]');
}
export function packetMarkdown(json: string) {
  const p = JSON.parse(json);
  return `# ${p.investigation.title}\n\nPrivate research packet. Human-authored; uncertainty retained.\n\n${p.investigation.notes}\n\n## Findings\n\n${p.findings.map((f: InvestigationFinding) => `### ${f.title}\n\n${f.body ?? ''}\n\nState: ${f.state}; supporting: ${(f.researchExhibitIds ?? []).join(', ')}; conflicting: ${(f.conflictingExhibitIds ?? []).join(', ')}`).join('\n\n')}\n\n## Inspectable inventory, evidence, lineage and revision history\n\n\`\`\`json\n${json}\n\`\`\`\n`;
}

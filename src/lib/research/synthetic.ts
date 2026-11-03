/** Fabricated demonstration only. Never mixed into the MIT project. */
import { db } from '../db/schema';
import { createHumanProject, associateConversationWithProject } from '../db/understanding';
import { importFiles } from '../import';
import { registerSource, importText, startResearchCase, registerConversation, attachSource, pinResearchExhibit, createQuestionNode, addRelation, saveResearchFinding, unknownTime } from './service';

export const SYNTHETIC_EARLY = 'SYNTHETIC — Fern Harbor field notebook, 2019\r\nHow do I record how my own account is made?\r\nMira Example, fictional researcher.\r\n';
export const SYNTHETIC_LATE = 'SYNTHETIC — Fern Harbor retrospective, date unknown\nI remember one organizer, but this recollection may omit others.\n';
export const SYNTHETIC_QUESTION = 'How do I compare my account with the records of other participants?';
export const SYNTHETIC_CHAT = JSON.stringify([{ id: 'chatdex-synthetic-inquiry-chat-v1', title: 'SYNTHETIC — Fern Harbor questions', create_time: 1792195200, update_time: 1792195300, current_node: 'answer', mapping: {
  root: { id: 'root', parent: null, children: ['question'], message: null },
  question: { id: 'question', parent: 'root', children: ['answer'], message: { id: 'synthetic-question', author: { role: 'user' }, create_time: 1792195200, content: { content_type: 'text', parts: [SYNTHETIC_QUESTION] } } },
  answer: { id: 'answer', parent: 'question', children: [], message: { id: 'synthetic-answer', author: { role: 'assistant' }, create_time: 1792195300, content: { content_type: 'text', parts: ['SYNTHETIC assistant suggestion: compare independent records. This is not the user’s belief.'] } } },
} }]);
export async function createSyntheticWalkthrough() {
  const old = await db.understandingProjects.where('name').equals('SYNTHETIC — Fern Harbor inquiry').first();
  const existing = old && (await db.investigationCases.where('projectId').equals(old.id).toArray()).find(c => c.research);
  if (existing) return existing;
  const project = old ?? await createHumanProject({ name: 'SYNTHETIC — Fern Harbor inquiry' });
  const row = await startResearchCase(project.id, 'SYNTHETIC: How did the Fern Harbor research question change?');
  const base = { projectId: project.id, kind: 'document', attribution: 'Mira Example (fictional)', uri: '', authored: unknownTime(), eventTime: unknownTime(), notes: 'Fabricated demo, not personal evidence.', locator: '' };
  const early = await registerSource({ ...base, title: 'SYNTHETIC 2019 notebook', authored: { value: '2019', precision: 'year' } });
  const late = await registerSource({ ...base, title: 'SYNTHETIC later recollection', kind: 'recollection', eventTime: { value: '2016–2017', precision: 'range' } });
  const a = await importText(project.id, early.id, 'synthetic-2019.txt', SYNTHETIC_EARLY);
  const b = await importText(project.id, late.id, 'synthetic-recollection.md', SYNTHETIC_LATE);
  // Exercise the production ChatGPT importer, including raw-source retention.
  await importFiles([new File([SYNTHETIC_CHAT], 'synthetic-chatgpt.json', { type: 'application/json' })]);
  await associateConversationWithProject(project.id, 'chatdex-synthetic-inquiry-chat-v1');
  const chat = await registerConversation(project.id, 'chatdex-synthetic-inquiry-chat-v1');
  const c = (await db.researchSnapshots.where('sourceId').equals(chat.id).toArray())[0];
  const reference = await registerSource({ ...base, title: 'SYNTHETIC unimported interview lead', kind: 'interview', uri: 'https://example.invalid/private-interview', locator: '00:45', notes: 'Reference only: no transcript was supplied.' });
  for (const s of [early, late, chat, reference]) await attachSource(row.id, s.id, true);
  const start = a.text.indexOf('How do');
  const ea = await pinResearchExhibit(row.id, early.id, { snapshotId: a.id, start, end: a.text.indexOf('\r\n', start), note: 'SYNTHETIC selection of early wording.' });
  const eb = await pinResearchExhibit(row.id, late.id, { snapshotId: b.id, start: b.text.indexOf('I remember'), end: b.text.length - 1, note: 'SYNTHETIC later memory, not a contemporary record.' });
  const seg = c.segments![0];
  const ec = await pinResearchExhibit(row.id, chat.id, { snapshotId: c.id, start: seg.start, end: seg.end, note: 'SYNTHETIC user formulation.' });
  const n1 = await createQuestionNode(project.id, ea.id);
  const n2 = await createQuestionNode(project.id, ec.id);
  await addRelation(project.id, { from: n1.id, to: n2.id, kind: 'refined', explanation: 'SYNTHETIC example judgment: the later wording adds comparison with other participants.', tentative: true });
  await saveResearchFinding(row.id, { title: 'SYNTHETIC unresolved interpretation', body: 'The wording differs. I have not established why; the later recollection may be incomplete.', support: [ea.id, ec.id], conflict: [eb.id] });
  return row;
}

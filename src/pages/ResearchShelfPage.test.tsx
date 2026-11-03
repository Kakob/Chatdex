import { beforeEach, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { clearAllData, createHumanProject, db } from '../lib/db';
import { importText, registerSource, unknownTime } from '../lib/research/service';
import { ResearchShelfPage } from './ResearchShelfPage';

beforeEach(async () => { await clearAllData(); });

it('imports pasted text only after confirmation and reads current and older versions without a case', async () => {
  const user = userEvent.setup();
  const project = await createHumanProject({ name: 'Synthetic research' });
  const source = await registerSource({ projectId: project.id, title: 'Synthetic document', kind: 'document', attribution: '', uri: '', notes: '', locator: '', authored: unknownTime(), eventTime: unknownTime() });
  const old = await importText(project.id, source.id, 'old.txt', 'Earlier exact wording.');
  render(<MemoryRouter initialEntries={[`/projects/${project.id}/research`]}><Routes><Route path="/projects/:id/research" element={<ResearchShelfPage />} /></Routes></MemoryRouter>);
  await screen.findByRole('heading', { name: source.title });
  await user.selectOptions(screen.getByRole('combobox', { name: 'Import into' }), source.id);
  await user.click(screen.getByText('Paste text instead (if file selection fails)'));
  fireEvent.change(screen.getByLabelText('Export filename'), { target: { value: 'new.txt' } });
  const text = '  Revised wording.\n\nLiteral <script>not executable</script> & attribution.\n';
  fireEvent.change(screen.getByLabelText('Document text'), { target: { value: text } });
  await user.click(screen.getByRole('button', { name: 'Preview pasted text' }));
  expect(await db.researchSnapshots.count()).toBe(1);
  await user.click(screen.getByRole('button', { name: 'Confirm local import' }));
  await screen.findByRole('status');
  await waitFor(() => expect(screen.getByText(/2 imported version/)).toBeInTheDocument());
  const saved = await db.researchSnapshots.where('sourceId').equals(source.id).toArray();
  expect(saved.find(v => v.filename === 'new.txt')?.text).toBe(text);
  expect(await db.researchSources.count()).toBe(1);
  expect(await db.investigationCases.count()).toBe(0);
  await user.click(screen.getByText('Read imported text'));
  expect(screen.getByLabelText('Imported document text').textContent).toBe(text);
  await user.selectOptions(screen.getByRole('combobox', { name: 'Stored version' }), old.id);
  expect(screen.getByLabelText('Imported document text').textContent).toBe(old.text);
});

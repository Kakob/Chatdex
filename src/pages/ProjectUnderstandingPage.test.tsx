import { beforeEach, expect, it } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { clearAllData } from '../lib/db';
import { ProjectUnderstandingPage } from './ProjectUnderstandingPage';

beforeEach(async () => { await clearAllData(); });

it('loads the unassigned bucket, whose route has no :id param, instead of spinning forever', async () => {
  const { container } = render(<MemoryRouter initialEntries={['/projects/unassigned']}><Routes><Route path="/projects/unassigned" element={<ProjectUnderstandingPage />} /></Routes></MemoryRouter>);
  await waitFor(() => expect(container.querySelector('.animate-spin')).toBeNull());
  expect(container.textContent).not.toBe('');
});

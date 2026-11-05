// Pins the sidebar the Understanding Landscape branch settled on, so a merge
// that brings back the old nav (Timeline, Analytics, Chat, …) fails here.
import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useAppStore } from '../../stores/appStore';
import { Sidebar } from './Sidebar';

describe('Sidebar', () => {
  beforeEach(() => {
    useAppStore.setState({ sidebarOpen: true });
  });

  it('shows exactly the landscape-era navigation, in order', () => {
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>
    );

    const nav = within(screen.getByRole('navigation'));
    const links = nav.getAllByRole('link').map((a) => [a.textContent, a.getAttribute('href')]);
    expect(links).toEqual([
      ['Projects', '/projects'],
      ['Landscape', '/landscape'],
      ['Sources', '/conversations'],
      ['Global search', '/search'],
      ['Import', '/import'],
    ]);
    expect(screen.getByRole('link', { name: 'Settings' }).getAttribute('href')).toBe('/settings');
  });
});

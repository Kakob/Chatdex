// Editable landscape acceptance (docs/changes/editable-landscape §Acceptance):
// the Atlas Maps hierarchy is built through the landscape UI alone — no
// conversation, import, or provider — persists across a remount, links the
// existing Tile licensing decision record without copying it, and is shared
// with the rest of Chatdex through ordinary understanding records.
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { useEffect } from 'react';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { clearAllData } from '../lib/db';
import { db } from '../lib/db/schema';
import { createHumanProject, createUnderstandingObject, setObjectReviewState, recordUnderstandingEvent } from '../lib/db/understanding';
import { loadProjectUnderstanding } from '../lib/understanding/currentUnderstanding';
import { createRegion, addConceptStatement } from '../lib/db/landscape';
import { LandscapePage } from './LandscapePage';

beforeAll(() => {
  // jsdom has no ResizeObserver; the map pane falls back to its default size.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

beforeEach(async () => {
  await clearAllData();
});
afterEach(cleanup);

const probe = { location: '' };
function LocationProbe() {
  const location = useLocation();
  useEffect(() => {
    probe.location = `${location.pathname}${location.search}`;
  }, [location]);
  return null;
}

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/landscape" element={<LandscapePage />} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>
  );
}

const user = () => userEvent.setup();

async function addConcepts(names: string[]) {
  const u = user();
  await u.click(await screen.findByRole('button', { name: /^\+ Add (concept|inside)/ }));
  const input = await screen.findByRole('textbox', { name: /^Add (concept|inside)/ });
  for (const name of names) {
    await u.type(input, `${name}{Enter}`);
    await screen.findByText(new RegExp(`added “${name}”`));
  }
  await u.type(input, '{Escape}');
}

async function enter(title: string) {
  await user().click(await screen.findByRole('link', { name: new RegExp(`^Explore ${title}:`) }));
  await screen.findByRole('link', { name: new RegExp(`Develop “${title}”`) });
}

async function crumb(label: string) {
  const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
  await user().click(within(nav).getByRole('link', { name: label }));
}

describe('editable landscape — Atlas Maps walkthrough', () => {
  it('builds, develops, links, and persists a hierarchy without any conversation', async () => {
    const atlas = await createHumanProject({ name: 'Atlas Maps' });
    // The existing record that must survive untouched.
    const licensing = await createUnderstandingObject({
      projectId: atlas.id,
      type: 'decision',
      title: 'Tile licensing decision',
      body: 'Satellite tiles are licensed for on-screen display only.',
      origin: 'ai',
      evidence: [{ conversationId: 'conv-licensing', messageIds: ['m-1'] }],
      occurredAt: new Date('2026-09-01T00:00:00Z'),
    });
    await setObjectReviewState(licensing.id, 'accepted');
    const licensingBefore = await db.understandingObjects.get(licensing.id);
    const licensingEventsBefore = await db.understandingEvents.where('objectId').equals(licensing.id).toArray();

    renderAt(`/landscape?project=${atlas.id}`);
    // The existing record sits in Uncategorized until it is placed.
    expect(await screen.findByRole('link', { name: /^Explore Uncategorized:/ })).toBeInTheDocument();
    await addConcepts(['Map', 'Route explorer', 'Data and research', 'Layout experiments']);

    await enter('Map');
    await addConcepts(['Map interactions', 'Map rendering', 'Keyboard shortcuts']);
    await enter('Map interactions');
    await addConcepts(['Box zoom', 'Distance ruler', 'Pan and reset']);
    await enter('Box zoom');
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' }).textContent).toBe('All projects/Atlas Maps/Map/Map interactions/Box zoom');

    // Develop it: description + intended behavior, keyboard only.
    const u = user();
    await u.click(screen.getByRole('link', { name: /Develop “Box zoom”/ }));
    const panel = await screen.findByRole('complementary');
    const description = within(panel).getByRole('textbox', { name: 'Description' });
    await u.type(description, 'Drag a box on the map to choose an area.');
    await u.keyboard('{Control>}{Enter}{/Control}');
    await within(panel).findByText('Saved');
    await u.click(within(panel).getByRole('button', { name: '+ Add intended behavior' }));
    await u.type(within(panel).getByRole('textbox', { name: 'Add intended behavior' }), 'Releasing the drag zooms to the selected area{Enter}');
    await within(panel).findByRole('link', { name: 'Releasing the drag zooms to the selected area' });
    expect(within(panel).getByText('Your statement · unverified')).toBeInTheDocument();
    const discuss = within(panel).getByRole('link', { name: 'Discuss with AI →' });
    const dragId = new URLSearchParams(probe.location.split('?')[1]).get('region')!;
    expect(discuss.getAttribute('href')).toBe(`/chat?project=${atlas.id}&concept=${dragId}`);

    // Back to the project; organize Data and research with the existing record.
    await crumb('Atlas Maps');
    await enter('Data and research');
    await addConcepts(['Normalization']);
    await u.click(screen.getByRole('link', { name: /Develop “Data and research”/ }));
    const dataPanel = await screen.findByRole('complementary');
    await u.type(within(dataPanel).getByRole('textbox', { name: 'Find existing understanding' }), 'licensing');
    await u.click(await within(dataPanel).findByRole('button', { name: 'Place here' }));
    await within(dataPanel).findByRole('link', { name: 'Tile licensing decision' });

    // Reparent via the move menu, then move it back (history records both).
    await crumb('Atlas Maps');
    await enter('Layout experiments');
    await u.click(screen.getByRole('link', { name: /Develop “Layout experiments”/ }));
    const tradePanel = await screen.findByRole('complementary');
    const move = within(tradePanel).getByRole('combobox', { name: 'Move Layout experiments into' });
    const dataOption = within(move).getByRole('option', { name: 'Inside Data and research' }) as HTMLOptionElement;
    await u.selectOptions(move, dataOption.value);
    await waitFor(() => expect(screen.getByRole('navigation', { name: 'Breadcrumb' }).textContent).toBe('All projects/Atlas Maps/Data and research/Layout experiments'));
    await u.selectOptions(within(await screen.findByRole('complementary')).getByRole('combobox', { name: 'Move Layout experiments into' }), '');
    await waitFor(() => expect(screen.getByRole('navigation', { name: 'Breadcrumb' }).textContent).toBe('All projects/Atlas Maps/Layout experiments'));

    // "Reload": remount from storage and return to Box zoom's panel.
    const dragHref = `/landscape?project=${atlas.id}&region=${dragId}&panel=concept`;
    cleanup();
    renderAt(dragHref);
    const reloaded = await screen.findByRole('complementary');
    expect(within(reloaded).getByRole('textbox', { name: 'Description' })).toHaveValue('Drag a box on the map to choose an area.');
    expect(within(reloaded).getByRole('link', { name: 'Releasing the drag zooms to the selected area' })).toBeInTheDocument();
    expect(within(reloaded).getByText(/Created as “Box zoom”/)).toBeInTheDocument();
    expect(within(reloaded).getByText(/Description written/)).toBeInTheDocument();

    // Stored structure matches the Atlas Maps tree.
    const regions = await db.landscapeRegions.where('projectId').equals(atlas.id).toArray();
    const byId = new Map(regions.map((r) => [r.id, r]));
    const tree = (parent: string | null): unknown[] =>
      regions
        .filter((r) => r.parentRegionId === parent)
        .sort((a, b) => a.order - b.order)
        .map((r) => (regions.some((c) => c.parentRegionId === r.id) ? { [r.title]: tree(r.id) } : r.title));
    expect(tree(null)).toEqual([
      { Map: [{ 'Map interactions': ['Box zoom', 'Distance ruler', 'Pan and reset'] }, 'Map rendering', 'Keyboard shortcuts'] },
      'Route explorer',
      { 'Data and research': ['Normalization'] },
      'Layout experiments',
    ]);
    const data = regions.find((r) => r.title === 'Data and research')!;
    expect(data.memberObjectIds).toEqual([licensing.id]);
    expect(byId.get(regions.find((r) => r.title === 'Layout experiments')!.id)!.revisions!.filter((r) => r.field === 'parent')).toHaveLength(2);

    // The existing record is intact and not duplicated; no conversations were needed.
    expect(await db.understandingObjects.get(licensing.id)).toEqual(licensingBefore);
    expect(await db.understandingEvents.where('objectId').equals(licensing.id).toArray()).toEqual(licensingEventsBefore);
    expect((await db.understandingObjects.toArray()).filter((o) => o.title === 'Tile licensing decision')).toHaveLength(1);
    expect(await db.conversations.count()).toBe(0);

    // Shared records: the new statement is part of Current Understanding too.
    const current = await loadProjectUnderstanding(atlas.id);
    const titles = current!.understanding.ideasAndDecisions.map((i) => i.object.title);
    expect(titles).toContain('Releasing the drag zooms to the selected area');
    expect(titles).toContain('Tile licensing decision');
  }, 30_000);

  it('Escape cancels an inline add without creating anything', async () => {
    const p = await createHumanProject({ name: 'Atlas Maps' });
    renderAt(`/landscape?project=${p.id}`);
    expect(await screen.findByText('Start with a concept')).toBeInTheDocument();
    const u = user();
    await u.click(await screen.findByRole('button', { name: '+ Add concept' }));
    await u.type(screen.getByRole('textbox', { name: 'Add concept' }), 'Half-typed{Escape}');
    expect(screen.queryByRole('textbox', { name: 'Add concept' })).toBeNull();
    expect(screen.getByRole('button', { name: '+ Add concept' })).toHaveFocus();
    expect(await db.landscapeRegions.count()).toBe(0);
  });
});


describe('concept revision review history', () => {
  it('shows the original AI wording alongside the edited accepted revision after remount', async () => {
    const p = await createHumanProject({ name: 'Precedent' });
    const zoom = await createRegion({ projectId: p.id, title: 'Box zoom' });
    const statement = await addConceptStatement(zoom.id, { type: 'behavior', title: 'Drag zooms', body: 'Original details' });
    await recordUnderstandingEvent({
      objectId: statement.id, op: 'refined', origin: 'ai', occurredAt: new Date(),
      evidence: [{ conversationId: 'discussion', messageIds: ['m1'] }],
      revision: { title: 'AI zoom wording', body: 'AI proposed details', previousTitle: statement.title, previousBody: statement.body },
    });
    renderAt(`/landscape?project=${p.id}&region=${zoom.id}&panel=concept`);
    const panel = await screen.findByRole('complementary');
    const u = user();
    await u.click(within(panel).getByRole('button', { name: 'Edit & accept' }));
    const title = within(panel).getByRole('textbox', { name: 'Proposed statement' });
    await u.clear(title);
    await u.type(title, 'User approved zoom wording');
    const body = within(panel).getByRole('textbox', { name: 'Proposed details' });
    await u.clear(body);
    await u.type(body, 'User approved details');
    await u.click(within(panel).getByRole('button', { name: 'Accept with edits' }));
    await within(panel).findByRole('link', { name: 'User approved zoom wording' });
    cleanup();
    renderAt(`/landscape?project=${p.id}&region=${zoom.id}&finding=${statement.id}`);
    const inspector = await screen.findByRole('complementary');
    await u.click(within(inspector).getByText('Original proposal before your edits'));
    expect(within(inspector).getByText('“Drag zooms” → “AI zoom wording”')).toBeVisible();
    expect(within(inspector).getByText('Previous details: Original details')).toBeVisible();
    expect(within(inspector).getByText('Proposed details: AI proposed details')).toBeVisible();
    expect(inspector.textContent).toContain('User approved zoom wording');
    expect(inspector.textContent).toContain('User approved details');
    expect(within(inspector).getAllByRole('link').some((a) => a.getAttribute('href')?.includes('source=discussion'))).toBe(true);
  });
});

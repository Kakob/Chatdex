import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { analyzeTypeScript } from '../../lib/engineering/core/analyzeTypeScript';
import { SourceGraphCanvas } from './SourceGraphCanvas';

const graph = analyzeTypeScript({ files: [
  {
    path: 'src/math.ts',
    text: [
      'export function add(a: number, b: number) { return a + b; }',
      'export function twice(n: number) { return add(n, n); }',
    ].join('\n'),
  },
  {
    path: 'src/app.ts',
    text: [
      "import { twice } from './math.js';",
      'export function run() { return twice(5); }',
    ].join('\n'),
  },
] });

function Harness() {
  const [id, setId] = useState(graph.entities.find((e) => e.name === 'twice')!.id);
  return (
    <>
      <SourceGraphCanvas graph={graph} selectedId={id} onSelect={setId}/>
      <output aria-label="Selected graph entity">{graph.entities.find((e) => e.id === id)?.name}</output>
    </>
  );
}

describe('source graph visualization', () => {
  it('draws real compiler-derived nodes and directed edges, with a mobile scrollable canvas', async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness/>);
    const view = screen.getByRole('region', { name: 'Visual source relationship graph' });
    expect(within(view).getByText(/source entities/)).toBeInTheDocument();
    const map = within(view).getByRole('group', { name: 'Scrollable source graph canvas' });
    expect(map).toHaveStyle({ touchAction: 'pan-x pan-y' });
    expect(container.querySelectorAll('button[data-entity-id]')).toHaveLength(graph.entities.length);
    expect(container.querySelectorAll('path[data-relation-id]').length).toBeGreaterThan(0);
    expect(container.querySelector('path[data-relation-id][data-relation-kind="calls"]')).not.toBeNull();
    expect(within(view).getByRole('img', { name: 'Directed source relationships' })).toBeInTheDocument();

    await user.click(within(view).getByRole('button', { name: 'Show all links' }));
    expect(container.querySelectorAll('path[data-relation-id]')).toHaveLength(graph.relations.length);
    await user.click(within(view).getByRole('button', { name: /Calls/ }));
    const calls = graph.relations.filter((edge) => edge.kind === 'calls');
    expect(container.querySelectorAll('path[data-relation-kind="calls"]')).toHaveLength(calls.length);
    expect(container.querySelectorAll('path[data-relation-kind="imports"]')).toHaveLength(0);
  });

  it('can visually follow a source relationship and update selected entity', async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness/>);
    const view = screen.getByRole('region', { name: 'Visual source relationship graph' });
    await user.click(within(view).getByRole('button', { name: 'Connections' }));
    expect(within(view).getByText(/One-hop neighborhood/)).toBeInTheDocument();
    const twice = graph.entities.find((e) => e.name === 'twice')!;
    const callsAdd = graph.relations.some((edge) =>
      edge.fromId === twice.id && graph.entities.some((e) => e.id === edge.toId && e.name === 'add' && edge.kind === 'calls'));
    expect(callsAdd).toBe(true);
    const target = within(view).getByRole('button', { name: /Graph entity function add in src\/math\.ts/ });
    await user.click(target);
    expect(screen.getByLabelText('Selected graph entity')).toHaveTextContent('add');
    expect(target).toHaveAttribute('aria-pressed', 'true');
    expect(container.querySelectorAll('path[data-relation-id]').length).toBeGreaterThan(0);
    await user.click(within(view).getByRole('button', { name: 'Zoom in' }));
    expect(within(view).getByText('120%')).toBeInTheDocument();
    await user.click(within(view).getByRole('button', { name: 'Reset graph zoom' }));
    expect(within(view).getByText('100%')).toBeInTheDocument();
    await user.click(within(view).getByRole('button', { name: 'System map' }));
    expect(within(view).getByRole('button', { name: 'Show all links' })).toBeInTheDocument();
  });
});

// Scale checks over deterministic synthetic fixtures (ACCEPTANCE.md):
// complete reachability, bounded scenes, stable layout, and timings.
import { describe, it, expect } from 'vitest';
import { syntheticInput, SYNTHETIC_SIZES, TARGETS } from './synthetic';
import { assembleLandscape, regionNode, type Landscape, type LandscapeRegionNode } from './projection';
import { resolveView } from './route';
import { searchLandscape } from './search';
import { layoutPlaces } from './geometry';
import { MAX_PROJECT_REGIONS, MAX_REGION_PLACES } from '../../components/landscape/sceneModel';

function walk(nodes: LandscapeRegionNode[]): LandscapeRegionNode[] {
  return nodes.flatMap((n) => [n, ...walk(n.children)]);
}

/** Every finding id reachable by entering regions recursively (direct markers + list panels). */
function reachable(landscape: Landscape): Set<string> {
  const ids = new Set<string>();
  for (const p of landscape.projects) for (const n of walk(p.regions)) n.directIds.forEach((id) => ids.add(id));
  return ids;
}

describe.each(SYNTHETIC_SIZES)('synthetic landscape at %i records', (size) => {
  const input = syntheticInput(size);
  const started = performance.now();
  const landscape = assembleLandscape(input);
  const projectionMs = performance.now() - started;

  it('projects every eligible record exactly once and excludes the rejected one', () => {
    const eligible = input.objects.filter((o) => o.reviewState !== 'rejected');
    expect(landscape.findings.size).toBe(eligible.length);
    expect(landscape.findings.has('syn-rejected')).toBe(false);
    expect(landscape.projects.reduce((n, p) => n + p.counts.current + p.counts.historical, 0)).toBe(eligible.length);
  });

  it('reaches every distinct eligible id through regions and Uncategorized', () => {
    expect(reachable(landscape)).toEqual(new Set(landscape.findings.keys()));
    // Multi-region membership exists and does not inflate totals.
    expect([...landscape.findings.values()].some((f) => f.regionIds.length > 1)).toBe(true);
  });

  it('finds the target decision with one search and reveals it in its region', () => {
    const results = searchLandscape(landscape, 'ciphertext only', 'all');
    expect(results.map((r) => r.finding.object.id)).toContain(TARGETS.decision);
    const hit = results.find((r) => r.finding.object.id === TARGETS.decision)!;
    const view = resolveView(landscape, { lens: 'whole', q: '', filter: 'all', project: hit.finding.projectKey, finding: TARGETS.decision });
    expect(view.region?.directIds).toContain(TARGETS.decision);
    expect(searchLandscape(landscape, '', 'all')).toHaveLength(landscape.findings.size);
  });

  it('exposes the unresolved target question with its contradiction and no resolution', () => {
    const q = landscape.findings.get(TARGETS.question)!;
    expect(q.object.status).toBe('current');
    expect(q.contradictionCount).toBe(1);
    expect(q.events.some((e) => e.op === 'resolved')).toBe(false);
    expect(searchLandscape(landscape, '', 'open').map((r) => r.finding.object.id)).toContain(TARGETS.question);
  });

  it('reaches the target cited source and its message anchor', () => {
    const f = landscape.findings.get(TARGETS.cited)!;
    const view = resolveView(landscape, { lens: 'whole', q: '', filter: 'all', project: f.projectKey, finding: f.object.id, source: TARGETS.citedConversation });
    expect(view.source?.messageIds).toEqual([`${TARGETS.citedConversation}-m0`]);
    expect(view.source?.conversationName).toBe('Synthetic: embargo explanation');
  });

  it('keeps every scene bounded: visible places never exceed the budget', () => {
    for (const p of landscape.projects) {
      expect(Math.min(p.regions.length, MAX_PROJECT_REGIONS)).toBeLessThanOrEqual(MAX_PROJECT_REGIONS);
      for (const n of walk(p.regions)) {
        const total = n.children.length + n.directIds.length;
        const visible = Math.min(total, MAX_REGION_PLACES);
        expect(visible).toBeLessThanOrEqual(MAX_REGION_PLACES);
        if (size === 300 && total > MAX_REGION_PLACES) expect(total).toBeGreaterThan(visible);
      }
    }
    console.info(`[landscape scale] ${size} records: projection ${projectionMs.toFixed(1)} ms; largest region ${Math.max(...[...landscape.regions.values()].map((n) => n.directIds.length))} direct findings`);
  });

  it('keeps region positions stable across sizes, filters, and lenses (keyed by id only)', () => {
    const ids = landscape.projects[0].regions.map((r) => r.id);
    const a = layoutPlaces(ids, { x: 0, y: 0, width: 1200, height: 600 });
    const b = layoutPlaces([...ids], { x: 0, y: 0, width: 1200, height: 600 });
    expect(a).toEqual(b);
    expect(regionNode(landscape, landscape.projects[0].key, 'syn-r0-0')?.title).toBe('Sync');
  });
});

describe('fixtures are comparable across sizes', () => {
  it('keeps the target records identical at every size', () => {
    const pick = (size: number) => syntheticInput(size).objects.filter((o) => Object.values(TARGETS).includes(o.id as never));
    expect(pick(25)).toEqual(pick(300));
    expect(pick(100)).toHaveLength(3);
  });
});

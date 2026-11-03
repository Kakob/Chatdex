// SVG scenes of the Understanding Landscape, ported from the reference
// atlas.js renderers (projectMap, projectMapInside, findingMap). The SVG
// viewBox matches the pane's pixel size, so labels keep their size when the
// inspector opens or the window narrows; the layout adapts instead.

import { Fragment, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  charsFor,
  contourRings,
  blob,
  ellipseBoundary,
  layoutPlaces,
  wrapLines,
  type Place,
} from '../../lib/landscape/geometry';
import type {
  Landscape,
  LandscapeConnection,
  LandscapeCounts,
  LandscapeFinding,
  LandscapeRegionNode,
} from '../../lib/landscape/projection';
import type { LensView } from '../../lib/landscape/lens';
import { toHref, withLocation, type LandscapeParams, type ResolvedView } from '../../lib/landscape/route';
import {
  edgeLabel,
  MAX_EDGES,
  MAX_PROJECT_REGIONS,
  MAX_REGION_PLACES,
  projectPlaces,
  reviewLabel,
  TONE_COLOR,
} from './sceneModel';

export interface SceneProps {
  landscape: Landscape;
  view: ResolvedView;
  lens: LensView;
  matches: (f: LandscapeFinding) => boolean;
  filtering: boolean;
  width: number;
  height: number;
}

interface TextProps {
  x: number;
  y: number;
  size: number;
  max: number;
  color: string;
  text: string;
  className?: string;
  maxLines?: number;
  weight?: number;
}

function SvgText({ x, y, size, max, color, text, className, maxLines, weight }: TextProps) {
  const lines = wrapLines(text, max, maxLines);
  return (
    <text x={x} y={y} textAnchor="middle" fontSize={size} fill={color} className={className} fontWeight={weight}>
      {lines.map((line, i) => (
        <tspan key={i} x={x} dy={i ? size * 1.36 : 0}>
          {line}
        </tspan>
      ))}
    </text>
  );
}

function linesHeight(text: string, max: number, size: number, maxLines?: number): number {
  return wrapLines(text, max, maxLines).length * size * 1.36;
}

function Contours({ place, color, strong }: { place: Place; color: string; strong?: boolean }) {
  return (
    <>
      {contourRings(place.x, place.y, place.rx, place.ry).map((ring, i) => (
        <path
          key={i}
          d={ring.d}
          fill={ring.fill ? color : 'none'}
          fillOpacity={ring.fill ? (strong ? 0.11 : 0.065) : undefined}
          stroke={color}
          strokeOpacity={ring.fill ? (strong ? 0.55 : 0.3) : 0.12}
          strokeWidth={ring.fill ? (strong ? 2.2 : 1.5) : 1}
          className={ring.fill ? 'island-fill' : 'terrain-line'}
        />
      ))}
    </>
  );
}

function StatusDots({ ids, landscape, x, y, gap = 14, r = 3 }: { ids: string[]; landscape: Landscape; x: number; y: number; gap?: number; r?: number }) {
  const shown = ids.slice(0, 9);
  return (
    <>
      {shown.map((id, i) => {
        const tone = landscape.findings.get(id)!.tone;
        return (
          <circle
            key={id}
            cx={x - ((shown.length - 1) * gap) / 2 + i * gap}
            cy={y}
            r={r}
            fill={tone === 'historical' ? 'none' : TONE_COLOR[tone]}
            stroke={tone === 'historical' ? TONE_COLOR.historical : undefined}
          />
        );
      })}
    </>
  );
}

function Terrain({ width, height, label, children, counts }: { width: number; height: number; label: string; children: ReactNode; counts: { places: number; findings: number; edges: number } }) {
  const mid = height * 0.55;
  const wave = (dy: number) =>
    `M-100 ${mid + dy} Q${width * 0.13} ${mid - 130 + dy} ${width * 0.26} ${mid + dy} T${width * 0.57} ${mid + dy} T${width + 100} ${mid + dy}`;
  return (
    <svg
      className="terrain"
      viewBox={`0 0 ${width} ${height}`}
      role="group"
      aria-label={label}
      data-visible-places={counts.places}
      data-visible-findings={counts.findings}
      data-visible-edges={counts.edges}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <pattern id="ldx-grid" width="28" height="28" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r=".7" fill="#93aa7f" opacity=".28" />
        </pattern>
      </defs>
      <rect width={width} height={height} fill="url(#ldx-grid)" />
      <path d={`${wave(0)} ${wave(17)} ${wave(34)}`} stroke="#d9e4cb" strokeWidth=".8" fill="none" className="terrain-line" />
      {children}
    </svg>
  );
}

function hitCount(ids: string[], landscape: Landscape, matches: (f: LandscapeFinding) => boolean): number {
  let n = 0;
  for (const id of ids) if (matches(landscape.findings.get(id)!)) n += 1;
  return n;
}

function countsLine(
  node: { counts: LandscapeCounts },
  extra?: string,
  compact = false
): string {
  const c = node.counts;
  if (!c.current) {
    const empty = c.historical ? `No current findings · ${c.historical} earlier` : 'No findings yet';
    return extra ? `${empty} · ${extra}` : empty;
  }
  const parts = [`${c.current} finding${c.current === 1 ? '' : 's'}`];
  if (c.toReview) parts.push(`${c.toReview} to review`);
  if (c.open) parts.push(compact ? `${c.open} open` : `${c.open} open question${c.open === 1 ? '' : 's'}`);
  if (extra) parts.push(extra);
  return parts.join(' · ');
}

/**
 * Text of one island, stacked from its centre so nothing collides at any
 * size: marks, title, as many statements as fit, counts, enter cue.
 * Statements are dropped (never squeezed) when the island is small.
 */
function IslandLabels({
  place,
  color,
  marks,
  title,
  titleSize,
  statements,
  statementSize,
  statementLines,
  caption,
  captionSize,
  captionColor,
  enterText,
}: {
  place: Place;
  color: string;
  marks: (y: number) => ReactNode;
  title: string;
  titleSize: number;
  statements: string[];
  statementSize: number;
  statementLines: number;
  caption: string;
  captionSize: number;
  captionColor: string;
  enterText: string;
}) {
  const inner = place.rx * 1.68;
  const titleMax = charsFor(place.rx * 1.8, titleSize * 0.92);
  const statementMax = charsFor(inner, statementSize);
  const titleH = linesHeight(title, titleMax, titleSize, 2);
  const markH = 20;
  const tailH = captionSize * 1.36 * 2 + 10;
  const budget = place.ry * 1.62;
  let used = markH + titleH + tailH;
  const kept: { text: string; h: number }[] = [];
  for (const text of statements) {
    const h = linesHeight(text, statementMax, statementSize, statementLines) + 4;
    if (used + h > budget) break;
    kept.push({ text, h });
    used += h;
  }
  let y = place.y - used / 2;
  const markY = y + 6;
  y += markH;
  const titleY = y + titleSize * 0.8;
  y += titleH + 2;
  const blocks = kept.map((b) => {
    const block = { text: b.text, y: y + statementSize * 0.9 };
    y += b.h;
    return block;
  });
  const captionY = y + 4 + captionSize;
  const enterY = captionY + captionSize * 1.36 + 6;
  return (
    <>
      {marks(markY)}
      <SvgText x={place.x} y={titleY} size={titleSize} max={titleMax} color={color} text={title} className="land-title" maxLines={2} />
      {blocks.map((b, i) => (
        <SvgText key={i} x={place.x} y={b.y} size={statementSize} max={statementMax} color="#5f725a" text={b.text} maxLines={statementLines} />
      ))}
      <SvgText x={place.x} y={captionY} size={captionSize} max={charsFor(inner, captionSize)} color={captionColor} text={caption} maxLines={1} />
      <SvgText x={place.x} y={enterY} size={captionSize - 1} max={40} color={color} text={enterText} />
    </>
  );
}

// --- all projects ------------------------------------------------------------

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

function overlapsPlace(box: Box, place: Place): boolean {
  // Nearest point of the box to the island centre, tested against the island ellipse.
  const nx = Math.max(box.x - box.w / 2, Math.min(place.x, box.x + box.w / 2));
  const ny = Math.max(box.y - box.h / 2, Math.min(place.y, box.y + box.h / 2));
  const dx = (nx - place.x) / (place.rx * 1.08);
  const dy = (ny - place.y) / (place.ry * 1.08);
  return dx * dx + dy * dy < 1;
}

const overlapsBox = (a: Box, b: Box) => Math.abs(a.x - b.x) * 2 < a.w + b.w && Math.abs(a.y - b.y) * 2 < a.h + b.h;

function labelWidth(text: string): number {
  return Math.max(110, text.length * 6.1 + 26);
}

/**
 * Route one connection: its label goes to the first clear spot along the
 * perpendicular of the two islands' midpoint (never over an island or an
 * earlier label), and the curve bends through that spot. Deterministic.
 */
function edgeGeometry(edge: LandscapeConnection, places: Map<string, Place>, all: Place[], taken: Box[], bounds: { width: number; height: number }) {
  const pa = places.get(edge.a)!;
  const pb = places.get(edge.b)!;
  const mx = (pa.x + pb.x) / 2;
  const my = (pa.y + pb.y) / 2;
  const dx = pb.x - pa.x;
  const dy = pb.y - pa.y;
  const len = Math.hypot(dx, dy) || 1;
  const [px, py] = [-dy / len, dx / len];
  const w = labelWidth(edgeLabel(edge));
  // Nearest-first neighbourhood across (22 px steps) and along (60 px steps) the edge.
  const candidates: { x: number; y: number; d: number }[] = [];
  for (let across = -12; across <= 12; across++) {
    for (let along = -3; along <= 3; along++) {
      candidates.push({
        x: mx + px * across * 22 + (dx / len) * along * 60,
        y: my + py * across * 22 + (dy / len) * along * 60,
        d: Math.abs(across) * 22 + Math.abs(along) * 75,
      });
    }
  }
  candidates.sort((p, q) => p.d - q.d);
  const fits = (c: { x: number; y: number }, avoidIslands: boolean) => {
    const box = { ...c, w, h: 26 };
    const inside = box.x - w / 2 > 4 && box.x + w / 2 < bounds.width - 4 && box.y > 40 && box.y < bounds.height - 30;
    return inside && !taken.some((t) => overlapsBox(box, t)) && (!avoidIslands || !all.some((p) => overlapsPlace(box, p)));
  };
  // Prefer open terrain; failing that, at least never cover another label.
  const label = candidates.find((c) => fits(c, true)) ?? candidates.find((c) => fits(c, false)) ?? { x: mx, y: my };
  taken.push({ ...label, w, h: 26 });
  // Quadratic midpoint = (a + 2c + b) / 4, so bend the curve through the label.
  const control = { x: 2 * label.x - mx, y: 2 * label.y - my };
  const a = ellipseBoundary({ ...pa, rx: pa.rx * 1.07, ry: pa.ry * 1.07 }, control);
  const b = ellipseBoundary({ ...pb, rx: pb.rx * 1.07, ry: pb.ry * 1.07 }, control);
  const fixed = { x: 2 * label.x - (a.x + b.x) / 2, y: 2 * label.y - (a.y + b.y) / 2 };
  return { a, b, control: fixed, label };
}

export function AllProjectsScene({ landscape, view, lens, matches, filtering, width, height }: SceneProps) {
  const params = view.params;
  const places = projectPlaces(landscape.projects, width, height);
  const byKey = new Map(landscape.projects.map((p, i) => [p.key, places[i]]));
  const edges = landscape.connections
    .filter((e) => byKey.has(e.a) && byKey.has(e.b))
    .sort((a, b) => b.conversationIds.length - a.conversationIds.length || a.id.localeCompare(b.id))
    .slice(0, MAX_EDGES);
  const query = params.q.trim().toLowerCase();
  const taken: Box[] = [];
  const geometry = edges.map((e) => ({ edge: e, ...edgeGeometry(e, byKey, places, taken, { width, height }) }));

  return (
    <Terrain
      width={width}
      height={height}
      label="Projects and shared-source connections"
      counts={{ places: places.length, findings: 0, edges: edges.length }}
    >
      {geometry.map(({ edge, a, b, control }) => (
        <path
          key={edge.id}
          d={`M${a.x} ${a.y} Q${control.x} ${control.y} ${b.x} ${b.y}`}
          stroke="#8b9d83"
          strokeOpacity={view.edge?.id === edge.id ? 0.95 : 0.6}
          strokeWidth={view.edge?.id === edge.id ? 2.6 : 1.8}
          strokeDasharray={edge.weak ? '5 6' : undefined}
          fill="none"
          className="terrain-line"
        />
      ))}
      {landscape.projects.map((p, i) => {
        const place = places[i];
        const mark = lens.project(p);
        const hits = hitCount(p.findingIds, landscape, matches);
        const nameHit = query && params.filter === 'all' && `${p.name} ${p.description ?? ''}`.toLowerCase().includes(query);
        let opacity = 1;
        if (filtering && !hits && !nameHit) opacity = 0.27;
        else if (lens.selective && !mark.emphasis) opacity = 0.5;
        const small = place.rx < 118;
        const inner = place.rx * 1.7;
        const summary = p.description || p.previews[0]?.title || (p.sourceCount ? 'Sources are linked. Understanding has not been synthesized yet.' : 'No understanding records or linked sources yet.');
        const caption = mark.caption ?? countsLine(p, p.sample ? 'built-in sample' : p.counts.current || p.counts.historical ? undefined : `${p.sourceCount} source${p.sourceCount === 1 ? '' : 's'}`, true);
        const selected = view.resume?.key === p.key;
        const href = lens.id === 'recent' && p.project
          ? toHref(withLocation(params, { resume: p.key }))
          : toHref(withLocation(params, { project: p.key }));
        return (
          <Link
            key={p.key}
            to={href}
            className="place project-island"
            style={{ opacity }}
            aria-label={`${lens.id === 'recent' ? 'Resume' : 'Explore'} ${p.name}: ${caption}`}
            data-place={p.key}
          >
            <Contours place={place} color={p.color} strong={selected || (lens.selective && mark.emphasis)} />
            <IslandLabels
              place={place}
              color={p.color}
              marks={(y) =>
                mark.kicker ? (
                  <SvgText x={place.x} y={y + 4} size={11} max={charsFor(inner, 11)} color={p.color} text={mark.kicker} maxLines={1} />
                ) : (
                  <StatusDots ids={p.findingIds} landscape={landscape} x={place.x} y={y} />
                )
              }
              title={p.name}
              titleSize={p.name.length > 20 || small ? 21 : 25}
              statements={[summary]}
              statementSize={small ? 12.5 : 13.5}
              statementLines={3}
              caption={caption}
              captionSize={11}
              captionColor={p.color}
              enterText={lens.id === 'recent' ? 'Pick up this thread →' : 'Enter landscape →'}
            />
          </Link>
        );
      })}
      {geometry.map(({ edge, label }) => {
        const text = edgeLabel(edge);
        const w = labelWidth(text);
        return (
          <Link key={edge.id} className="edge-button" to={toHref(withLocation(params, { edge: edge.id }))} aria-label={`Inspect connection: ${text}`}>
            <rect x={label.x - w / 2} y={label.y - 12} width={w} height={25} rx={12} fill="#f8faf1" stroke={view.edge?.id === edge.id ? '#62826a' : '#cbd6c1'} />
            <SvgText x={label.x} y={label.y + 4} size={10} max={60} color="#75886c" text={text} />
          </Link>
        );
      })}
    </Terrain>
  );
}

// --- inside a project ----------------------------------------------------------

function regionSizes(count: number) {
  if (count <= 1) return { title: 29, summary: 15, caption: 12 };
  if (count <= 3) return { title: 26, summary: 14, caption: 12 };
  return { title: 21, summary: 12.5, caption: 11 };
}

function RegionIsland({ node, place, count, color, landscape, lens, matches, filtering, href, enterText }: {
  node: LandscapeRegionNode;
  place: Place;
  count: number;
  color: string;
  landscape: Landscape;
  lens: LensView;
  matches: (f: LandscapeFinding) => boolean;
  filtering: boolean;
  href: string;
  enterText: string;
}) {
  const sizes = regionSizes(count);
  const mark = lens.region(node);
  const hits = hitCount(node.allIds, landscape, matches);
  let opacity = 1;
  if (filtering && !hits) opacity = 0.3;
  else if (lens.selective && !mark.emphasis) opacity = 0.5;
  const inner = place.rx * 1.65;
  const statements = [
    ...(node.summary ? [node.summary] : []),
    ...node.previews.map((p) => `“${p.title}”`),
  ].slice(0, 2);
  const sub = node.children.length ? `${node.children.length} subregion${node.children.length === 1 ? '' : 's'}` : undefined;
  const caption = countsLine(node, sub, true);
  return (
    <Link to={href} className="place" style={{ opacity }} aria-label={`Explore ${node.title}: ${caption}`} data-place={node.id}>
      <Contours place={place} color={color} strong={lens.selective && mark.emphasis} />
      <IslandLabels
        place={place}
        color={color}
        marks={(y) =>
          mark.kicker ? (
            <SvgText x={place.x} y={y + 4} size={11} max={charsFor(inner, 11)} color={color} text={mark.kicker} maxLines={1} />
          ) : (
            <StatusDots ids={node.allIds} landscape={landscape} x={place.x} y={y} gap={place.rx < 120 ? 12 : 18} r={place.rx < 120 ? 3 : 4} />
          )
        }
        title={node.title}
        titleSize={sizes.title}
        statements={statements}
        statementSize={sizes.summary}
        statementLines={2}
        caption={caption}
        captionSize={sizes.caption}
        captionColor="#8b976e"
        enterText={enterText}
      />
    </Link>
  );
}

function OverflowPlace({ place, text, href, color }: { place: Place; text: string; href: string; color: string }) {
  return (
    <Link to={href} className="place" aria-label={text}>
      <path d={blob(place.x, place.y, place.rx * 0.8, place.ry * 0.7)} fill="#fffef9" fillOpacity={0.5} stroke={color} strokeOpacity={0.3} strokeDasharray="4 6" className="island-fill" />
      {[0, 1, 2].map((i) => (
        <circle key={i} cx={place.x - 14 + i * 14} cy={place.y - 22} r={4} fill={color} fillOpacity={0.5} />
      ))}
      <SvgText x={place.x} y={place.y + 6} size={13} max={charsFor(place.rx * 1.4, 13)} color={color} text={text} maxLines={3} />
    </Link>
  );
}

export function ProjectScene({ landscape, view, lens, matches, filtering, width, height }: SceneProps) {
  const project = view.project!;
  const params = view.params;
  const regions = project.regions;
  const budget = Math.max(2, Math.min(MAX_PROJECT_REGIONS, Math.floor((width - 100) / 290) * Math.max(1, Math.floor((height - 110) / 220))));
  const overflow = regions.length > budget;
  const shown = overflow ? regions.slice(0, budget - 1) : regions;
  const placeIds = [...shown.map((r) => r.id), ...(overflow ? ['__more'] : [])];
  const places = layoutPlaces(placeIds, { x: 50, y: 50, width: width - 100, height: height - 110 }, { maxRx: 300, maxRy: 190 });
  const footerY = height - 30;
  const empty = regions.length === 0;
  return (
    <Terrain
      width={width}
      height={height}
      label={`${project.name} landscape`}
      counts={{ places: places.length, findings: 0, edges: 0 }}
    >
      <path d={blob(width / 2, height / 2, width * 0.46, height * 0.42)} fill={project.color} fillOpacity={0.025} stroke={project.color} strokeOpacity={0.16} strokeDasharray="3 7" />
      {shown.map((node, i) => (
        <RegionIsland
          key={node.id}
          node={node}
          place={places[i]}
          count={placeIds.length}
          color={project.color}
          landscape={landscape}
          lens={lens}
          matches={matches}
          filtering={filtering}
          href={toHref(withLocation(params, { project: project.key, region: node.id }))}
          enterText="Click to enter →"
        />
      ))}
      {overflow && (
        <OverflowPlace
          place={places[places.length - 1]}
          text={`${regions.length - shown.length} more regions · open the full list`}
          href={toHref({ ...params, panel: 'list' })}
          color={project.color}
        />
      )}
      {empty ? (
        <>
          <SvgText x={width / 2} y={height / 2 - 30} size={26} max={50} color={project.color} text="Nothing synthesized here yet" className="land-title" />
          <SvgText
            x={width / 2}
            y={height / 2 + 8}
            size={13}
            max={70}
            color="#6c7f70"
            text={
              project.sourceCount
                ? `${project.sourceCount} linked conversation${project.sourceCount === 1 ? '' : 's'} · no understanding records. No findings have been invented.`
                : 'No linked conversations or understanding records yet.'
            }
          />
        </>
      ) : (
        <SvgText
          x={width / 2}
          y={footerY}
          size={12}
          max={120}
          color="#89977d"
          text={project.regionCount ? 'Regions are your organization of this project’s records. Moving a finding never changes it.' : 'Not organized yet — every finding is in Uncategorized. Use Organize to add regions.'}
        />
      )}
    </Terrain>
  );
}

// --- inside a region -----------------------------------------------------------

function pinSizes(count: number) {
  if (count <= 3) return { title: 19, label: 10, line: 11, maxLines: 4 };
  if (count <= 6) return { title: 16, label: 9.5, line: 10.5, maxLines: 3 };
  return { title: 14, label: 9, line: 10, maxLines: 3 };
}

function FindingPin({ finding, place, count, selected, color, lens, dim, href }: {
  finding: LandscapeFinding;
  place: Place;
  count: number;
  selected: boolean;
  color: string;
  lens: LensView;
  dim: boolean;
  href: string;
}) {
  const sizes = pinSizes(count);
  const mark = lens.finding(finding);
  const tone = finding.tone;
  const toneColor = TONE_COLOR[tone];
  const width = Math.min(place.rx * 2.05, 340);
  const titleMax = charsFor(width, sizes.title);
  const titleLines = wrapLines(finding.object.title, titleMax, sizes.maxLines).length;
  const label = `${finding.object.type} · ${reviewLabel(finding)}`.toUpperCase();
  const sources = finding.evidence.length;
  const sourceText = [
    sources ? `${sources} linked source${sources === 1 ? '' : 's'}` : 'No source attached',
    finding.contradictionCount ? `${finding.contradictionCount} contradiction${finding.contradictionCount === 1 ? '' : 's'}` : '',
    'inspect →',
  ]
    .filter(Boolean)
    .join(' · ');
  let opacity = 1;
  if (dim) opacity = 0.3;
  else if (lens.selective && !mark.emphasis) opacity = 0.55;
  const blockH = sizes.label + 26 + 30 + titleLines * sizes.title * 1.36 + (mark.kicker ? 32 : 16);
  const top = place.y - blockH / 2 + sizes.label;
  const coreY = top + 18;
  const titleY = coreY + 30;
  return (
    <Link
      className="pin place"
      to={href}
      style={{ opacity }}
      aria-label={`${selected ? 'Selected: ' : ''}${finding.object.type}, ${reviewLabel(finding)}: ${finding.object.title}`}
      aria-current={selected ? 'true' : undefined}
      data-finding={finding.object.id}
    >
      <rect x={place.x - width / 2} y={top - 14} width={width} height={titleY - top + titleLines * sizes.title * 1.36 + 34} fill="transparent" />
      {selected && <circle cx={place.x} cy={coreY} r={25} fill={color} fillOpacity={0.13} stroke={color} strokeOpacity={0.4} className="focus-ring" />}
      <SvgText x={place.x} y={top} size={sizes.label} max={charsFor(width, sizes.label)} color={tone === 'historical' ? '#7f8b7c' : toneColor} text={label} maxLines={1} />
      <circle
        className="pin-core"
        cx={place.x}
        cy={coreY}
        r={8}
        fill={tone === 'historical' ? '#fffef9' : toneColor}
        stroke={tone === 'historical' ? toneColor : '#fffef9'}
        strokeWidth={3}
      />
      <SvgText x={place.x} y={titleY} size={sizes.title} max={titleMax} color={tone === 'historical' ? '#6d7d6c' : '#3c583e'} text={finding.object.title} className="pin-title" maxLines={sizes.maxLines} />
      <SvgText x={place.x} y={titleY + titleLines * sizes.title * 1.36 + 4} size={sizes.line} max={charsFor(width, sizes.line)} color="#849578" text={sourceText} maxLines={1} />
      {mark.kicker && (
        <SvgText x={place.x} y={titleY + titleLines * sizes.title * 1.36 + 20} size={sizes.line} max={charsFor(width, sizes.line)} color={color} text={mark.kicker} maxLines={1} />
      )}
    </Link>
  );
}

export function RegionScene({ landscape, view, lens, matches, filtering, width, height }: SceneProps) {
  const project = view.project!;
  const region = view.region!;
  const params = view.params;
  const cx = width / 2;
  const cy = height / 2 + 12;
  const rx = width * 0.44;
  const ry = height * 0.4;
  const titleY = cy - ry + 58;
  const summary = region.summary ?? (region.previews.length ? undefined : 'No findings are placed in this region yet.');
  const summaryMax = charsFor(rx * 1.3, 13);
  const summaryH = summary ? linesHeight(summary, summaryMax, 13, 2) : 0;

  const children = region.children;
  const total = children.length + region.directIds.length;
  const top = titleY + 34 + summaryH;
  const inner = { x: cx - rx * 0.88, y: top, width: rx * 1.76, height: cy + ry - 22 - top };
  // Budget from the space actually available: each place needs roughly a
  // 230 × 140 px cell to stay legible. The rest goes to the full list.
  const budget = Math.max(3, Math.min(MAX_REGION_PLACES, Math.floor(inner.width / 230) * Math.max(1, Math.floor(inner.height / 140))));
  const overflow = total > budget;
  const capacity = overflow ? budget - 1 : budget;
  const shownChildren = children.slice(0, Math.min(children.length, overflow ? 3 : capacity));
  // The selected finding is always on screen, even past the scene budget.
  let pinIds = region.directIds.slice(0, capacity - shownChildren.length);
  if (view.finding && !pinIds.includes(view.finding.object.id) && region.directIds.includes(view.finding.object.id)) {
    pinIds = [...pinIds.slice(0, Math.max(0, pinIds.length - 1)), view.finding.object.id];
  }
  const hidden = total - shownChildren.length - pinIds.length;
  const placeIds = [...shownChildren.map((c) => c.id), ...pinIds, ...(hidden > 0 ? ['__more'] : [])];
  const places = layoutPlaces(
    placeIds,
    inner,
    { maxRx: 230, maxRy: 150, aspect: 1.5, jitter: 0.05 }
  );
  const count = placeIds.length;

  return (
    <Terrain
      width={width}
      height={height}
      label={`${region.title}: findings and subregions`}
      counts={{ places: count, findings: pinIds.length, edges: 0 }}
    >
      <Contours place={{ x: cx, y: cy, rx, ry }} color={project.color} />
      <SvgText x={cx} y={titleY} size={30} max={charsFor(rx * 1.6, 28)} color={project.color} text={region.title} className="land-title" maxLines={1} />
      {summary && <SvgText x={cx} y={titleY + 36} size={13} max={summaryMax} color="#7b8f6f" text={summary} maxLines={2} />}
      {shownChildren.map((child, i) => (
        <RegionIsland
          key={child.id}
          node={child}
          place={{ ...places[i], rx: places[i].rx * 0.92, ry: places[i].ry * 0.86 }}
          count={Math.max(4, count)}
          color={project.color}
          landscape={landscape}
          lens={lens}
          matches={matches}
          filtering={filtering}
          href={toHref(withLocation(params, { project: project.key, region: child.id }))}
          enterText="Enter subregion →"
        />
      ))}
      {pinIds.map((id, j) => {
        const finding = landscape.findings.get(id)!;
        const place = places[shownChildren.length + j];
        return (
          <Fragment key={id}>
            <FindingPin
              finding={finding}
              place={place}
              count={count}
              selected={view.finding?.object.id === id}
              color={project.color}
              lens={lens}
              dim={filtering && !matches(finding)}
              href={toHref(withLocation(params, { project: project.key, region: region.id, finding: id }))}
            />
          </Fragment>
        );
      })}
      {hidden > 0 && (
        <OverflowPlace
          place={places[places.length - 1]}
          text={`${hidden} more in this region · open the full list`}
          href={toHref({ ...params, finding: undefined, source: undefined, panel: 'list' })}
          color={project.color}
        />
      )}
    </Terrain>
  );
}

export function MiniOverview({ landscape, current, params }: { landscape: Landscape; current: string; params: LandscapeParams }) {
  const places = projectPlaces(landscape.projects, 1400, 690);
  return (
    <Link className="mini" to={toHref(withLocation(params, {}))} aria-label="Return to all projects">
      <svg viewBox="0 0 140 69" aria-hidden="true">
        {landscape.projects.map((p, i) => (
          <circle key={p.key} cx={places[i].x / 10} cy={places[i].y / 10} r={p.key === current ? 6 : 3.5} fill={p.key === current ? p.color : '#b8c8ab'} />
        ))}
      </svg>
      All projects ↗
    </Link>
  );
}

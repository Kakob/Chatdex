// Landscape geometry, ported from the reference atlas renderer
// (docs/changes/understanding-landscape/reference/source/atlas.js: blob,
// contours, lines). Deterministic: positions depend only on the scene size
// and the stable order/ids of the places, never on filters or lenses.

export interface Place {
  x: number;
  y: number;
  rx: number;
  ry: number;
}

/** The atlas.js organic landform outline. */
export function blob(cx: number, cy: number, rx: number, ry: number): string {
  return `M${cx - rx} ${cy - ry * 0.05} C${cx - rx * 1.06} ${cy - ry * 0.77},${cx - rx * 0.61} ${cy - ry * 1.02},${cx + rx * 0.12} ${cy - ry} C${cx + rx * 0.8} ${cy - ry * 0.98},${cx + rx * 1.1} ${cy - ry * 0.48},${cx + rx} ${cy + ry * 0.2} C${cx + rx * 0.91} ${cy + ry * 0.8},${cx + rx * 0.33} ${cy + ry * 1.08},${cx - rx * 0.3} ${cy + ry * 0.91} C${cx - rx * 0.85} ${cy + ry * 0.89},${cx - rx * 1.08} ${cy + ry * 0.45},${cx - rx} ${cy - ry * 0.05}Z`;
}

/** Three contour rings (outer two are terrain lines, inner one is the fill), as in atlas.js. */
export function contourRings(cx: number, cy: number, rx: number, ry: number) {
  return [1.14, 1.07, 1].map((k, i) => ({
    d: blob(cx + (i - 1) * 3, cy + (i - 1) * 2, rx * k, ry * k),
    fill: i === 2,
  }));
}

/** Greedy word wrap (atlas.js lines()), capped at maxLines with an ellipsis. */
export function wrapLines(text: string, maxChars: number, maxLines = Infinity): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && (line + ' ' + word).length > maxChars) {
      out.push(line);
      line = word;
    } else {
      line += (line ? ' ' : '') + word;
    }
  }
  if (line) out.push(line);
  if (out.length <= maxLines) return out;
  const kept = out.slice(0, maxLines);
  const last = kept[maxLines - 1];
  kept[maxLines - 1] = (last.length > maxChars - 1 ? last.slice(0, maxChars - 1) : last).replace(/[\s.,;:]+$/, '') + '…';
  return kept;
}

/** Small stable hash for deterministic jitter. */
export function hashString(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function jitter(id: string, amount: number): [number, number] {
  const h = hashString(id);
  return [(((h & 0xffff) / 0xffff) * 2 - 1) * amount, ((((h >>> 16) & 0xffff) / 0xffff) * 2 - 1) * amount];
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Arrange `ids.length` places in a rectangle: choose the column count that
 * gives the roundest cells, centre an incomplete last row, and offset each
 * place by a small id-keyed jitter so the terrain reads as organic.
 */
export function layoutPlaces(
  ids: string[],
  rect: Rect,
  options: { maxRx?: number; maxRy?: number; aspect?: number; jitter?: number } = {}
): Place[] {
  const n = ids.length;
  if (n === 0) return [];
  const aspect = options.aspect ?? 1.27;
  let best = { cols: 1, score: -1 };
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const cellW = rect.width / cols;
    const cellH = rect.height / rows;
    const score = Math.min(cellW / aspect, cellH);
    if (score > best.score + 0.5) best = { cols, score };
  }
  const cols = best.cols;
  const rows = Math.ceil(n / cols);
  const cellW = rect.width / cols;
  const cellH = rect.height / rows;
  const rx = Math.min(options.maxRx ?? Infinity, cellW * 0.41);
  const ry = Math.min(options.maxRy ?? Infinity, cellH * 0.38, rx / 1.05);
  const amount = Math.min(cellW, cellH) * (options.jitter ?? 0.035);
  return ids.map((id, i) => {
    const row = Math.floor(i / cols);
    const inRow = row === rows - 1 ? n - row * cols : cols;
    const col = i - row * cols;
    const offset = ((cols - inRow) * cellW) / 2;
    const [jx, jy] = jitter(id, amount);
    return {
      x: rect.x + offset + cellW * (col + 0.5) + jx,
      y: rect.y + cellH * (row + 0.5) + jy,
      rx,
      ry,
    };
  });
}

/** Point where a ray from an ellipse centre towards `toward` leaves the ellipse (atlas.js boundary()). */
export function ellipseBoundary(place: Place, toward: { x: number; y: number }): { x: number; y: number } {
  const dx = toward.x - place.x;
  const dy = toward.y - place.y;
  if (dx === 0 && dy === 0) return { x: place.x, y: place.y };
  const k = 1 / Math.sqrt((dx * dx) / (place.rx * place.rx) + (dy * dy) / (place.ry * place.ry));
  return { x: place.x + dx * k, y: place.y + dy * k };
}

/** Approximate characters per line for a given width and font size. */
export function charsFor(width: number, fontSize: number): number {
  return Math.max(10, Math.floor(width / (fontSize * 0.53)));
}

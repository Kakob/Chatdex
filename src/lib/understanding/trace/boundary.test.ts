// Audit S10 / SPEC-intent-trace §2.5 boundary law: the detection layer and
// Decision Investigation gain no network path from Intent Trace. Nothing
// under src/lib/detection or src/lib/investigation may import the GitHub
// client or the intent/trace modules, and the reverse direction stays a
// read-only reuse of normalizeSession + anchor listings.

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(__dirname, '../../..'); // src/

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

function importsOf(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  return [...text.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
}

const FORBIDDEN = [/\/github(\/|$)/, /\/understanding\/intents(\/|$)/, /\/understanding\/trace(\/|$)/, /\/providers(\/|$)/];

describe('boundary law (§2.5)', () => {
  for (const layer of ['lib/detection', 'lib/investigation']) {
    it(`${layer} never imports the GitHub client, intent/trace modules, or the LLM providers`, () => {
      const offenders: string[] = [];
      for (const file of walk(join(ROOT, layer))) {
        for (const spec of importsOf(file)) {
          if (FORBIDDEN.some((re) => re.test(spec))) offenders.push(`${file.replace(ROOT, 'src')} → ${spec}`);
        }
      }
      expect(offenders).toEqual([]);
    });
  }

  it('the intent/trace modules touch detection only through normalizeSession and investigation only through anchor reads', () => {
    const allowed = new Set(['../../detection/normalize', '../../db/investigationAnchors']);
    const offenders: string[] = [];
    for (const dir of ['lib/understanding/intents', 'lib/understanding/trace', 'lib/github']) {
      for (const file of walk(join(ROOT, dir))) {
        if (file.endsWith('.test.ts')) continue;
        for (const spec of importsOf(file)) {
          if (/\/(detection|investigation)(\/|$)/.test(spec) && !allowed.has(spec)) {
            offenders.push(`${file.replace(ROOT, 'src')} → ${spec}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

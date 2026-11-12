// Test helper: builds synthetic evidence manifests in the exact shape the
// capture script writes. Test-only; real evidence comes from the script.

import { EVIDENCE_SCHEMA, type EvidenceManifest, type ManifestSymbol, type ManifestTest } from '../../types/engineering';

export const BASE_SHA = 'a'.repeat(40);
export const IMPL_SHA = 'b'.repeat(40);

export function test(id: string, status: ManifestTest['status'] = 'passed'): ManifestTest {
  return { id, name: `[${id}] scenario`, file: 'test/delivery.test.ts', status, durationMs: 1 };
}

export function symbol(path: string, name: string, sha256 = `hash-${name}`, startLine = 10): ManifestSymbol {
  return { path, symbol: name, startLine, endLine: startLine + 4, sha256 };
}

export const BASE_SYMBOLS: ManifestSymbol[] = [
  symbol('src/queue.ts', 'EventQueue'),
  symbol('src/queue.ts', 'EventQueue.enqueue'),
  symbol('src/queue.ts', 'EventQueue.dequeue'),
  symbol('src/queue.ts', 'JobState'),
  symbol('src/worker.ts', 'workOnce'),
  symbol('test/delivery.test.ts', 'test:EQ-C0'),
  symbol('test/delivery.test.ts', 'test:EQ-C1'),
  symbol('test/delivery.test.ts', 'test:EQ-C5'),
];

export function manifest(
  overrides: Omit<Partial<EvidenceManifest>, 'revision'> & { revision?: Partial<EvidenceManifest['revision']> } = {}
): EvidenceManifest {
  const { revision, ...rest } = overrides;
  return {
    schema: EVIDENCE_SCHEMA,
    repository: { remote: 'https://github.com/Kakob/Chatdex', root: 'examples/event-queue' },
    changedPaths: [],
    uncommittedPaths: [],
    command: 'npx vitest run --config examples/event-queue/vitest.config.ts --reporter=json',
    environment: { node: 'v22.16.0' },
    capturedAt: '2026-11-12T09:00:00.000Z',
    tests: [test('EQ-C0'), test('EQ-C1'), test('EQ-C5', 'failed')],
    symbols: BASE_SYMBOLS,
    notes: [],
    ...rest,
    revision: { sha: BASE_SHA, dirty: false, ...revision },
  };
}

export function manifestText(m: EvidenceManifest): string {
  return `${JSON.stringify(m, null, 2)}\n`;
}

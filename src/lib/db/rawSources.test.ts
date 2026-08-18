import { describe, it, expect, beforeEach } from 'vitest';
import {
  db,
  clearAllData,
  storeRawSources,
  getRawSourceByHash,
  getRawSourcesForConversation,
  verifyRawSource,
} from './index';
import { sha256Hex } from '../utils/hash';
import type { RawSourceCapture } from '../parsers';

function capture(overrides: Partial<RawSourceCapture> = {}): RawSourceCapture {
  return {
    kind: 'claude-code',
    filename: 'session.jsonl',
    rawText: '{"type":"user","message":{"content":"hi"},"timestamp":"2026-01-01T00:00:00Z"}',
    parserVersion: '1.1.0',
    conversationIds: ['conv-1'],
    ...overrides,
  };
}

beforeEach(async () => {
  await clearAllData();
});

describe('storeRawSources — immutable raw retention (SPEC §7.1)', () => {
  it('stores a capture with its SHA-256 content hash and provenance', async () => {
    const cap = capture();
    const result = await storeRawSources([cap]);
    expect(result).toEqual({ added: 1, skippedExisting: 0 });

    const row = await getRawSourceByHash(await sha256Hex(cap.rawText));
    expect(row).toBeDefined();
    expect(row?.rawText).toBe(cap.rawText);
    expect(row?.filename).toBe('session.jsonl');
    expect(row?.parserVersion).toBe('1.1.0');
    expect(row?.kind).toBe('claude-code');
    expect(row?.conversationIds).toEqual(['conv-1']);
    expect(row?.textLength).toBe(cap.rawText.length);
  });

  it('is idempotent: re-storing byte-identical content adds nothing', async () => {
    await storeRawSources([capture()]);
    const second = await storeRawSources([capture()]);
    expect(second).toEqual({ added: 0, skippedExisting: 1 });
    expect(await db.rawSources.count()).toBe(1);
  });

  it('stores a changed re-import as a new source version, not an update', async () => {
    const original = capture();
    const grown = capture({ rawText: original.rawText + '\n{"type":"assistant"}' });
    await storeRawSources([original]);
    const result = await storeRawSources([grown]);
    expect(result.added).toBe(1);
    expect(await db.rawSources.count()).toBe(2);

    // The original row is untouched.
    const originalRow = await getRawSourceByHash(await sha256Hex(original.rawText));
    expect(originalRow?.rawText).toBe(original.rawText);
  });

  it('looks up sources by conversation id (multiEntry index)', async () => {
    await storeRawSources([
      capture(),
      capture({ rawText: 'other-content', conversationIds: ['conv-2'] }),
    ]);
    const forConv1 = await getRawSourcesForConversation('conv-1');
    expect(forConv1).toHaveLength(1);
    expect(forConv1[0].conversationIds).toContain('conv-1');
  });
});

describe('verifyRawSource — integrity check (SPEC §2.3)', () => {
  it('verifies an untampered row', async () => {
    await storeRawSources([capture()]);
    const row = await getRawSourceByHash(await sha256Hex(capture().rawText));
    expect(await verifyRawSource(row!.id)).toBe(true);
  });

  it('fails verification when stored text no longer matches its hash', async () => {
    await storeRawSources([capture()]);
    const row = await getRawSourceByHash(await sha256Hex(capture().rawText));
    // Simulate corruption via a direct table write (the module itself never mutates).
    await db.rawSources.update(row!.id, { rawText: 'tampered' });
    expect(await verifyRawSource(row!.id)).toBe(false);
  });

  it('returns false for a missing row', async () => {
    expect(await verifyRawSource('nope')).toBe(false);
  });
});

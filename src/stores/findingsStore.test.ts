import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, clearAllData, bulkPutConversations, bulkPutMessages } from '../lib/db';
import { parseClaudeCodeContent } from '../lib/parsers/claude-code';
import { normalizeSession } from '../lib/detection/normalize';
import { mapFindingsToMessages } from '../lib/detection/findingAnchors';
import { useFindingsStore } from './findingsStore';
import type { StoredMessage } from '../types/unified';

const GOLDEN_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../tests/golden-traces'
);

let sessionId: string;
let messages: StoredMessage[];

beforeEach(async () => {
  await clearAllData();
  useFindingsStore.setState({
    findingsByConversation: {},
    runCountByConversation: {},
    analyzingStage: {},
    selectedFindingId: null,
  });

  const jsonl = readFileSync(join(GOLDEN_DIR, 'mixed-session.jsonl'), 'utf-8');
  const parsed = parseClaudeCodeContent(jsonl, 'mixed-session.jsonl');
  sessionId = parsed.conversations[0].id;
  messages = parsed.messages;
  await bulkPutConversations(parsed.conversations);
  await bulkPutMessages(parsed.messages);
});

describe('findingsStore — analyze and load', () => {
  it('analyzes a session (worker fallback) and exposes its findings', async () => {
    const store = useFindingsStore.getState();
    await store.analyze(sessionId);

    const findings = useFindingsStore.getState().findingsByConversation[sessionId];
    expect(findings).toHaveLength(3);
    expect(new Set(findings.map((f) => f.detector))).toEqual(
      new Set(['loop', 'verification_absence', 'silent_reversion'])
    );
    expect(useFindingsStore.getState().runCountByConversation[sessionId]).toBe(1);
    expect(useFindingsStore.getState().analyzingStage[sessionId]).toBeUndefined();
  });

  it('re-analysis with unchanged config is idempotent', async () => {
    const store = useFindingsStore.getState();
    await store.analyze(sessionId);
    await store.analyze(sessionId);

    expect(await db.findings.count()).toBe(3);
    expect(await db.detectorRuns.count()).toBe(1);
  });
});

describe('findingsStore — marker anchoring (golden mixed-session)', () => {
  it('anchors each finding at the message backing its start step', async () => {
    await useFindingsStore.getState().analyze(sessionId);
    const findings = useFindingsStore.getState().findingsByConversation[sessionId];

    const session = normalizeSession(sessionId, messages);
    const byMessage = mapFindingsToMessages(session, findings);

    // Flat traces map steps 1:1 to messages: loop anchors at step 5,
    // reversion at step 3, verification at step 20.
    const anchoredIndices = messages
      .map((m, i) => (byMessage.has(m.id) ? i : -1))
      .filter((i) => i >= 0);
    expect(anchoredIndices).toEqual([3, 5, 20]);

    const detectorAt = (index: number) =>
      byMessage.get(messages[index].id)!.map((f) => f.detector);
    expect(detectorAt(3)).toEqual(['silent_reversion']);
    expect(detectorAt(5)).toEqual(['loop']);
    expect(detectorAt(20)).toEqual(['verification_absence']);
  });
});

describe('findingsStore — labeling persists across reload', () => {
  it('persists a label to IndexedDB and preserves it on fresh load', async () => {
    const store = useFindingsStore.getState();
    await store.analyze(sessionId);
    const finding = useFindingsStore
      .getState()
      .findingsByConversation[sessionId].find((f) => f.detector === 'loop')!;

    await store.labelFinding(sessionId, finding.id, 'confirmed');

    // In-memory state updated…
    expect(
      useFindingsStore
        .getState()
        .findingsByConversation[sessionId].find((f) => f.id === finding.id)?.userLabel
    ).toBe('confirmed');

    // …and it survives a simulated reload (fresh read from IndexedDB).
    useFindingsStore.setState({ findingsByConversation: {} });
    await useFindingsStore.getState().loadFindings(sessionId);
    const reloaded = useFindingsStore
      .getState()
      .findingsByConversation[sessionId].find((f) => f.id === finding.id)!;
    expect(reloaded.userLabel).toBe('confirmed');
    // updatedAt bumped so last-write-wins sync propagates the label.
    expect(reloaded.updatedAt.getTime()).toBeGreaterThan(reloaded.createdAt.getTime());
  });

  it('clicking the active label again resets to unset (store contract)', async () => {
    const store = useFindingsStore.getState();
    await store.analyze(sessionId);
    const finding = useFindingsStore.getState().findingsByConversation[sessionId][0];

    await store.labelFinding(sessionId, finding.id, 'false_positive');
    await store.labelFinding(sessionId, finding.id, 'unset');
    expect((await db.findings.get(finding.id))?.userLabel).toBe('unset');
  });
});

// End-to-end constraint test (SPEC-decision-investigation §16.3, DI-4).
// The complete investigation flow — import → anchors → case → search → pin →
// review scope → verdict → ledger → coverage → reopen → refinalize — runs
// with ALL network access disabled. Any fetch/XHR/WebSocket attempt fails the
// test. Alongside the offline guarantee, this asserts the no-generation
// invariants: nothing preselected, nothing prefilled, all prose human or
// fixed taxonomy, every exhibit resolving to its exact primary source.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db, clearAllData, getRevisionsForCase } from '../db/index';
import { importFiles } from '../import';
import { listInvestigationAnchors } from '../db/investigationAnchors';
import {
  startInvestigation,
  caseTitleTemplate,
  updateCaseHumanFields,
  pinTranscriptExhibit,
  pinToolEventExhibit,
  confirmReviewScope,
  recordCaseSearch,
  resolveExhibit,
} from './cases';
import {
  saveVerdictDraft,
  finalizeVerdict,
  reopenCase,
  listDecisionLedger,
  getInvestigationCoverage,
  getContinuationTargets,
  ORIGIN_LABELS,
} from './verdicts';
import { getInvestigationContext } from './context';
import { searchStepTexts, stepDisplayText } from './search';

const networkViolations: string[] = [];
let realFetch: typeof fetch;
let realXHR: typeof XMLHttpRequest;
let realWebSocket: typeof WebSocket | undefined;

beforeEach(async () => {
  await clearAllData();
  networkViolations.length = 0;
  realFetch = globalThis.fetch;
  realXHR = globalThis.XMLHttpRequest;
  realWebSocket = globalThis.WebSocket;

  globalThis.fetch = ((input: RequestInfo | URL) => {
    networkViolations.push(`fetch: ${String(input)}`);
    return Promise.reject(new Error('network disabled by constraint test'));
  }) as typeof fetch;
  globalThis.XMLHttpRequest = class {
    constructor() {
      networkViolations.push('XMLHttpRequest constructed');
      throw new Error('network disabled by constraint test');
    }
  } as unknown as typeof XMLHttpRequest;
  globalThis.WebSocket = class {
    constructor(url: string | URL) {
      networkViolations.push(`WebSocket: ${String(url)}`);
      throw new Error('network disabled by constraint test');
    }
  } as unknown as typeof WebSocket;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  globalThis.XMLHttpRequest = realXHR;
  if (realWebSocket) globalThis.WebSocket = realWebSocket;
});

const entry = (type: string, extra: Record<string, unknown>) =>
  JSON.stringify({ type, timestamp: '2026-02-05T10:00:00Z', ...extra });

const FIXTURE_LINES = [
  entry('user', {
    sessionId: 'session-constraints',
    cwd: '/project',
    message: { content: 'Please switch the storage layer to use batched writes' },
  }),
  entry('assistant', {
    message: {
      content: [
        { type: 'text', text: 'I will update the storage module.' },
        {
          type: 'tool_use',
          id: 'toolu_c1',
          name: 'Edit',
          input: {
            file_path: '/project/src/storage.ts',
            old_string: 'writeOne(item)',
            new_string: 'writeBatch(items)',
          },
        },
      ],
    },
  }),
  entry('user', {
    message: {
      content: [{ type: 'tool_result', tool_use_id: 'toolu_c1', content: 'edited ok' }],
    },
  }),
  entry('assistant', { message: { content: 'Done — storage now batches writes.' } }),
];

describe('§16.3 — the complete investigation flow, offline, non-generative', () => {
  it('runs import → verdict → ledger → reopen with zero network attempts', async () => {
    // 1. Import (includes detection auto-analysis + anchor derivation).
    const file = new File([FIXTURE_LINES.join('\n')], 'constraints.jsonl');
    const importResult = await importFiles([file]);
    expect(importResult.conversationsAdded).toBe(1);

    // 2. Neutral anchor exists; its label inputs are literal metadata only.
    const anchors = await listInvestigationAnchors();
    expect(anchors).toHaveLength(1);
    const anchor = anchors[0];
    expect(anchor.filePaths).toEqual(['/project/src/storage.ts']);

    // 3. Start a case: title is the deterministic template, nothing else is
    //    prefilled — no notes, no draft verdict, no preselected anything.
    const caseRow = await startInvestigation(anchor);
    expect(caseRow.title).toBe(caseTitleTemplate(anchor));
    expect(caseRow.notes).toBe('');
    expect(caseRow.verdictDraft).toBeUndefined();
    expect(caseRow.searchRecords).toEqual([]);

    // 4. Read + literal search over the exact rendered text.
    const context = (await getInvestigationContext(anchor.id))!;
    const texts = context.steps.map((ws) => stepDisplayText(ws.step));
    const matches = searchStepTexts(texts, 'batched');
    expect(matches.length).toBeGreaterThan(0);
    await recordCaseSearch(caseRow.id, { query: 'batched', resultCount: matches.length });

    // 5. Pin evidence + confirm the reviewed interval.
    const transcriptExhibit = await pinTranscriptExhibit(caseRow.id, {
      stepIndex: 0,
      startOffset: 0,
      endOffset: 20,
    });
    await pinToolEventExhibit(caseRow.id, anchor.stableKey);
    await confirmReviewScope(caseRow.id, {
      startStepIndex: 0,
      endStepIndex: context.steps.length - 1,
    });

    // 6. Human verdict, human words. Finalize → ledger.
    await updateCaseHumanFields(caseRow.id, { title: 'Who chose batched writes?' });
    await saveVerdictDraft(caseRow.id, {
      origin: 'user_directed',
      status: 'active',
      confidence: 'high',
      rationale: 'My opening message asked for exactly this.',
    });
    const revision = await finalizeVerdict(caseRow.id);

    const ledger = await listDecisionLedger();
    expect(ledger).toHaveLength(1);
    // All ledger prose is the human's writing or a fixed taxonomy label.
    expect(ledger[0].title).toBe('Who chose batched writes?');
    expect(ledger[0].latest.rationale).toBe('My opening message asked for exactly this.');
    expect(ORIGIN_LABELS[ledger[0].latest.origin]).toBe('I explicitly directed this');

    // 7. Coverage + continuation are factual counts/links.
    const coverage = await getInvestigationCoverage();
    expect(coverage.totals).toEqual({
      totalAnchors: 1,
      uninvestigated: 0,
      open: 0,
      adjudicated: 1,
    });
    const continuation = await getContinuationTargets(anchor);
    expect(continuation.nextUninvestigated).toBeUndefined();

    // 8. Every exhibit re-renders from its exact primary source.
    expect(await resolveExhibit(transcriptExhibit, texts)).toEqual({
      status: 'ok',
      text: texts[0].slice(0, 20),
    });

    // 9. Reopen and refinalize; revision 1 survives unchanged.
    await reopenCase(caseRow.id);
    await saveVerdictDraft(caseRow.id, { confidence: 'medium' });
    const revision2 = await finalizeVerdict(caseRow.id);
    expect(revision2.revisionNumber).toBe(2);
    const stored = await getRevisionsForCase(caseRow.id);
    expect(stored[0]).toEqual(revision);

    // 10. THE constraint: not one network attempt anywhere in the flow.
    expect(networkViolations).toEqual([]);
  });

  it('keeps the sync tables untouched for local-only investigation data', async () => {
    const file = new File([FIXTURE_LINES.join('\n')], 'constraints2.jsonl');
    await importFiles([file]);
    // Raw sources and derived anchors exist locally…
    expect(await db.rawSources.count()).toBe(1);
    expect(await db.investigationAnchors.count()).toBe(1);
    // …and the flow made no network attempts to sync or anything else.
    // (Sync only ever runs when the engine is explicitly started.)
    expect(networkViolations).toEqual([]);
  });
});

// Case state + actions for the workbench (DI-2c). Wraps the trust-boundary
// service in src/lib/investigation/cases.ts; every action re-validates there,
// this hook only manages loading/refresh and surfaces errors.

import { useCallback, useEffect, useState } from 'react';
import {
  getCaseByPrimaryAnchor,
  getExhibitsForCase,
  getScopesForCase,
} from '../lib/db/investigationCases';
import {
  startInvestigation,
  updateCaseHumanFields,
  pinTranscriptExhibit,
  pinToolEventExhibit,
  pinCodeExhibit,
  setExhibitNote,
  removeDraftExhibit,
  confirmReviewScope,
  removeDraftReviewScope,
  recordCaseSearch,
  resolveExhibit,
  type ExhibitResolution,
} from '../lib/investigation/cases';
import {
  saveVerdictDraft,
  validateVerdict,
  finalizeVerdict,
  reopenCase,
} from '../lib/investigation/verdicts';
import { getRevisionsForCase } from '../lib/db/investigationCases';
import type { TranscriptSelection } from '../lib/investigation/selection';
import type {
  CaseExhibit,
  InvestigationAnchor,
  InvestigationCase,
  ReviewScope,
  VerdictDraft,
  VerdictRevision,
} from '../types/investigation';

export interface UseInvestigationCaseResult {
  caseRow: InvestigationCase | null;
  exhibits: CaseExhibit[];
  scopes: ReviewScope[];
  resolutions: Map<string, ExhibitResolution>;
  revisions: VerdictRevision[];
  /** §8.8 finalization requirements still missing (empty = finalizable). */
  verdictMissing: string[];
  error: string | null;
  clearError: () => void;
  saveVerdict: (draft: VerdictDraft) => Promise<void>;
  finalize: () => Promise<void>;
  reopen: () => Promise<void>;
  start: () => Promise<void>;
  saveTitle: (title: string) => Promise<void>;
  saveNotes: (notes: string) => Promise<void>;
  pinSelection: (selection: TranscriptSelection) => Promise<void>;
  pinWholeStep: (stepIndex: number, textLength: number) => Promise<void>;
  pinCodeEvent: () => Promise<void>;
  pinCodeSide: (changeIndex: number, codeSide: 'before' | 'after') => Promise<void>;
  removeExhibit: (exhibitId: string) => Promise<void>;
  saveExhibitNote: (exhibitId: string, note: string) => Promise<void>;
  confirmScope: (startStepIndex: number, endStepIndex: number) => Promise<void>;
  removeScope: (scopeId: string) => Promise<void>;
  recordSearch: (query: string, resultCount: number) => Promise<void>;
}

interface CaseData {
  caseRow: InvestigationCase | null;
  exhibits: CaseExhibit[];
  scopes: ReviewScope[];
  resolutions: Map<string, ExhibitResolution>;
  revisions: VerdictRevision[];
  verdictMissing: string[];
}

const EMPTY_DATA: CaseData = {
  caseRow: null,
  exhibits: [],
  scopes: [],
  resolutions: new Map(),
  revisions: [],
  verdictMissing: [],
};

async function loadCaseData(
  anchor: InvestigationAnchor | null,
  displayTexts: string[]
): Promise<CaseData> {
  if (!anchor) return EMPTY_DATA;
  const caseRow = (await getCaseByPrimaryAnchor(anchor.stableKey)) ?? null;
  if (!caseRow) return EMPTY_DATA;
  const exhibits = await getExhibitsForCase(caseRow.id);
  const scopes = await getScopesForCase(caseRow.id);
  const resolutions = new Map<string, ExhibitResolution>();
  for (const exhibit of exhibits) {
    resolutions.set(exhibit.id, await resolveExhibit(exhibit, displayTexts));
  }
  return {
    caseRow,
    exhibits,
    scopes,
    resolutions,
    revisions: await getRevisionsForCase(caseRow.id),
    verdictMissing: await validateVerdict(caseRow.id),
  };
}

export function useInvestigationCase(
  anchor: InvestigationAnchor | null,
  displayTexts: string[]
): UseInvestigationCaseResult {
  const [data, setData] = useState<CaseData>(EMPTY_DATA);
  const [error, setError] = useState<string | null>(null);
  const { caseRow, exhibits, scopes, resolutions, revisions, verdictMissing } = data;

  useEffect(() => {
    let cancelled = false;
    void loadCaseData(anchor, displayTexts).then((loaded) => {
      if (!cancelled) setData(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [anchor, displayTexts]);

  const refresh = useCallback(async () => {
    setData(await loadCaseData(anchor, displayTexts));
  }, [anchor, displayTexts]);

  const run = useCallback(
    async (action: () => Promise<unknown>) => {
      try {
        setError(null);
        await action();
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [refresh]
  );

  return {
    caseRow,
    exhibits,
    scopes,
    resolutions,
    revisions,
    verdictMissing,
    error,
    clearError: () => setError(null),
    saveVerdict: (draft) =>
      run(() => (caseRow ? saveVerdictDraft(caseRow.id, draft) : Promise.resolve())),
    finalize: () =>
      run(() => (caseRow ? finalizeVerdict(caseRow.id) : Promise.resolve())),
    reopen: () => run(() => (caseRow ? reopenCase(caseRow.id) : Promise.resolve())),
    start: () => run(() => (anchor ? startInvestigation(anchor) : Promise.resolve())),
    saveTitle: (title) =>
      run(() =>
        caseRow ? updateCaseHumanFields(caseRow.id, { title }) : Promise.resolve()
      ),
    saveNotes: (notes) =>
      run(() =>
        caseRow ? updateCaseHumanFields(caseRow.id, { notes }) : Promise.resolve()
      ),
    pinSelection: (selection) =>
      run(() =>
        caseRow
          ? pinTranscriptExhibit(caseRow.id, {
              stepIndex: selection.stepIndex,
              startOffset: selection.startOffset,
              endOffset: selection.endOffset,
            })
          : Promise.resolve()
      ),
    pinWholeStep: (stepIndex, textLength) =>
      run(() =>
        caseRow && textLength > 0
          ? pinTranscriptExhibit(caseRow.id, {
              stepIndex,
              startOffset: 0,
              endOffset: textLength,
            })
          : Promise.resolve()
      ),
    pinCodeEvent: () =>
      run(() =>
        caseRow && anchor
          ? pinToolEventExhibit(caseRow.id, anchor.stableKey)
          : Promise.resolve()
      ),
    pinCodeSide: (changeIndex, codeSide) =>
      run(() =>
        caseRow && anchor
          ? pinCodeExhibit(caseRow.id, {
              anchorStableKey: anchor.stableKey,
              changeIndex,
              codeSide,
            })
          : Promise.resolve()
      ),
    removeExhibit: (exhibitId) =>
      run(() =>
        caseRow ? removeDraftExhibit(caseRow.id, exhibitId) : Promise.resolve()
      ),
    saveExhibitNote: (exhibitId, note) =>
      run(() =>
        caseRow ? setExhibitNote(caseRow.id, exhibitId, note) : Promise.resolve()
      ),
    confirmScope: (startStepIndex, endStepIndex) =>
      run(() =>
        caseRow
          ? confirmReviewScope(caseRow.id, { startStepIndex, endStepIndex })
          : Promise.resolve()
      ),
    removeScope: (scopeId) =>
      run(() =>
        caseRow ? removeDraftReviewScope(caseRow.id, scopeId) : Promise.resolve()
      ),
    recordSearch: async (query, resultCount) => {
      // Process evidence only — recording failures must never break search.
      if (!caseRow) return;
      try {
        await recordCaseSearch(caseRow.id, { query, resultCount });
        await refresh();
      } catch {
        // ignore
      }
    },
  };
}

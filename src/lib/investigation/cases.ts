// Case/exhibit/review-scope operations (SPEC-decision-investigation §8.3–§8.7,
// §12; DI-2c). This module IS the trust boundary: every mutation validates
// case state, locators, offsets, and ranges here — never only in UI controls.
// Selected text and its hash are recomputed from the source, not trusted from
// the caller. Nothing here generates prose: titles come from a deterministic
// literal template, notes and questions are human-authored.

import { normalizeSession, type Step } from '../detection/normalize';
import { db } from '../db/schema';
import { getMessagesForConversation } from '../db/messages';
import {
  putInvestigationCase,
  getInvestigationCase,
  getCaseByPrimaryAnchor,
  listInvestigationCases,
  putCaseExhibit,
  getCaseExhibit,
  deleteCaseExhibit,
  putReviewScope,
  getReviewScope,
  deleteReviewScope,
} from '../db/investigationCases';
import { getInvestigationAnchor } from '../db/investigationAnchors';
import { getConversationSourceRef } from './anchors';
import { isReferencedByRevision } from './verdicts';
import { stepDisplayText } from './search';
import { anchorFileLabel, KIND_LABELS } from './filter';
import { sha256Hex } from '../utils/hash';
import { generateId } from '../utils/ids';
import type {
  CaseExhibit,
  CaseState,
  InvestigationAnchor,
  InvestigationCase,
  ReviewScope,
} from '../../types/investigation';

/** Deterministic editable template (spec §8.3) — literal metadata only. */
export function caseTitleTemplate(anchor: InvestigationAnchor): string {
  return `Investigate ${KIND_LABELS[anchor.kind]}: ${anchorFileLabel(anchor)}`;
}

const EDITABLE_STATES: ReadonlySet<CaseState> = new Set(['draft', 'open', 'reopened']);

async function requireEditableCase(caseId: string): Promise<InvestigationCase> {
  const row = await getInvestigationCase(caseId);
  if (!row) throw new Error(`Case not found: ${caseId}`);
  if (!EDITABLE_STATES.has(row.state)) {
    throw new Error(`Case is ${row.state}; completed cases must be reopened first`);
  }
  return row;
}

async function loadSteps(conversationId: string): Promise<Step[]> {
  const messages = await getMessagesForConversation(conversationId);
  return normalizeSession(conversationId, messages).steps;
}

/**
 * `Start investigation` (spec §8.3): returns the existing case for this
 * anchor, or creates a draft attached to it. One case per primary anchor.
 */
export async function startInvestigation(
  anchor: InvestigationAnchor
): Promise<InvestigationCase> {
  const existing = await getCaseByPrimaryAnchor(anchor.stableKey);
  if (existing) return existing;

  const now = new Date();
  const row: InvestigationCase = {
    id: generateId(),
    conversationId: anchor.conversationId,
    primaryAnchorStableKey: anchor.stableKey,
    linkedAnchorStableKeys: [],
    kind: 'anchor',
    title: caseTitleTemplate(anchor),
    notes: '',
    state: 'draft',
    searchRecords: [],
    createdAt: now,
    updatedAt: now,
  };
  await putInvestigationCase(row);
  return row;
}

export async function startQuestionInvestigation(input: {
  projectId: string;
  conversationId: string;
  question: string;
}): Promise<InvestigationCase> {
  const question = input.question.trim();
  if (!question) throw new Error('Investigation question cannot be empty');
  const [project, conversation, association] = await Promise.all([
    db.understandingProjects.get(input.projectId),
    db.conversations.get(input.conversationId),
    db.projectAssociations
      .where('[projectId+conversationId]')
      .equals([input.projectId, input.conversationId])
      .first(),
  ]);
  if (!project || project.reviewState === 'rejected') {
    throw new Error(`Project not found: ${input.projectId}`);
  }
  if (!conversation) throw new Error(`Conversation not found: ${input.conversationId}`);
  if (
    !association ||
    (association.reviewState !== 'accepted' && association.reviewState !== 'edited')
  ) {
    throw new Error('The selected source is not accepted for this project');
  }

  const now = new Date();
  const row: InvestigationCase = {
    id: generateId(),
    projectId: input.projectId,
    conversationId: input.conversationId,
    linkedAnchorStableKeys: [],
    kind: 'question',
    title: question,
    notes: '',
    state: 'open',
    searchRecords: [],
    createdAt: now,
    updatedAt: now,
  };
  await putInvestigationCase(row);
  return row;
}

export async function completeQuestionInvestigation(
  caseId: string
): Promise<InvestigationCase> {
  const row = await requireEditableCase(caseId);
  if ((row.kind ?? 'anchor') !== 'question') {
    throw new Error('Anchor investigations complete through a finalized verdict');
  }
  const finalizedFindings = await db.investigationFindings
    .where('caseId')
    .equals(caseId)
    .filter((finding) => finding.state === 'finalized')
    .count();
  if (finalizedFindings === 0) {
    throw new Error('Finalize at least one finding before completing the investigation');
  }
  const completed: InvestigationCase = {
    ...row,
    state: 'completed',
    updatedAt: new Date(),
  };
  await putInvestigationCase(completed);
  return completed;
}

export async function reopenQuestionInvestigation(caseId: string): Promise<InvestigationCase> {
  const row = await getInvestigationCase(caseId);
  if (!row) throw new Error(`Case not found: ${caseId}`);
  if (row.state !== 'completed') throw new Error('Only completed investigations can be reopened');
  const reopened: InvestigationCase = {
    ...row,
    state: 'reopened',
    updatedAt: new Date(),
  };
  await putInvestigationCase(reopened);
  return reopened;
}

export async function updateCaseHumanFields(
  caseId: string,
  fields: { title?: string; notes?: string }
): Promise<InvestigationCase> {
  const row = await requireEditableCase(caseId);
  if (fields.title !== undefined && fields.title.trim().length === 0) {
    throw new Error('Case title cannot be empty');
  }
  const updated: InvestigationCase = {
    ...row,
    ...(fields.title !== undefined ? { title: fields.title } : {}),
    ...(fields.notes !== undefined ? { notes: fields.notes } : {}),
    updatedAt: new Date(),
  };
  await putInvestigationCase(updated);
  return updated;
}

export interface TranscriptSpanLocator {
  stepIndex: number;
  startOffset: number;
  endOffset: number;
  humanNote?: string;
}

/**
 * Pin an exact transcript span (spec §8.4). Selection must lie within one
 * source event; text and hash are recomputed here from the source.
 */
export async function pinTranscriptExhibit(
  caseId: string,
  locator: TranscriptSpanLocator
): Promise<CaseExhibit> {
  const caseRow = await requireEditableCase(caseId);
  const steps = await loadSteps(caseRow.conversationId);
  const step = steps[locator.stepIndex];
  if (!step) throw new Error(`No source event at step ${locator.stepIndex}`);

  const text = stepDisplayText(step);
  const { startOffset, endOffset } = locator;
  if (
    !Number.isInteger(startOffset) ||
    !Number.isInteger(endOffset) ||
    startOffset < 0 ||
    endOffset > text.length ||
    startOffset >= endOffset
  ) {
    throw new Error(
      `Invalid span [${startOffset}, ${endOffset}) for step ${locator.stepIndex} (length ${text.length})`
    );
  }

  const selectedText = text.slice(startOffset, endOffset);
  const source = await getConversationSourceRef(caseRow.conversationId);
  const now = new Date();
  const exhibit: CaseExhibit = {
    id: generateId(),
    caseId,
    conversationId: caseRow.conversationId,
    kind: 'transcript_span',
    stepIndex: locator.stepIndex,
    messageId: step.messageId,
    sourceContentHash: source.contentHash,
    startOffset,
    endOffset,
    offsetEncoding: 'utf16',
    selectedText,
    selectedContentHash: await sha256Hex(selectedText),
    humanNote: locator.humanNote,
    createdAt: now,
    updatedAt: now,
  };
  await putCaseExhibit(exhibit);
  return exhibit;
}

/** Pin an entire code-change event (spec §8.5). */
export async function pinToolEventExhibit(
  caseId: string,
  anchorStableKey: string,
  humanNote?: string
): Promise<CaseExhibit> {
  const caseRow = await requireEditableCase(caseId);
  const anchor = await requireAnchorInCaseConversation(anchorStableKey, caseRow);

  const steps = await loadSteps(caseRow.conversationId);
  const step = steps[anchor.stepIndex];
  if (!step) throw new Error(`Anchor step ${anchor.stepIndex} not found in source`);

  const selectedText = stepDisplayText(step);
  const now = new Date();
  const exhibit: CaseExhibit = {
    id: generateId(),
    caseId,
    conversationId: caseRow.conversationId,
    kind: 'tool_event',
    stepIndex: anchor.stepIndex,
    messageId: anchor.messageId,
    anchorStableKey,
    sourceContentHash: anchor.sourceContentHash,
    selectedText,
    selectedContentHash: await sha256Hex(selectedText),
    humanNote,
    createdAt: now,
    updatedAt: now,
  };
  await putCaseExhibit(exhibit);
  return exhibit;
}

export interface CodeSpanLocator {
  anchorStableKey: string;
  changeIndex: number;
  codeSide: 'before' | 'after';
  /** 1-based inclusive; omit both to pin the whole side. */
  startLine?: number;
  endLine?: number;
  humanNote?: string;
}

/** Pin a hunk side or line range within it (spec §8.5). */
export async function pinCodeExhibit(
  caseId: string,
  locator: CodeSpanLocator
): Promise<CaseExhibit> {
  const caseRow = await requireEditableCase(caseId);
  const anchor = await requireAnchorInCaseConversation(locator.anchorStableKey, caseRow);

  const change = anchor.fileChanges.find((c) => c.changeIndex === locator.changeIndex);
  if (!change) {
    throw new Error(`No file change ${locator.changeIndex} on anchor ${anchor.stableKey}`);
  }
  const side = locator.codeSide === 'before' ? change.oldString : change.newString;
  if (side === undefined) {
    throw new Error('This change has no before-text (whole-file write)');
  }

  let selectedText = side;
  if (locator.startLine !== undefined || locator.endLine !== undefined) {
    const lines = side.split('\n');
    const start = locator.startLine ?? 1;
    const end = locator.endLine ?? lines.length;
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 1 ||
      end > lines.length ||
      start > end
    ) {
      throw new Error(`Invalid line range ${start}-${end} (1-${lines.length})`);
    }
    selectedText = lines.slice(start - 1, end).join('\n');
  }

  const now = new Date();
  const exhibit: CaseExhibit = {
    id: generateId(),
    caseId,
    conversationId: caseRow.conversationId,
    kind: 'code_span',
    stepIndex: anchor.stepIndex,
    messageId: anchor.messageId,
    anchorStableKey: anchor.stableKey,
    sourceContentHash: anchor.sourceContentHash,
    filePath: change.path,
    changeIndex: locator.changeIndex,
    codeSide: locator.codeSide,
    startLine: locator.startLine,
    endLine: locator.endLine,
    selectedText,
    selectedContentHash: await sha256Hex(selectedText),
    humanNote: locator.humanNote,
    createdAt: now,
    updatedAt: now,
  };
  await putCaseExhibit(exhibit);
  return exhibit;
}

/** The user's own annotation on an exhibit (spec §8.5) — never generated. */
export async function setExhibitNote(
  caseId: string,
  exhibitId: string,
  humanNote: string
): Promise<CaseExhibit> {
  await requireEditableCase(caseId);
  const exhibit = await getCaseExhibit(exhibitId);
  if (!exhibit || exhibit.caseId !== caseId) {
    throw new Error('Exhibit does not belong to this case');
  }
  const updated: CaseExhibit = {
    ...exhibit,
    humanNote: humanNote.trim() || undefined,
    updatedAt: new Date(),
  };
  await putCaseExhibit(updated);
  return updated;
}

export async function removeDraftExhibit(caseId: string, exhibitId: string): Promise<void> {
  await requireEditableCase(caseId);
  const exhibit = await getCaseExhibit(exhibitId);
  if (!exhibit || exhibit.caseId !== caseId) {
    throw new Error('Exhibit does not belong to this case');
  }
  if (await isReferencedByRevision(caseId, 'exhibit', exhibitId)) {
    throw new Error(
      'This exhibit is part of a finalized verdict revision and cannot be removed'
    );
  }
  await deleteCaseExhibit(exhibitId);
}

/** Record an executed search verbatim (spec §8.6) — process evidence only. */
export async function recordCaseSearch(
  caseId: string,
  search: { query: string; resultCount: number }
): Promise<InvestigationCase> {
  const row = await requireEditableCase(caseId);
  const updated: InvestigationCase = {
    ...row,
    searchRecords: [
      ...row.searchRecords,
      {
        id: generateId(),
        query: search.query,
        mode: 'literal',
        resultCount: search.resultCount,
        createdAt: new Date(),
      },
    ],
    updatedAt: new Date(),
  };
  await putInvestigationCase(updated);
  return updated;
}

/**
 * Persist an explicitly confirmed reviewed range (spec §8.7). Never called
 * from render/scroll paths — only from the user's confirmation action.
 */
export async function confirmReviewScope(
  caseId: string,
  range: { startStepIndex: number; endStepIndex: number }
): Promise<ReviewScope> {
  const caseRow = await requireEditableCase(caseId);
  const steps = await loadSteps(caseRow.conversationId);
  const { startStepIndex, endStepIndex } = range;
  if (
    !Number.isInteger(startStepIndex) ||
    !Number.isInteger(endStepIndex) ||
    startStepIndex < 0 ||
    endStepIndex >= steps.length ||
    startStepIndex > endStepIndex
  ) {
    throw new Error(
      `Invalid review range ${startStepIndex}–${endStepIndex} (source has ${steps.length} events)`
    );
  }

  const source = await getConversationSourceRef(caseRow.conversationId);
  const now = new Date();
  const scope: ReviewScope = {
    id: generateId(),
    caseId,
    conversationId: caseRow.conversationId,
    startStepIndex,
    endStepIndex,
    eventCount: endStepIndex - startStepIndex + 1,
    startMessageId: steps[startStepIndex].messageId,
    endMessageId: steps[endStepIndex].messageId,
    sourceContentHash: source.contentHash,
    includedSearchRecordIds: caseRow.searchRecords.map((r) => r.id),
    humanConfirmedAt: now,
    createdAt: now,
    updatedAt: now,
  };
  await putReviewScope(scope);
  return scope;
}

export async function removeDraftReviewScope(caseId: string, scopeId: string): Promise<void> {
  await requireEditableCase(caseId);
  const scope = await getReviewScope(scopeId);
  if (!scope || scope.caseId !== caseId) {
    throw new Error('Review scope does not belong to this case');
  }
  if (await isReferencedByRevision(caseId, 'scope', scopeId)) {
    throw new Error(
      'This review scope is part of a finalized verdict revision and cannot be removed'
    );
  }
  await deleteReviewScope(scopeId);
}

export type ExhibitResolution =
  | { status: 'ok'; text: string }
  | { status: 'source_mismatch'; cachedText: string };

/**
 * Re-render a transcript/tool exhibit from source + locator (spec §8.4): the
 * stored preview is a cache. A failed hash check marks the exhibit
 * `Source mismatch` — it is never silently relocated.
 */
export async function resolveExhibit(
  exhibit: CaseExhibit,
  displayTexts: string[]
): Promise<ExhibitResolution> {
  let text: string | undefined;
  if (exhibit.kind === 'transcript_span') {
    const full = displayTexts[exhibit.stepIndex];
    if (
      full !== undefined &&
      exhibit.startOffset !== undefined &&
      exhibit.endOffset !== undefined &&
      exhibit.endOffset <= full.length
    ) {
      text = full.slice(exhibit.startOffset, exhibit.endOffset);
    }
  } else if (exhibit.kind === 'tool_event') {
    text = displayTexts[exhibit.stepIndex];
  } else {
    // code_span re-renders from the anchor's stored file change.
    const anchor = exhibit.anchorStableKey
      ? await getInvestigationAnchor(exhibit.anchorStableKey)
      : undefined;
    const change = anchor?.fileChanges.find((c) => c.changeIndex === exhibit.changeIndex);
    const side = exhibit.codeSide === 'before' ? change?.oldString : change?.newString;
    if (side !== undefined) {
      if (exhibit.startLine !== undefined || exhibit.endLine !== undefined) {
        const lines = side.split('\n');
        const start = exhibit.startLine ?? 1;
        const end = exhibit.endLine ?? lines.length;
        if (start >= 1 && end <= lines.length && start <= end) {
          text = lines.slice(start - 1, end).join('\n');
        }
      } else {
        text = side;
      }
    }
  }

  if (text !== undefined && (await sha256Hex(text)) === exhibit.selectedContentHash) {
    return { status: 'ok', text };
  }
  return { status: 'source_mismatch', cachedText: exhibit.selectedText };
}

/** Case state per anchor stableKey, for browser chips and filters. */
export async function getCaseStatesByAnchor(): Promise<Map<string, CaseState>> {
  const cases = await listInvestigationCases();
  const map = new Map<string, CaseState>();
  for (const c of cases) {
    if (c.primaryAnchorStableKey) map.set(c.primaryAnchorStableKey, c.state);
    for (const linked of c.linkedAnchorStableKeys) {
      if (!map.has(linked)) map.set(linked, c.state);
    }
  }
  return map;
}

async function requireAnchorInCaseConversation(
  stableKey: string,
  caseRow: InvestigationCase
): Promise<InvestigationAnchor> {
  const anchor = await getInvestigationAnchor(stableKey);
  if (!anchor) throw new Error(`Anchor not found: ${stableKey}`);
  if (anchor.conversationId !== caseRow.conversationId) {
    throw new Error('Anchor belongs to a different source than this case');
  }
  return anchor;
}

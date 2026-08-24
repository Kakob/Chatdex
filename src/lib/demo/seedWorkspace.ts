import {
  associateConversationWithProject,
  bulkPutConversations,
  bulkPutMessages,
  db,
  putUnderstandingProject,
  storeRawSources,
} from '../db';
import { listPreparedChangesForProject } from '../db/preparedChanges';
import {
  completeQuestionInvestigation,
  confirmReviewScope,
  pinTranscriptExhibit,
  recordCaseSearch,
  startQuestionInvestigation,
} from '../investigation/cases';
import {
  createInvestigationFinding,
  finalizeInvestigationFinding,
  promoteFindingToCurrentUnderstanding,
} from '../investigation/findings';
import {
  createPreparedChange,
  markPreparedChangeReady,
  updatePreparedChangeDraft,
} from '../prepare/changes';
import type { StoredConversation, StoredMessage } from '../../types';
import type {
  InvestigationFinding,
  InvestigationFindingType,
  VerdictConfidence,
} from '../../types/investigation';

export const SAMPLE_PROJECT_ID = 'sample-slop-connoisseur-v1';
const SAMPLE_CONVERSATION_ID = 'sample-slop-judging-history-v1';
const SAMPLE_QUESTION =
  'Should Slop Connoisseur use contestant-specific judging rather than one universal judge?';
const SAMPLE_CHANGE_TITLE = 'Contestant-judged solo round';

const baseTime = new Date('2026-08-18T18:00:00.000Z');
const atMinute = (minute: number) => new Date(baseTime.getTime() + minute * 60_000);

const messageDrafts: Array<Pick<StoredMessage, 'sender' | 'text'>> = [
  {
    sender: 'user',
    text: 'One universal judge would teach every contestant to optimize for the same taste. I want judging to stay plural: each contestant should score the responses they receive against a short rubric.',
  },
  {
    sender: 'assistant',
    text: 'Contestant-specific ballots preserve multiple perspectives, but we should separate a judge’s identity from the response author during scoring.',
  },
  {
    sender: 'user',
    text: 'Yes. Keep response authors hidden until every eligible ballot is submitted. A contestant must not see running totals or other ballots.',
  },
  {
    sender: 'assistant',
    text: 'That adds a clear reveal constraint. The aggregation rule is still open: median, trimmed mean, or pairwise ranking handle outliers and ties differently.',
  },
  {
    sender: 'user',
    text: 'Leave aggregation as an explicit implementation choice. For the first change, success means every eligible contestant casts one complete ballot and results reveal only after the judging window closes.',
  },
  {
    sender: 'assistant',
    text: 'Then the bounded change is the ballot and reveal workflow; matchmaking, prompt generation, and the final tie-break algorithm are non-goals.',
  },
];

const sampleMessages: StoredMessage[] = messageDrafts.map((message, index) => ({
  id: `sample-slop-message-${index + 1}`,
  conversationId: SAMPLE_CONVERSATION_ID,
  sender: message.sender,
  text: message.text,
  createdAt: atMinute(index * 2),
}));

const sampleConversation: StoredConversation = {
  id: SAMPLE_CONVERSATION_ID,
  source: 'chatgpt',
  name: '[Sample] Judging model design history',
  summary: 'Synthetic product discussion used to demonstrate evidence-backed project work.',
  createdAt: baseTime,
  updatedAt: sampleMessages.at(-1)?.createdAt ?? baseTime,
  importedAt: baseTime,
  messageCount: sampleMessages.length,
  userMessageCount: sampleMessages.filter((message) => message.sender === 'user').length,
  assistantMessageCount: sampleMessages.filter((message) => message.sender === 'assistant').length,
  estimatedTokens: 220,
  fullText: sampleMessages.map((message) => message.text).join('\n\n'),
  providerMeta: {
    sampleWorkspace: 'slop-connoisseur-v1',
    disclosure: 'Privacy-safe synthetic sample; not imported user data.',
  },
};

interface SampleFindingSpec {
  stepIndex: number;
  type: InvestigationFindingType;
  title: string;
  body: string;
  confidence: VerdictConfidence;
}

const findingSpecs: SampleFindingSpec[] = [
  {
    stepIndex: 0,
    type: 'belief',
    title: 'Contestant-specific judging preserves plural taste',
    body: 'The game should not train every contestant to optimize for one evaluator’s preferences.',
    confidence: 'high',
  },
  {
    stepIndex: 2,
    type: 'constraint',
    title: 'Ballots and response authors stay hidden until judging closes',
    body: 'No eligible contestant sees identities, running totals, or other ballots before submitting.',
    confidence: 'high',
  },
  {
    stepIndex: 4,
    type: 'decision',
    title: 'Bound the first change to ballot collection and delayed reveal',
    body: 'Aggregation can remain an explicit implementation choice while the ballot workflow ships.',
    confidence: 'high',
  },
  {
    stepIndex: 3,
    type: 'question',
    title: 'Which aggregation rule should combine contestant ballots?',
    body: 'Median, trimmed mean, and pairwise ranking handle outliers and ties differently.',
    confidence: 'medium',
  },
];

export async function isSampleWorkspaceLoaded(): Promise<boolean> {
  return Boolean(await db.understandingProjects.get(SAMPLE_PROJECT_ID));
}

/**
 * Load a privacy-safe sample through the same source, investigation,
 * understanding, and preparation services used by real work. Deterministic
 * source IDs and title lookups make repeated calls idempotent.
 */
export async function seedSampleWorkspace(): Promise<{ projectId: string; created: boolean }> {
  const existingProject = await db.understandingProjects.get(SAMPLE_PROJECT_ID);
  if (!existingProject) {
    await putUnderstandingProject({
      id: SAMPLE_PROJECT_ID,
      name: 'Slop Connoisseur · sample',
      description:
        'Privacy-safe synthetic workspace demonstrating evidence-backed product change preparation.',
      origin: 'user',
      reviewState: 'accepted',
      createdAt: baseTime,
      updatedAt: baseTime,
    });
  }

  if (!(await db.conversations.get(SAMPLE_CONVERSATION_ID))) {
    await bulkPutConversations([sampleConversation]);
    await bulkPutMessages(sampleMessages);
  }
  await storeRawSources([
    {
      kind: 'chatgpt',
      filename: 'slop-connoisseur-sample-history.json',
      rawText: JSON.stringify(
        {
          sample: true,
          disclosure: 'Synthetic content created solely for the Chatdex product demo.',
          messages: sampleMessages.map(({ sender, text, createdAt }) => ({
            sender,
            text,
            createdAt: createdAt.toISOString(),
          })),
        },
        null,
        2
      ),
      parserVersion: 'sample-workspace-v1',
      conversationIds: [SAMPLE_CONVERSATION_ID],
    },
  ]);
  await associateConversationWithProject(SAMPLE_PROJECT_ID, SAMPLE_CONVERSATION_ID);

  const existingCases = await db.investigationCases
    .where('projectId')
    .equals(SAMPLE_PROJECT_ID)
    .toArray();
  let investigation = existingCases.find(
    (candidate) => candidate.kind === 'question' && candidate.title === SAMPLE_QUESTION
  );
  if (!investigation) {
    investigation = await startQuestionInvestigation({
      projectId: SAMPLE_PROJECT_ID,
      conversationId: SAMPLE_CONVERSATION_ID,
      question: SAMPLE_QUESTION,
    });
  }

  const existingExhibits = await db.caseExhibits
    .where('caseId')
    .equals(investigation.id)
    .toArray();
  const exhibitByStep = new Map(existingExhibits.map((exhibit) => [exhibit.stepIndex, exhibit]));
  if (investigation.state === 'completed' && findingSpecs.some((spec) => !exhibitByStep.has(spec.stepIndex))) {
    throw new Error('The sample workspace is incomplete; reopen its investigation before repairing it');
  }
  for (const spec of findingSpecs) {
    if (exhibitByStep.has(spec.stepIndex)) continue;
    const text = sampleMessages[spec.stepIndex].text;
    const exhibit = await pinTranscriptExhibit(investigation.id, {
      stepIndex: spec.stepIndex,
      startOffset: 0,
      endOffset: text.length,
    });
    exhibitByStep.set(spec.stepIndex, exhibit);
  }

  if (!investigation.searchRecords.some((record) => record.query === 'universal judge')) {
    investigation = await recordCaseSearch(investigation.id, {
      query: 'universal judge',
      resultCount: 1,
    });
  }
  const scopes = await db.reviewScopes.where('caseId').equals(investigation.id).toArray();
  if (!scopes.some((scope) => scope.startStepIndex === 0 && scope.endStepIndex === 5)) {
    await confirmReviewScope(investigation.id, { startStepIndex: 0, endStepIndex: 5 });
  }

  const existingFindings = await db.investigationFindings
    .where('caseId')
    .equals(investigation.id)
    .toArray();
  const finalizedFindings: InvestigationFinding[] = [];
  for (const spec of findingSpecs) {
    let finding = existingFindings.find((candidate) => candidate.title === spec.title);
    if (!finding) {
      finding = await createInvestigationFinding({
        caseId: investigation.id,
        type: spec.type,
        title: spec.title,
        body: spec.body,
        confidence: spec.confidence,
        exhibitIds: [exhibitByStep.get(spec.stepIndex)!.id],
        reviewScopeIds: [],
      });
    }
    if (finding.state !== 'finalized') {
      finding = await finalizeInvestigationFinding(finding.id);
    }
    if (!finding.promotedUnderstandingObjectId) {
      await promoteFindingToCurrentUnderstanding(finding.id);
      finding = (await db.investigationFindings.get(finding.id))!;
    }
    finalizedFindings.push(finding);
  }

  if (investigation.state !== 'completed') {
    investigation = await completeQuestionInvestigation(investigation.id);
  }

  const understandingPointIds = finalizedFindings
    .map((finding) => finding.promotedUnderstandingObjectId)
    .filter((id): id is string => Boolean(id));
  const existingChanges = await listPreparedChangesForProject(SAMPLE_PROJECT_ID);
  let change = existingChanges.find((candidate) => candidate.title === SAMPLE_CHANGE_TITLE);
  if (!change) {
    change = await createPreparedChange({
      projectId: SAMPLE_PROJECT_ID,
      title: SAMPLE_CHANGE_TITLE,
      understandingPointIds,
    });
  }
  if (change.state === 'draft') {
    change = await updatePreparedChangeDraft(change.id, {
      desiredOutcome:
        'Replace the universal judge with one identity-hidden ballot from every eligible contestant, then reveal results only after judging closes.',
      rationale:
        'Contestant-specific evaluation preserves plural taste without allowing early ballots or identities to bias later judges.',
      constraints: [
        'Hide response authors during judging.',
        'Hide ballots and running totals until the judging window closes.',
        'Require one complete ballot from every eligible contestant.',
      ],
      nonGoals: [
        'Matchmaking or lobby design.',
        'Prompt generation.',
        'Choosing the final tie-break algorithm.',
      ],
      acceptanceCriteria: [
        'Every eligible contestant can submit exactly one complete ballot.',
        'No judge can see response authors, other ballots, or running totals before submission.',
        'Results become visible only after every eligible ballot arrives or the judging window closes.',
      ],
      openImplementationChoices: [
        'Median, trimmed mean, or pairwise aggregation.',
        'How incomplete ballots behave when the judging window expires.',
      ],
      repositoryRef: {
        implicatedPaths: [
          'src/judging/ballots',
          'src/judging/reveal',
          'src/judging/__tests__',
        ],
      },
    });
    await markPreparedChangeReady(change.id);
  }

  return { projectId: SAMPLE_PROJECT_ID, created: !existingProject };
}

// Project context injection for native chats (U5.2, PRD §17).
//
// Builds the system context for a project-scoped chat from the project's
// current understanding — the U4.2 living-document projection in agent-context
// mode (accepted objects only). The result is size-budgeted and always shown
// to the user in the chat UI: what the model was told is never invisible.

import { loadProjectUnderstanding, type CurrentUnderstanding } from '../understanding/currentUnderstanding';
import { renderLivingDocument } from '../understanding/livingDocument';
import { estimateTokens } from '../utils/tokens';
import type { UnderstandingProject } from '../../types/understanding';

export interface ChatContextConfig {
  /**
   * Budget for the injected context, in estimated tokens (chars/4). The
   * document shrinks in stages to fit — never the whole graph regardless.
   * Default 4000 (≈16k chars).
   */
  maxContextTokens?: number;
}

const DEFAULT_MAX_CONTEXT_TOKENS = 4000;

export interface ProjectChatContext {
  /** Full system message injected into completions. */
  systemPrompt: string;
  /** The understanding document inside it — what the context panel renders. */
  document: string;
  /** True when the document was reduced to fit the budget. */
  truncated: boolean;
  /** Estimated tokens of the injected system prompt. */
  estimatedTokens: number;
  projectName: string;
}

function wrap(projectName: string, document: string): string {
  return [
    `You are chatting inside Chatdex, the user's AI-conversation workspace. The user opened this chat from their project "${projectName}".`,
    `Below is Chatdex's current understanding of that project, synthesized from the user's own past AI conversations (footnotes cite the source conversations). Treat it as the user's prior thinking and current state — build on it rather than re-deriving it, and flag contradictions with it explicitly.`,
    'The user can see exactly this context in their chat UI. If asked what you were told, quote it freely.',
    '',
    '---',
    '',
    document,
  ].join('\n');
}

/**
 * Shrink stages, tried in order until the rendered document fits the budget:
 * full → without recent changes → capped lists → direction + questions only.
 * A final hard character cut guards pathological single-object sizes.
 */
function shrinkStages(understanding: CurrentUnderstanding): CurrentUnderstanding[] {
  const noChanges: CurrentUnderstanding = { ...understanding, recentChanges: [] };
  const capped: CurrentUnderstanding = {
    ...noChanges,
    ideasAndDecisions: noChanges.ideasAndDecisions.slice(0, 10),
    openQuestions: noChanges.openQuestions.slice(0, 10),
  };
  const minimal: CurrentUnderstanding = {
    ...capped,
    ideasAndDecisions: [],
    openQuestions: capped.openQuestions.slice(0, 5),
  };
  return [understanding, noChanges, capped, minimal];
}

const TRUNCATION_NOTE = '\n*…truncated to fit the chat context budget.*\n';

/**
 * Pure builder (exported for tests). Returns null when the project has no
 * accepted understanding to inject — the chat then runs context-free.
 */
export function buildProjectContext(
  project: UnderstandingProject,
  understanding: CurrentUnderstanding,
  config: ChatContextConfig = {}
): ProjectChatContext | null {
  const maxTokens = config.maxContextTokens ?? DEFAULT_MAX_CONTEXT_TOKENS;

  // Agent-context mode: accepted objects only, no generation stamp (stable
  // string for identical understanding).
  const render = (u: CurrentUnderstanding) =>
    renderLivingDocument(project, u, { includePending: false });

  const full = render(understanding);
  if (full.includes('*No understanding synthesized for this project yet.*')) {
    return null;
  }

  const stages = shrinkStages(understanding);
  let document = render(stages[stages.length - 1]);
  let truncated = true;
  for (const [i, stage] of stages.entries()) {
    const candidate = i === 0 ? full : render(stage);
    if (estimateTokens(wrap(project.name, candidate)) <= maxTokens) {
      document = candidate;
      truncated = i > 0;
      break;
    }
  }

  // Last resort: even the minimal stage is over budget — hard-cut the
  // document so the wrapped prompt fits.
  let systemPrompt = wrap(project.name, document);
  if (estimateTokens(systemPrompt) > maxTokens) {
    const wrapperChars = systemPrompt.length - document.length;
    const budgetChars = Math.max(200, maxTokens * 4 - wrapperChars - TRUNCATION_NOTE.length);
    document = document.slice(0, budgetChars) + TRUNCATION_NOTE;
    systemPrompt = wrap(project.name, document);
    truncated = true;
  }

  return {
    systemPrompt,
    document,
    truncated,
    estimatedTokens: estimateTokens(systemPrompt),
    projectName: project.name,
  };
}

/** Dexie-backed loader; null for unknown projects or empty understanding. */
export async function loadProjectChatContext(
  projectId: string,
  config: ChatContextConfig = {}
): Promise<ProjectChatContext | null> {
  const loaded = await loadProjectUnderstanding(projectId);
  if (!loaded || !loaded.project) return null;
  return buildProjectContext(loaded.project, loaded.understanding, config);
}

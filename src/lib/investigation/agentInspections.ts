// Deterministic agent-inspection derivation (SPEC-decision-recovery §8.1).
//
// One row per Read / Grep / Glob / LS tool call in the detection layer's
// normalized step stream — what the agent *saw*, the counterpart of the
// anchors' what it *changed*. Purely mechanical: no classification, no model.
// Ids reuse the anchor key scheme (`${sourceRef}#s${stepIndex}`), so a step
// that is an inspection and a step that is an anchor can never collide (a
// tool call is one or the other) and re-derivation is idempotent.
//
// Lives beside anchors.ts because it shares its substrate and source-ref
// logic. It is read by the recovery pipeline; nothing in Decision
// Investigation reads it (SPEC-decision-recovery law 2.5).

import { normalizeSession, type Step } from '../detection/normalize';
import { normalizePath } from '../detection/signatures';
import { db } from '../db/schema';
import { getMessagesForConversation } from '../db/messages';
import { replaceAgentInspections } from '../db/agentInspections';
import { getConversationSourceRef, type ConversationSourceRef } from './anchors';
import type { AgentInspection, AgentInspectionKind } from '../../types/decision';
import type { StoredConversation, StoredMessage } from '../../types/unified';

/** Bump whenever derivation output changes for identical input. */
export const INSPECTION_DERIVER_VERSION = '1.1.0';

const KIND_BY_TOOL: Record<string, AgentInspectionKind> = {
  Read: 'read',
  Grep: 'search',
  Glob: 'search',
  LS: 'list',
};

// Agents frequently read files through the shell instead of the Read tool
// (`sed -n 36,100p src/lib/db/conversations.ts`, `cat`, `grep -rn`). Those are
// inspections too. Recognized read-only commands and the kind they derive;
// anything else in a Bash call (including pipelines that write) is ignored.
const BASH_READ_COMMANDS: Record<string, AgentInspectionKind> = {
  cat: 'read', sed: 'read', head: 'read', tail: 'read', less: 'read', more: 'read', bat: 'read', wc: 'read',
  grep: 'search', rg: 'search', ag: 'search', ack: 'search',
  ls: 'list', find: 'list', tree: 'list',
};
const PATH_TOKEN_RE = /^(?:\.{1,2}\/|\/|[\w@-][\w@.-]*\/)[\w@./-]*[\w@-]$|^[\w@.-]+\.[A-Za-z0-9]{1,8}$/;
const WRITE_MARKERS = /(^|[\s;&|])(rm|mv|cp|touch|tee|sed\s+-i|npm|npx|git\s+(add|commit|checkout|push|reset|rebase|merge)|python3?|node|>{1,2})(\s|$)/;

/** Exposed for tests: the file inspections one shell command line implies. */
export function bashInspections(command: string): Array<{ kind: AgentInspectionKind; path?: string; pattern?: string }> {
  const out: Array<{ kind: AgentInspectionKind; path?: string; pattern?: string }> = [];
  // Split on command separators; a heredoc or subshell is treated as one opaque segment.
  for (const rawSegment of command.split(/\s*(?:&&|\|\||;|\n)\s*/)) {
    const segment = rawSegment.trim();
    if (!segment || WRITE_MARKERS.test(segment)) continue;
    // Pipelines: inspect every stage that is a read command.
    for (const stage of segment.split('|')) {
      const tokens = tokenize(stage.trim());
      if (tokens.length === 0) continue;
      let i = 0;
      if (tokens[i] === 'cd' && tokens.length > 2) i = 2; // `cd dir && …` handled by split; `cd x; cat y` too
      const cmd = tokens[i]?.replace(/^.*\//, '');
      const kind = cmd ? BASH_READ_COMMANDS[cmd] : undefined;
      if (!kind) continue;
      const args = tokens.slice(i + 1);
      const positional = args.filter((t) => !t.startsWith('-'));
      // grep/ls take bare directory names (`grep -rn x src`); reads keep only
      // path-like tokens so sed scripts and head counts are never paths.
      const bareOrPath = (t: string) => PATH_TOKEN_RE.test(t) || (/^[\w@.-]+$/.test(t) && !/^\d+$/.test(t));
      if (kind === 'search') {
        const pattern = positional[0];
        const paths = positional.slice(1).filter(bareOrPath);
        if (paths.length === 0) out.push({ kind, pattern });
        for (const p of paths) out.push({ kind, pattern, path: p });
      } else if (kind === 'list') {
        const paths = positional.filter(bareOrPath);
        if (paths.length === 0) out.push({ kind, path: '.' });
        for (const p of paths) out.push({ kind, path: p });
      } else {
        for (const p of positional.filter((t) => PATH_TOKEN_RE.test(t))) out.push({ kind, path: p });
      }
    }
  }
  return out;
}

function tokenize(stage: string): string[] {
  const tokens: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  for (const m of stage.matchAll(re)) tokens.push(m[1] ?? m[2] ?? m[3]);
  return tokens;
}

export async function deriveAgentInspectionsForConversation(
  conversationId: string
): Promise<AgentInspection[]> {
  const conversation = await db.conversations.get(conversationId);
  const messages = await getMessagesForConversation(conversationId);
  const rows = buildAgentInspections(
    conversationId,
    messages,
    await getConversationSourceRef(conversationId),
    rootsFor(conversation)
  );
  await replaceAgentInspections(conversationId, rows);
  return rows;
}

/** Working-directory roots used to make absolute tool paths repo-relative. */
export function rootsFor(conversation: StoredConversation | undefined): string[] {
  if (!conversation) return [];
  return [conversation.projectPath, conversation.workingDirectory].filter(
    (r): r is string => Boolean(r)
  );
}

/** Pure derivation over stored messages (exposed for tests and the pipeline). */
export function buildAgentInspections(
  conversationId: string,
  messages: StoredMessage[],
  source: ConversationSourceRef,
  roots: string[]
): AgentInspection[] {
  const { steps } = normalizeSession(conversationId, messages);
  const messageById = new Map(messages.map((m) => [m.id, m]));
  const now = new Date();
  const out: AgentInspection[] = [];
  for (const step of inspectionSteps(steps)) {
    const input = step.toolInput ?? {};
    const occurredAt = messageById.get(step.messageId)?.createdAt ?? now;
    if (step.toolName === 'Bash') {
      const found = bashInspections(str(input.command) ?? '');
      found.forEach((f, i) => {
        out.push({
          id: `${source.ref}#s${step.index}${i > 0 ? `.${i}` : ''}`,
          conversationId,
          messageId: step.messageId,
          stepIndex: step.index,
          toolName: 'Bash',
          kind: f.kind,
          path: f.path ? relativize(normalizePath(f.path), roots) : undefined,
          pattern: f.pattern,
          occurredAt,
          deriverVersion: INSPECTION_DERIVER_VERSION,
        });
      });
      continue;
    }
    const kind = KIND_BY_TOOL[step.toolName!];
    const rawPath = str(input.file_path) ?? str(input.path);
    out.push({
      id: `${source.ref}#s${step.index}`,
      conversationId,
      messageId: step.messageId,
      stepIndex: step.index,
      toolName: step.toolName!,
      kind,
      path: rawPath ? relativize(normalizePath(rawPath), roots) : undefined,
      pattern: str(input.pattern),
      occurredAt,
      deriverVersion: INSPECTION_DERIVER_VERSION,
    });
  }
  return out;
}

/** Which steps derive an inspection, without persistence. */
export function inspectionSteps(steps: Step[]): Step[] {
  return steps.filter(
    (s) =>
      s.kind === 'tool_call' &&
      Boolean(s.toolName && (KIND_BY_TOOL[s.toolName] || (s.toolName === 'Bash' && bashInspections(str(s.toolInput?.command) ?? '').length > 0)))
  );
}

/** Strip a known root prefix; keep already-relative paths; otherwise keep the absolute path. */
export function relativize(path: string, roots: string[]): string {
  if (!path.startsWith('/')) return path.replace(/^\.\//, '');
  for (const root of roots) {
    const r = normalizePath(root).replace(/\/+$/, '');
    if (r && path.startsWith(`${r}/`)) return path.slice(r.length + 1);
  }
  return path;
}

export interface InspectionBackfillResult {
  conversationsProcessed: number;
  inspectionsDerived: number;
  failures: number;
}

/** Idempotent backfill over every stored Claude Code session. */
export async function deriveAgentInspectionsForAllAgentSessions(
  onProgress?: (progress: { current: number; total: number }) => void
): Promise<InspectionBackfillResult> {
  const ids = (await db.conversations.where('source').equals('claude-code').primaryKeys()) as string[];
  let inspectionsDerived = 0;
  let failures = 0;
  for (let i = 0; i < ids.length; i++) {
    onProgress?.({ current: i + 1, total: ids.length });
    try {
      inspectionsDerived += (await deriveAgentInspectionsForConversation(ids[i])).length;
    } catch (err) {
      failures++;
      console.error('[decisions] inspection derivation failed for', ids[i], err);
    }
  }
  return { conversationsProcessed: ids.length, inspectionsDerived, failures };
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

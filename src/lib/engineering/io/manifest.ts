// Parse and validate an evidence manifest (chatdex.engineering.evidence/v1)
// before import. Validation refuses anything that cannot be tied to a
// specific revision of the bound repository, or that claims to implement a
// proposal from a different base. It never edits the manifest.

import {
  EVIDENCE_SCHEMA,
  type ContractChangeProposal,
  type EngineeringEvidenceRun,
  type EngineeringProjectRecord,
  type EvidenceManifest,
  type ManifestSymbol,
  type ManifestTest,
} from '../../../types/engineering';

export const SHA_PATTERN = /^[0-9a-f]{40}$/;
const TEST_STATUSES = new Set(['passed', 'failed', 'skipped', 'todo']);

export type ParseResult = { ok: true; manifest: EvidenceManifest } | { ok: false; errors: string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): value is string {
  return typeof value === 'string';
}

function strArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(str);
}

export function parseManifest(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, errors: ['Not valid JSON'] };
  }
  const errors: string[] = [];
  if (!isRecord(raw)) return { ok: false, errors: ['Manifest must be a JSON object'] };
  if (raw.schema !== EVIDENCE_SCHEMA) errors.push(`Unknown schema ${JSON.stringify(raw.schema)}; expected ${EVIDENCE_SCHEMA}`);

  const repository = raw.repository;
  if (!isRecord(repository) || !str(repository.remote) || !str(repository.root)) {
    errors.push('repository.remote and repository.root are required');
  }
  const revision = raw.revision;
  if (!isRecord(revision) || !str(revision.sha) || typeof revision.dirty !== 'boolean') {
    errors.push('revision.sha and revision.dirty are required');
  } else {
    if (!SHA_PATTERN.test(revision.sha)) errors.push('revision.sha must be a full 40-character commit sha');
    if (revision.baseSha !== undefined && (!str(revision.baseSha) || !SHA_PATTERN.test(revision.baseSha))) {
      errors.push('revision.baseSha must be a full 40-character commit sha when present');
    }
  }
  if (!str(raw.command)) errors.push('command is required');
  if (!str(raw.capturedAt) || Number.isNaN(Date.parse(raw.capturedAt))) errors.push('capturedAt must be an ISO timestamp');
  if (raw.changedPaths !== undefined && !strArray(raw.changedPaths)) errors.push('changedPaths must be a list of paths');
  if (raw.uncommittedPaths !== undefined && !strArray(raw.uncommittedPaths)) errors.push('uncommittedPaths must be a list of paths');

  const tests: ManifestTest[] = [];
  if (!Array.isArray(raw.tests)) errors.push('tests must be a list');
  else
    raw.tests.forEach((t, i) => {
      if (
        !isRecord(t) ||
        !(t.id === null || str(t.id)) ||
        !str(t.name) ||
        !str(t.file) ||
        !str(t.status) ||
        !TEST_STATUSES.has(t.status)
      ) {
        errors.push(`tests[${i}] is malformed`);
        return;
      }
      tests.push({
        id: t.id as string | null,
        name: t.name,
        file: t.file,
        status: t.status as ManifestTest['status'],
        durationMs: typeof t.durationMs === 'number' ? t.durationMs : 0,
        ...(str(t.failureMessage) ? { failureMessage: t.failureMessage } : {}),
      });
    });

  const symbols: ManifestSymbol[] = [];
  if (!Array.isArray(raw.symbols)) errors.push('symbols must be a list');
  else
    raw.symbols.forEach((s, i) => {
      if (
        !isRecord(s) ||
        !str(s.path) ||
        !str(s.symbol) ||
        typeof s.startLine !== 'number' ||
        typeof s.endLine !== 'number' ||
        !str(s.sha256)
      ) {
        errors.push(`symbols[${i}] is malformed`);
        return;
      }
      symbols.push({ path: s.path, symbol: s.symbol, startLine: s.startLine, endLine: s.endLine, sha256: s.sha256 });
    });

  const notes = Array.isArray(raw.notes)
    ? raw.notes.flatMap((n) => (isRecord(n) && str(n.text) ? [{ text: n.text, source: 'agent-reported' as const }] : []))
    : [];

  if (errors.length > 0 || !isRecord(repository) || !isRecord(revision)) return { ok: false, errors };

  const environment: Record<string, string> = {};
  if (isRecord(raw.environment)) {
    for (const [key, value] of Object.entries(raw.environment)) if (str(value)) environment[key] = value;
  }

  return {
    ok: true,
    manifest: {
      schema: EVIDENCE_SCHEMA,
      repository: { remote: repository.remote as string, root: repository.root as string },
      revision: {
        sha: revision.sha as string,
        dirty: revision.dirty as boolean,
        ...(str(revision.dirtyScope) ? { dirtyScope: revision.dirtyScope } : {}),
        ...(str(revision.branch) ? { branch: revision.branch } : {}),
        ...(str(revision.baseSha) ? { baseSha: revision.baseSha } : {}),
      },
      changedPaths: strArray(raw.changedPaths) ? raw.changedPaths : [],
      uncommittedPaths: strArray(raw.uncommittedPaths) ? raw.uncommittedPaths : [],
      command: raw.command as string,
      environment,
      capturedAt: raw.capturedAt as string,
      tests,
      symbols,
      notes,
    },
  };
}

export interface ImportContext {
  project: EngineeringProjectRecord;
  existingRuns: EngineeringEvidenceRun[];
  digest: string;
  /** Present when importing as the implementation of a proposal. */
  proposal?: ContractChangeProposal;
}

/** Returns refusal reasons; empty means the manifest may be imported. */
export function checkImport(manifest: EvidenceManifest, ctx: ImportContext): string[] {
  const refusals: string[] = [];
  const normalize = (url: string) => url.replace(/\.git$/, '').replace(/\/+$/, '').toLowerCase();
  if (normalize(manifest.repository.remote) !== normalize(ctx.project.repository.remote)) {
    refusals.push(`Evidence is from ${manifest.repository.remote}, not this project's repository ${ctx.project.repository.remote}`);
  }
  if (manifest.repository.root !== ctx.project.repository.root) {
    refusals.push(`Evidence covers ${manifest.repository.root}, not ${ctx.project.repository.root}`);
  }
  if (ctx.existingRuns.some((r) => r.digest === ctx.digest)) {
    refusals.push('This exact evidence file was already imported');
  }
  if (ctx.proposal) {
    const { proposal } = ctx;
    if (proposal.state !== 'approved') {
      refusals.push(`Implementation evidence can only be attached to an approved proposal (this one is ${proposal.state})`);
    } else if (!manifest.revision.baseSha) {
      refusals.push(`Evidence does not say which base it was built on; recapture with --base ${proposal.baseSha}`);
    } else if (manifest.revision.baseSha !== proposal.baseSha) {
      refusals.push(
        `Evidence was built on ${manifest.revision.baseSha.slice(0, 12)}, but the approved change starts from ${proposal.baseSha?.slice(0, 12)}`
      );
    } else if (manifest.revision.sha === proposal.baseSha) {
      refusals.push('Evidence is at the base revision itself, so it contains no implementation');
    }
  }
  return refusals;
}

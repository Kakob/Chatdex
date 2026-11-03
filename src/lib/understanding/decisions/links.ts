// Link builders for decision surfaces (SPEC-decision-recovery §10.5). Kept out
// of component modules so React Fast Refresh sees component-only files.

import { blobUrl } from '../../github/client';
import { parseRepoKey } from '../../repo/sources';
import type { CodeEvidence } from '../../../types/intentTrace';

/** GitHub blob URL at the pinned sha, or null for local / malformed / unpinned snapshots. */
export function safeBlobUrl(repoKey: string | undefined, sha: string | undefined, ev: CodeEvidence): string | null {
  if (!repoKey || !sha || sha === 'local') return null;
  const parsed = parseRepoKey(repoKey);
  if (!parsed || parsed.kind !== 'gh') return null;
  try {
    return blobUrl(parsed.owner, parsed.repo, sha, ev.path, ev.startLine, ev.endLine);
  } catch {
    return null;
  }
}

import type { DecisionRow } from './decisionMatrix';

export const PAGE_SIZE = 40;
export function normalizedPath(path?: string) {
  return path?.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+/g, '/') || 'No file recorded';
}
export function evidenceCue(row: DecisionRow) {
  const spans = row.latestTrace?.transcriptEvidence ?? [];
  const cues = [];
  if (spans.some((s) => s.role === 'user_msg')) cues.push('User quote');
  if (spans.some((s) => s.role === 'agent_text')) cues.push('Agent quote');
  if (spans.some((s) => s.role === 'tool_call' || s.role === 'tool_result')) cues.push('Tool quote');
  if (row.latestTrace?.implEvidence.length || row.latestTrace?.anchorStableKeys.length) cues.push('Code evidence');
  return cues.join(' · ') || (row.meta.source === 'investigation' ? 'Human investigation' : 'No trace quotes available');
}


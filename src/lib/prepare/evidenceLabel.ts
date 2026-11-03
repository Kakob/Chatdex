// Short human label for an evidence item (SPEC-change-workspace §8 rendering).
import type { EvidenceItem } from '../../types/evidence';

export function evidenceLabel(item: EvidenceItem): string {
  switch (item.kind) {
    case 'code':
      return `${item.path}:${item.startLine}${item.endLine > item.startLine ? `–${item.endLine}` : ''}`;
    case 'test_runtime':
      return `${item.source === 'transcript' ? 'transcript' : 'manual'} · ${item.outcome}${item.command ? ` · ${item.command}` : ''}`;
    case 'intent_history':
      return `${item.source}${item.commitSha ? ` ${item.commitSha.slice(0, 7)}` : ''}${item.path ? ` ${item.path}` : ''}`;
    case 'human_hypothesis':
      return 'hypothesis';
    case 'ai_inference':
      return `AI: ${item.text.slice(0, 60)}${item.text.length > 60 ? '…' : ''}`;
  }
}


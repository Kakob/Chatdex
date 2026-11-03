// Structured criteria from a lines textarea (SPEC-change-workspace §7.1; CW-6).
import type { Criterion } from '../../types/preparedChange';

const lines = (value: string) => value.split('\n').map((l) => l.trim()).filter(Boolean);

/** Keep criterion ids stable across edits so verification rows survive a reword-free save. */
export function criteriaFromLines(text: string, existing: Criterion[] | undefined): Criterion[] {
  const byText = new Map((existing ?? []).map((c) => [c.text, c]));
  return lines(text).map((t) => byText.get(t) ?? { id: '', text: t, createdAt: '' });
}


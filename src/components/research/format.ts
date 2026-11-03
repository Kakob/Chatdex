import type { ResearchTime } from '../../types/research';
export const timeLabel = (t: ResearchTime) => `${t.value || 'unknown'} (${t.precision})`;
export function download(name: string, text: string, type: string) { const url = URL.createObjectURL(new Blob([text], { type })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }

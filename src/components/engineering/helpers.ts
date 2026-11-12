export function shortSha(sha: string | undefined): string {
  return sha ? sha.slice(0, 12) : '—';
}

export function downloadText(fileName: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

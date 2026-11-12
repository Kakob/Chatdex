/** Shared mobile-first code inspector for real checked-in source text. */
import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { button, muted } from './ui';

export function SourceExcerpt({ source, needle, title }: { source: {path: string; text: string; repoPath: string}; needle: string; title: string }) {
  const [full, setFull] = useState(false);
  // Default to a readable phone-sized column; unwrapped mode is opt-in.
  const [wrapLines, setWrapLines] = useState(true);
  const file = source;
  const lines = file.text.split('\n');
  const match = lines.findIndex((line) => line.includes(needle));
  const from = full ? 0 : Math.max(0, match - 4);
  const to = full ? lines.length : Math.min(lines.length, Math.max(0, match) + 22);
  const githubUrl = 'https://github.com/Kakob/Chatdex/blob/feature/engineering-live-projects/' + file.repoPath +
    (match >= 0 ? '#L' + (match + 1) : '');

  return (
    <div className="min-w-0 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={'min-w-0 break-all text-xs ' + muted}>{title} · {file.path}</p>
        <a className="inline-flex items-center gap-1 text-xs font-medium text-violet-700 underline dark:text-violet-300" href={githubUrl} target="_blank" rel="noreferrer">
          GitHub <ExternalLink size={12} />
        </a>
      </div>
      <div
        className={'max-w-full rounded-lg border border-gray-700 bg-gray-950 text-gray-100 ' + (wrapLines ? 'overflow-x-hidden' : 'overflow-x-auto')}
        aria-label={title + ' excerpt'}
        data-testid="source-viewport"
        data-wrap={wrapLines ? 'on' : 'off'}
      >
        <pre className={'p-3 font-mono text-[11px] leading-5 ' + (wrapLines ? 'w-full min-w-0' : 'w-max min-w-full')}>
          <code className="block">
            {lines.slice(from, to).map((line, i) => {
              const n = from + i + 1;
              return (
                <span key={n} className={'grid ' + (wrapLines ? 'grid-cols-[2.25rem_minmax(0,1fr)]' : 'grid-cols-[2.25rem_max-content]') + (n === match + 1 ? ' bg-violet-900/70' : '')}>
                  <span aria-hidden="true" className="select-none pr-2 text-right text-gray-500">{n}</span>
                  <span className={'min-w-0 ' + (wrapLines ? 'whitespace-pre-wrap [overflow-wrap:anywhere]' : 'whitespace-pre')}>{line || ' '}</span>
                </span>
              );
            })}
          </code>
        </pre>
      </div>
      {match < 0 && <p role="alert" className="text-xs text-amber-700 dark:text-amber-300">This authored entry point was not found in the bundled source.</p>}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={button} onClick={() => setFull(!full)}>
          {full ? 'Show relevant excerpt' : 'View full file'}
        </button>
        <button type="button" className={button} aria-pressed={wrapLines} onClick={() => setWrapLines((value) => !value)}>
          {wrapLines ? 'Wrap lines ✓' : 'Wrap lines'}
        </button>
      </div>
    </div>
  );
}


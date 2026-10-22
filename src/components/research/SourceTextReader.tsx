import { useState } from 'react';
import type { ResearchSnapshot } from '../../types/research';
import { Field, inputClass } from './shared';

/** Reading a stored snapshot does not require creating an investigation. */
export function SourceTextReader({ versions }: { versions: ResearchSnapshot[] }) {
  const [selected, setSelected] = useState('');
  const ordered = [...versions].sort((a, b) => b.importedAt.getTime() - a.importedAt.getTime());
  const snapshot = ordered.find(v => v.id === selected) ?? ordered[0];
  if (!snapshot) return null;
  return <details className="py-2">
    <summary className="cursor-pointer font-medium text-violet-600 dark:text-violet-300">Read imported text</summary>
    <div className="space-y-3 mt-3">
      <Field label="Stored version"><select className={inputClass} value={snapshot.id} onChange={e => setSelected(e.target.value)}>
        {ordered.map(v => <option key={v.id} value={v.id}>{v.filename} · {v.importedAt.toLocaleString()}</option>)}
      </select></Field>
      <p className="text-xs text-gray-500">Local snapshot · {snapshot.text.length.toLocaleString()} characters. To pin passages, start an investigation above and attach this source.</p>
      <pre aria-label="Imported document text" tabIndex={0} className="max-h-[65vh] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-gray-200 dark:border-gray-700 p-5 font-sans text-base leading-7">{snapshot.text}</pre>
    </div>
  </details>;
}

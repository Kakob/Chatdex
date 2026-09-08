import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getInvestigationAnchor } from '../../lib/db/investigationAnchors';
import type { InvestigationAnchor } from '../../types/investigation';
import { Quote } from './EvidenceLists';

/** Mounted only when code evidence is expanded. Reads existing anchors; never derives or writes them. */
export function RecordedEdits({ keys, projectId }: { keys: string[]; projectId: string }) {
  const [anchors, setAnchors] = useState<Array<InvestigationAnchor | undefined>>();
  const [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void Promise.all(keys.map(getInvestigationAnchor)).then((found) => {
      if (!cancelled) setAnchors(found);
    }).catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [keys]);
  if (error) return <p className="text-xs">Could not load saved edits. Try reopening this candidate.</p>;
  if (!anchors) return <p className="text-xs">Loading saved edits…</p>;
  return <div className="mt-2 space-y-3">{anchors.map((anchor, i) => anchor ? <div key={anchor.id}>
    <Link target="_blank" rel="noopener noreferrer" className="text-xs text-violet-600 break-all" to={`/projects/${projectId}/investigate/${encodeURIComponent(anchor.id)}`}>{anchor.toolName} · step {anchor.stepIndex} · {anchor.filePaths.join(', ')} ↗</Link>
    {anchor.fileChanges.map((change) => <div key={`${change.path}-${change.changeIndex}`}>
      {change.oldString !== undefined && <Quote text={`Before\n${change.oldString.slice(0, 3000)}`} />}
      <Quote text={`After\n${change.newString.slice(0, 3000)}`} />
      {Math.max(change.oldString?.length ?? 0, change.newString.length) > 3000 && <p className="text-xs text-gray-500">Preview capped at 3,000 characters per side. Open the edit for the full hunk.</p>}
    </div>)}
  </div> : <p key={keys[i]} className="text-xs text-gray-500">This saved edit anchor is no longer available locally.</p>)}</div>;
}

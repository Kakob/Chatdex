// Change Workspace left rail (SPEC-change-workspace §14; CW-6): one entry per
// section with a completion / freeze indicator derived from the record and
// the editability table. Entries are in-page anchors (#ws-<section>).

import { CheckCircle2, Circle, Lock, MinusCircle } from 'lucide-react';
import { sectionEditability, type WorkspaceSection } from '../../lib/prepare/editability';
import { RAIL_SECTIONS, SECTION_LABEL, sectionAnchor, sectionProgress } from '../../lib/prepare/rail';
import type { PreparedChange } from '../../types/preparedChange';

export function WorkspaceRail({ change, active }: { change: PreparedChange; active?: WorkspaceSection }) {
  const progress = sectionProgress(change);
  const editability = sectionEditability(change);
  return (
    <nav aria-label="Workspace sections" className="sticky top-4 space-y-0.5 text-sm">
      {RAIL_SECTIONS.map((section) => {
        const state = progress[section];
        const frozen = editability[section] === 'frozen';
        const unavailable = editability[section] === 'unavailable';
        const Icon = state === 'done' ? CheckCircle2 : state === 'started' ? MinusCircle : Circle;
        return (
          <a
            key={section}
            href={`#${sectionAnchor(section)}`}
            aria-current={active === section ? 'location' : undefined}
            className={`flex items-center gap-2 px-2 py-1.5 rounded-lg ${
              active === section ? 'bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-300' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
            } ${unavailable ? 'opacity-50' : ''}`}
            data-testid={`rail-${section}`}
            data-progress={state}
          >
            <Icon size={14} className={state === 'done' ? 'text-emerald-500' : state === 'started' ? 'text-amber-500' : 'text-gray-300 dark:text-gray-600'} />
            <span className="flex-1">{SECTION_LABEL[section]}</span>
            {frozen && <Lock size={11} className="text-gray-400" aria-label="frozen" />}
          </a>
        );
      })}
    </nav>
  );
}

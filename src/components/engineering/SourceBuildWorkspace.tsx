/**
 * One editing surface for human-written and agent-produced full-file revisions.
 * The source editor intentionally never evaluates pasted TypeScript or
 * pretends it has been compiled. A local write is a separate explicit action.
 */
import { useState } from 'react';
import { Bot, Check, ClipboardCopy, Code2, GitCompare, Pencil, Save } from 'lucide-react';
import { stageCodeRevision, sourceRevisionLabel } from '../../lib/engineering/codingStore';
import {
  chatGptHandoff, manualCoding, summarizeCodeDiff,
  type CodingActor, type SourceEditProposal,
} from '../../lib/engineering/codingProtocol';
import { canWriteLocalWorkingTree, writeRevisionToPickedFolder, type DirectoryPicker } from '../../lib/engineering/localWorkspaceWriter';
import type { ProjectEngineeringModel } from '../../lib/engineering/modelStore';
import type { EngineeringSourceBinding } from '../../lib/engineering/sourceCatalog';
import { button, field, muted, primaryButton } from './ui';

export function SourceBuildWorkspace({
  model, binding, originalText, targetName, onRefresh,
}: {
  model: ProjectEngineeringModel;
  binding: EngineeringSourceBinding;
  originalText: string;
  targetName: string;
  onRefresh?: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [actor, setActor] = useState<CodingActor>('human');
  const [intent, setIntent] = useState('');
  /** Freeze the source baseline while editing; a refresh cannot silently overwrite the draft. */
  const [editorBase, setEditorBase] = useState(originalText);
  const [edited, setEdited] = useState(originalText);
  const [handoffVisible, setHandoffVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [staged, setStaged] = useState<SourceEditProposal | null>(null);

  const relevant = model.codeRevisions
    .filter((revision) => revision.bindingId === binding.id)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const latest = staged ?? relevant[0] ?? null;
  const receipt = latest ? model.codeWrites.filter((w) => w.revisionId === latest.id) : [];
  const status = latest ? sourceRevisionLabel(latest, receipt, originalText) : null;
  const provider = actor === 'human' ? manualCoding : chatGptHandoff;
  const prompt = chatGptHandoff.makeInstructions({
    projectId: model.projectId, targetId: binding.targetId,
    targetName, binding, baselineText: originalText, intent: intent || '(describe your goal before sending)',
  });
  const diff = summarizeCodeDiff(editorBase, edited);
  const hasChange = edited !== editorBase;
  const staleEditor = editorBase !== originalText;
  const resetToCurrent = () => { setEditorBase(originalText); setEdited(originalText); setError(null); };

  const copy = async (value: string, message: string) => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard access unavailable; select and copy the text manually.');
      await navigator.clipboard.writeText(value);
      setNotice(message);
      setError(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  };

  const stage = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await stageCodeRevision({
        projectId: model.projectId, targetId: binding.targetId,
        bindingId: binding.id, baselineText: editorBase,
        proposedText: edited, intent, actor, providerId: provider.id,
      });
      setStaged(next);
      setNotice('Revision staged locally. This is not a code write or verified behavior.');
      await onRefresh?.();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!latest) return;
    if (!canWriteLocalWorkingTree()) {
      setError('Local directory writing is unavailable on this browser. Copy the complete edited file for your IDE or agent.');
      return;
    }
    if (!window.confirm('Write the staged complete file to a folder you explicitly select? The current file must exactly match the original baseline. This does not run tests or commit Git changes.')) return;
    setBusy(true);
    setError(null);
    try {
      const pick = (window as unknown as { showDirectoryPicker: DirectoryPicker }).showDirectoryPicker.bind(window);
      const applied = await writeRevisionToPickedFolder(latest, pick);
      setNotice('Wrote ' + applied.bytesWritten + ' bytes into the selected local file. Verification has not run. Reindex the changed source before accepting model understanding.');
      await onRefresh?.();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="Shared coding workspace" className="space-y-2 rounded-xl border border-violet-200 p-3 dark:border-violet-800">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Code2 size={16} className="text-violet-600" />
          <span className="text-sm font-semibold">Build through this model</span>
        </div>
        <button type="button" className={button} aria-expanded={open}
          onClick={() => setOpen((v) => !v)}>{open ? 'Close editor' : 'Open editor'}</button>
      </div>
      <p className={'text-xs leading-5 ' + muted}>
        Same source-revision pipeline for hand coding and agent results. Source files are linked to
        the selected model entity. Staging does not change your running app.
      </p>
      {latest && (
        <div className="rounded-lg border border-amber-200 p-2 text-xs dark:border-amber-800" aria-label="Linked code revision">
          <p className="font-semibold">Latest {latest.actor === 'agent' ? 'agent-result' : 'human'} revision: {status?.replaceAll('-', ' ')}</p>
          <p className={muted}>{latest.path} · {latest.intent}</p>
          <p className={muted}>Source changes are not verified by tests. An external write is not enough to establish behavior.</p>
        </div>
      )}
      {open && (
        <div className="space-y-3">
          <div role="group" aria-label="Coding mode" className="flex gap-2">
            <button type="button" className={(actor === 'human' ? primaryButton : button) + ' flex-1 justify-center'} aria-pressed={actor === 'human'} onClick={() => { setActor('human'); setHandoffVisible(false); }}>
              <Pencil size={14} /> Hand code
            </button>
            <button type="button" className={(actor === 'agent' ? primaryButton : button) + ' flex-1 justify-center'} aria-pressed={actor === 'agent'} onClick={() => { setActor('agent'); setHandoffVisible(true); }}>
              <Bot size={14} /> Agent result
            </button>
          </div>
          <label className="block text-xs font-medium">
            Engineering goal
            <textarea aria-label="Engineering goal" className={field + ' mt-1 min-h-16'} rows={2} maxLength={2000}
              placeholder="What should change in the software?" value={intent} onChange={(e) => setIntent(e.target.value)}/>
          </label>
          {actor === 'agent' && (
            <div className="space-y-2 rounded-lg bg-gray-50 p-2 dark:bg-gray-800/40">
              <p className={'text-xs leading-5 ' + muted}>
                For now, ChatGPT is the coding agent via a copied handoff. It is not running inside
                this browser. Return a complete changed file, then paste it below. Future agents
                can supply the same revision shape through a provider adapter.
              </p>
              <button type="button" className={button} onClick={() => setHandoffVisible((v) => !v)}>
                {handoffVisible ? 'Hide agent handoff' : 'Show agent handoff'}
              </button>
              {handoffVisible && (
                <div className="space-y-2">
                  <textarea aria-label="Agent handoff instructions" readOnly className={field + ' h-36 font-mono text-[11px]'} value={prompt}/>
                  <button type="button" className={button} onClick={() => void copy(prompt, 'Agent handoff copied. Paste it into your ChatGPT engineering conversation.')}>
                    <ClipboardCopy size={14}/> Copy agent instructions
                  </button>
                </div>
              )}
            </div>
          )}
          {staleEditor && (
            <p role="alert" className="rounded-md border border-amber-400 p-2 text-xs text-amber-800 dark:text-amber-200">
              Source changed since this editing session began. Copy your draft, reset to the current source, and reapply the edit before staging.
            </p>
          )}
          <label className="block text-xs font-medium">
            {actor === 'human' ? 'Edit or paste the complete source file' : 'Paste the complete file returned by the agent'}
            <textarea aria-label="Editable source file" className={field + ' mt-1 min-h-[220px] font-mono text-[12px] leading-5'}
              spellCheck={false} rows={14} value={edited} onChange={(e) => setEdited(e.target.value)} />
          </label>
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className={muted}>{edited.split('\n').length} lines · {new TextEncoder().encode(edited).length} bytes</span>
            <button type="button" className={button} onClick={resetToCurrent}>Reset editor to current source</button>
          </div>
          <div className="rounded-lg bg-gray-50 p-2 text-xs dark:bg-gray-800/40" aria-label="Code change summary">
            <p className="inline-flex items-center gap-1 font-semibold"><GitCompare size={14}/> Proposed source difference</p>
            <p className={'mt-1 ' + muted}>{hasChange ? '+' + diff.added + ' / -' + diff.removed + ' lines in the changed region' : 'No code changed yet'}</p>
            {hasChange && (
              <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px]">
                {diff.oldChangedLines.map((line) => '- ' + line).join('\n')}
                {'\n'}
                {diff.newChangedLines.map((line) => '+ ' + line).join('\n')}
              </pre>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={primaryButton} disabled={busy || staleEditor || !hasChange || !intent.trim()} onClick={() => void stage()}>
              <Save size={14}/> Stage revision
            </button>
            <button type="button" className={button} onClick={() => void copy(edited, 'Edited source copied for your IDE or coding agent.')}>
              <ClipboardCopy size={14}/> Copy complete code
            </button>
          </div>
          {latest && (
            <div className="space-y-1">
              <button type="button" disabled={busy || !canWriteLocalWorkingTree()} className={button} onClick={() => void apply()}>
                <Check size={14}/> Apply staged file to chosen local folder
              </button>
              <p className={'text-[11px] leading-4 ' + muted}>
                {canWriteLocalWorkingTree()
                  ? 'Desktop Chromium: explicitly pick a writable project folder; the existing file must match the staged source byte-for-byte. No Git commit or tests are automatic.'
                  : 'Local file writing is unsupported here (including iPhone Safari). Copy the code into your editor or use the agent handoff. Nothing is silently written.'}
              </p>
            </div>
          )}
        </div>
      )}
      {notice && <p role="status" className="text-xs text-emerald-700 dark:text-emerald-300">{notice}</p>}
      {error && <p role="alert" className="text-xs text-red-700 dark:text-red-300">{error}</p>}
    </section>
  );
}

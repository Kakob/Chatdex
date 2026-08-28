// Change Workspace — My Trace section (SPEC-change-workspace §10, §14; CW-2).
// An ordered list editor (no canvas in v1): main-sequence nodes, branch
// nodes, `???` unknown nodes, and one edge per adjacency. Every edge chip is
// DERIVED from the evidence attached to it (D4) — the only human override is
// "contradicted" with a note. Edits are local until "Save trace".

import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, GitBranch, HelpCircle, Loader2, Plus, Route, Save, Trash2 } from 'lucide-react';
import {
  EDGE_VERIFICATION_LABEL,
  TRACE_NODE_KINDS,
  addNode,
  addUnknownNode,
  deriveEdgeVerification,
  deriveNodeSupport,
  emptyTrace,
  incomingEdge,
  moveNode,
  orderedNodes,
  removeNode,
  traceSummary,
  updateEdge,
  updateNode,
  type EdgeVerification,
} from '../../lib/prepare/trace';
import { updateTrace } from '../../lib/prepare/lifecycle';
import { evidenceLabel } from '../../lib/prepare/evidenceLabel';
import { canAppend } from '../../lib/prepare/editability';
import { useToastStore } from '../../stores/toastStore';
import type { PreparedChange, TraceEdge, TraceNode, TraceNodeKind, WorkspaceTrace } from '../../types/preparedChange';
import type { EvidenceItem } from '../../types/evidence';

interface Props {
  change: PreparedChange;
  onChanged: (change: PreparedChange) => Promise<void>;
}

const CHIP: Record<EdgeVerification, string> = {
  verified: 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300',
  hypothesis: 'bg-sky-50 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300',
  ai_inference: 'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300',
  contradicted: 'bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300',
  unknown: 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400',
};

export function TraceSection({ change, onChanged }: Props) {
  const addToast = useToastStore((s) => s.addToast);
  const evidence = useMemo(() => change.evidence ?? [], [change.evidence]);
  const editable = canAppend(change, 'trace');
  const [trace, setTrace] = useState<WorkspaceTrace>(() => change.trace ?? emptyTrace());
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newKind, setNewKind] = useState<TraceNodeKind>('behavior');

  useEffect(() => {
    setTrace(change.trace ?? emptyTrace());
    setDirty(false);
  }, [change.id, change.trace]);

  const apply = (fn: (t: WorkspaceTrace) => WorkspaceTrace) => {
    try {
      setTrace((current) => fn(current));
      setDirty(true);
    } catch (err) {
      addToast(err instanceof Error ? err.message : String(err), 'error');
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      const updated = await updateTrace(change.id, trace);
      setDirty(false);
      await onChanged(updated);
      addToast('Trace saved');
    } catch (err) {
      addToast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setSaving(false);
    }
  };

  const summary = traceSummary(trace, evidence);
  const rows = orderedNodes(trace);

  return (
    <section className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
      <div className="flex flex-wrap items-center gap-3 px-5 py-4 border-b border-gray-100 dark:border-gray-800">
        <Route size={16} className="text-violet-600 dark:text-violet-400" />
        <h2 className="font-semibold text-gray-900 dark:text-white">My Trace</h2>
        <span className="text-xs text-gray-400">
          {summary.nodes} node{summary.nodes === 1 ? '' : 's'}
          {summary.unknownNodes ? ` · ${summary.unknownNodes} unknown` : ''}
        </span>
        <div className="flex flex-wrap gap-1">
          {(Object.keys(summary.byVerification) as EdgeVerification[])
            .filter((k) => summary.byVerification[k] > 0)
            .map((k) => (
              <span key={k} className={`px-1.5 py-0.5 rounded text-[11px] ${CHIP[k]}`}>
                {summary.byVerification[k]} {EDGE_VERIFICATION_LABEL[k].toLowerCase()}
              </span>
            ))}
        </div>
        {editable && (
          <button
            type="button"
            onClick={() => void save()}
            disabled={!dirty || saving}
            className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-violet-600 text-white disabled:opacity-50"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save trace
          </button>
        )}
      </div>

      <div className="p-5 space-y-3">
        {rows.length === 0 && (
          <p className="text-xs text-gray-400">
            Start with the behavior you are tracing, then add what you believe it calls into. Leave a <code>???</code> where you do not know yet — an incomplete trace beats an invented one.
          </p>
        )}

        <ol className="space-y-2">
          {rows.map(({ node, depth }) => {
            const edge = incomingEdge(trace, node.id);
            return (
              <li key={node.id} style={{ marginLeft: `${depth * 1.5}rem` }} className="space-y-2">
                {edge && (
                  <EdgeRow
                    edge={edge}
                    evidence={evidence}
                    editable={editable}
                    branch={Boolean(node.branchOf)}
                    onChange={(patch) => apply((t) => updateEdge(t, edge.id, patch))}
                  />
                )}
                <NodeRow
                  node={node}
                  evidence={evidence}
                  editable={editable}
                  onChange={(patch) => apply((t) => updateNode(t, node.id, patch))}
                  onMove={(dir) => apply((t) => moveNode(t, node.id, dir))}
                  onRemove={() => apply((t) => removeNode(t, node.id))}
                  onAddAfter={() => apply((t) => addUnknownNode(t, node.branchOf ? null : node.id))}
                  onAddBranch={() => apply((t) => addNode(t, { label: '???', kind: 'unknown', branchOf: node.id }))}
                />
              </li>
            );
          })}
        </ol>

        {editable && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg bg-gray-50 dark:bg-gray-950 p-3">
            <select
              value={newKind}
              onChange={(e) => setNewKind(e.target.value as TraceNodeKind)}
              aria-label="New node kind"
              className="px-2 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
            >
              {TRACE_NODE_KINDS.map((k) => (
                <option key={k} value={k}>{k}</option>
              ))}
            </select>
            <input
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newLabel.trim()) {
                  apply((t) => addNode(t, { label: newLabel, kind: newKind }));
                  setNewLabel('');
                }
              }}
              placeholder="e.g. handleResultClick"
              aria-label="New node label"
              className="flex-1 min-w-56 px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
            />
            <button
              type="button"
              onClick={() => {
                if (!newLabel.trim()) return;
                apply((t) => addNode(t, { label: newLabel, kind: newKind }));
                setNewLabel('');
              }}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900"
            >
              <Plus size={14} /> Add node
            </button>
            <button
              type="button"
              onClick={() => apply((t) => addUnknownNode(t))}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200"
              title="Add an unknown step"
            >
              <HelpCircle size={14} /> Add ???
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

function NodeRow({
  node, evidence, editable, onChange, onMove, onRemove, onAddAfter, onAddBranch,
}: {
  node: TraceNode;
  evidence: EvidenceItem[];
  editable: boolean;
  onChange: (patch: Partial<Pick<TraceNode, 'label' | 'kind' | 'evidenceIds'>>) => void;
  onMove: (direction: 'up' | 'down') => void;
  onRemove: () => void;
  onAddAfter: () => void;
  onAddBranch: () => void;
}) {
  const support = deriveNodeSupport(node, evidence);
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-2 space-y-2" data-testid={`node-${node.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        {node.branchOf && <GitBranch size={12} className="text-gray-400" />}
        <select
          value={node.kind}
          disabled={!editable}
          onChange={(e) => onChange({ kind: e.target.value as TraceNodeKind })}
          aria-label={`Kind of ${node.label}`}
          className="px-2 py-1 text-xs rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 text-gray-700 dark:text-gray-200"
        >
          {TRACE_NODE_KINDS.map((k) => (
            <option key={k} value={k}>{k}</option>
          ))}
        </select>
        <input
          value={node.label}
          disabled={!editable}
          onChange={(e) => onChange({ label: e.target.value })}
          aria-label="Node label"
          className={`flex-1 min-w-40 px-2 py-1 text-sm rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100 ${node.kind === 'unknown' ? 'italic' : 'font-mono'}`}
        />
        <span className={`px-1.5 py-0.5 rounded text-[10px] ${CHIP[support]}`} title="What supports this node">
          {EDGE_VERIFICATION_LABEL[support].toLowerCase()}
        </span>
        {editable && (
          <div className="flex items-center gap-1">
            <IconButton label="Move up" onClick={() => onMove('up')}><ArrowUp size={12} /></IconButton>
            <IconButton label="Move down" onClick={() => onMove('down')}><ArrowDown size={12} /></IconButton>
            <IconButton label="Add step after" onClick={onAddAfter}><Plus size={12} /></IconButton>
            <IconButton label="Add branch" onClick={onAddBranch}><GitBranch size={12} /></IconButton>
            <IconButton label="Remove node" onClick={onRemove} danger><Trash2 size={12} /></IconButton>
          </div>
        )}
      </div>
      <EvidencePicker
        label={`Evidence for ${node.label}`}
        selected={node.evidenceIds}
        evidence={evidence}
        editable={editable}
        onChange={(evidenceIds) => onChange({ evidenceIds })}
      />
    </div>
  );
}

function EdgeRow({
  edge, evidence, editable, branch, onChange,
}: {
  edge: TraceEdge;
  evidence: EvidenceItem[];
  editable: boolean;
  branch: boolean;
  onChange: (patch: Partial<Pick<TraceEdge, 'claim' | 'evidenceIds' | 'override'>>) => void;
}) {
  const state = deriveEdgeVerification(edge, evidence);
  const [note, setNote] = useState(edge.override?.note ?? '');
  const [contradict, setContradict] = useState(Boolean(edge.override));
  return (
    <div className="ml-4 border-l-2 border-dashed border-gray-300 dark:border-gray-700 pl-3 py-1 space-y-1" data-testid={`edge-${edge.id}`}>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-gray-400">{branch ? 'branches to' : '↓'}</span>
        <span className={`px-1.5 py-0.5 rounded ${CHIP[state]}`} data-testid="verification-chip">
          {EDGE_VERIFICATION_LABEL[state]}
        </span>
        <input
          value={edge.claim ?? ''}
          disabled={!editable}
          onChange={(e) => onChange({ claim: e.target.value })}
          placeholder="claim, e.g. passes messageId via the route"
          aria-label="Edge claim"
          className="flex-1 min-w-48 px-2 py-1 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100"
        />
        {editable && (
          <label className="inline-flex items-center gap-1 text-gray-600 dark:text-gray-400">
            <input
              type="checkbox"
              checked={contradict}
              onChange={(e) => {
                setContradict(e.target.checked);
                if (!e.target.checked) onChange({ override: undefined });
                else if (note.trim()) onChange({ override: { verification: 'contradicted', note } });
              }}
            />
            contradicted
          </label>
        )}
      </div>
      {contradict && (
        <input
          value={note}
          disabled={!editable}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => note.trim() && onChange({ override: { verification: 'contradicted', note } })}
          placeholder="what contradicts this relationship (required)"
          aria-label="Contradiction note"
          className="w-full px-2 py-1 text-xs rounded border border-red-200 dark:border-red-900 bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100"
        />
      )}
      <EvidencePicker
        label="Evidence for this relationship"
        selected={edge.evidenceIds}
        evidence={evidence}
        editable={editable}
        onChange={(evidenceIds) => onChange({ evidenceIds })}
      />
    </div>
  );
}

function EvidencePicker({
  label, selected, evidence, editable, onChange,
}: {
  label: string;
  selected: string[];
  evidence: EvidenceItem[];
  editable: boolean;
  onChange: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const chosen = new Set(selected);
  const attached = evidence.filter((e) => chosen.has(e.id));
  return (
    <div className="text-xs">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={label}
        className="text-gray-500 dark:text-gray-400 underline decoration-dotted"
      >
        {attached.length} evidence item{attached.length === 1 ? '' : 's'}
        {attached.length ? `: ${attached.map(evidenceLabel).join(', ')}` : ''}
      </button>
      {open && (
        <ul className="mt-1 space-y-1 rounded bg-gray-50 dark:bg-gray-950 p-2">
          {evidence.length === 0 && <li className="text-gray-400">Add evidence in the Evidence section first.</li>}
          {evidence.map((item) => (
            <li key={item.id}>
              <label className="inline-flex items-center gap-2 text-gray-700 dark:text-gray-300">
                <input
                  type="checkbox"
                  checked={chosen.has(item.id)}
                  disabled={!editable}
                  onChange={(e) =>
                    onChange(e.target.checked ? [...selected, item.id] : selected.filter((id) => id !== item.id))
                  }
                />
                <span className="px-1 rounded bg-gray-200 dark:bg-gray-800 text-[10px]">{item.kind}</span>
                <span className="font-mono">{evidenceLabel(item)}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function IconButton({ label, onClick, danger, children }: { label: string; onClick: () => void; danger?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`p-1 rounded ${danger ? 'text-gray-400 hover:text-red-500' : 'text-gray-500 hover:text-gray-900 dark:hover:text-white'}`}
    >
      {children}
    </button>
  );
}

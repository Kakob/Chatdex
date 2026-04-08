import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { TagInput } from '../common/TagInput';
import { useAnchorStore } from '../../stores/anchorStore';
import { anchorApi } from '../../lib/api';
import type { ApiTag } from '../../lib/api';

interface AnchorModalProps {
  contentType: 'full_response' | 'selection' | 'prompt_response_pair';
  userPrompt: string;
  claudeResponse: string;
  selectedText?: string;
  conversationId: string;
  messageId: string;
  messageIndex: number;
  onSaved: () => void;
  onCancel: () => void;
}

export function AnchorModal({
  contentType: defaultContentType,
  userPrompt,
  claudeResponse,
  selectedText,
  conversationId,
  messageId,
  messageIndex,
  onSaved,
  onCancel,
}: AnchorModalProps) {
  const [contentType, setContentType] = useState(defaultContentType);
  const [annotation, setAnnotation] = useState('');
  const [priority, setPriority] = useState<'low' | 'medium' | 'high'>('medium');
  const [folder, setFolder] = useState('');
  const [selectedTags, setSelectedTags] = useState<ApiTag[]>([]);
  const [saving, setSaving] = useState(false);
  const [availableFolders, setAvailableFolders] = useState<string[]>([]);
  const { createAnchor } = useAnchorStore();

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [onCancel]);

  useEffect(() => {
    anchorApi.getFolders().then(setAvailableFolders).catch(() => {});
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await createAnchor({
        contentType,
        userPrompt,
        claudeResponse,
        selectedText: contentType === 'selection' ? selectedText : undefined,
        conversationId,
        messageId,
        messageIndex,
        annotation: annotation.trim() || undefined,
        priority,
        folder: folder.trim() || undefined,
        tagIds: selectedTags.map((t) => t.id),
      });
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  const preview = contentType === 'selection' && selectedText
    ? selectedText
    : claudeResponse.slice(0, 200) + (claudeResponse.length > 200 ? '...' : '');

  const priorities = [
    { value: 'low' as const, label: 'Low', color: 'bg-gray-300' },
    { value: 'medium' as const, label: 'Medium', color: 'bg-amber-400' },
    { value: 'high' as const, label: 'High', color: 'bg-red-500' },
  ];

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50" onClick={onCancel}>
      <div className="w-full max-w-lg mx-4 bg-white dark:bg-gray-900 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Anchor Knowledge</h2>
          <button onClick={onCancel} className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400"><X size={20} /></button>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-sm text-gray-500 dark:text-gray-400 line-clamp-4 bg-gray-50 dark:bg-gray-800 rounded-lg p-3 font-mono text-xs">{preview}</p>

          {/* Content Type */}
          <div className="flex gap-2">
            {(['full_response', 'selection', 'prompt_response_pair'] as const).map((ct) => (
              <button key={ct} onClick={() => setContentType(ct)} disabled={ct === 'selection' && !selectedText}
                className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${contentType === ct ? 'bg-violet-600 text-white' : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800'} ${ct === 'selection' && !selectedText ? 'opacity-30 cursor-not-allowed' : ''}`}>
                {ct === 'full_response' ? 'Full Response' : ct === 'selection' ? 'Selection' : 'Prompt + Response'}
              </button>
            ))}
          </div>

          {/* Annotation */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Annotation</label>
            <textarea value={annotation} onChange={(e) => setAnnotation(e.target.value)} placeholder="Why is this worth saving?" rows={2}
              className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-500/40 resize-y" />
          </div>

          {/* Priority */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Priority</label>
            <div className="flex gap-2">
              {priorities.map((p) => (
                <button key={p.value} onClick={() => setPriority(p.value)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg transition-colors ${priority === p.value ? 'bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 ring-1 ring-violet-400' : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800'}`}>
                  <span className={`w-2 h-2 rounded-full ${p.color}`} />
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Folder */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Folder</label>
            <input
              type="text"
              value={folder}
              onChange={(e) => setFolder(e.target.value)}
              placeholder="e.g. Architecture, Debugging"
              list="anchor-folder-suggestions"
              className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
            />
            {availableFolders.length > 0 && (
              <datalist id="anchor-folder-suggestions">
                {availableFolders.map((f) => <option key={f} value={f} />)}
              </datalist>
            )}
          </div>

          {/* Tags */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Tags</label>
            <TagInput selectedTags={selectedTags} onTagAdd={(tag) => setSelectedTags((prev) => [...prev, tag])} onTagRemove={(id) => setSelectedTags((prev) => prev.filter((t) => t.id !== id))} entityType="anchor" />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button onClick={onCancel} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors">Cancel</button>
            <button onClick={handleSave} disabled={saving} className="px-4 py-2 text-sm bg-violet-600 hover:bg-violet-700 text-white rounded-lg transition-colors disabled:opacity-50">
              {saving ? 'Saving...' : 'Save Anchor'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

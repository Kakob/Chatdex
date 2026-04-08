import { ExternalLink, Pencil, Trash2, MessageSquare, Folder } from 'lucide-react';
import { TagBadge } from '../common/TagBadge';
import type { ApiAnchor } from '../../lib/api';

const PRIORITY_COLORS: Record<string, string> = {
  low: 'bg-gray-300',
  medium: 'bg-amber-400',
  high: 'bg-red-500',
};

const CONTENT_LABELS: Record<string, string> = {
  full_response: 'Full Response',
  selection: 'Selection',
  prompt_response_pair: 'Prompt + Response',
};

interface AnchorCardProps {
  anchor: ApiAnchor;
  onNavigate: (anchor: ApiAnchor) => void;
  onEdit: (anchor: ApiAnchor) => void;
  onDelete: (anchor: ApiAnchor) => void;
}

export function AnchorCard({ anchor, onNavigate, onEdit, onDelete }: AnchorCardProps) {
  const preview = anchor.selectedText || anchor.claudeResponse;
  const formatDate = (d: string) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  return (
    <div className="p-4 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 hover:border-gray-300 dark:hover:border-gray-600 transition-all">
      {/* Badges row */}
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <span className="px-2 py-0.5 text-xs rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500">{CONTENT_LABELS[anchor.contentType]}</span>
        <span className={`w-2 h-2 rounded-full ${PRIORITY_COLORS[anchor.priority]}`} title={`Priority: ${anchor.priority}`} />
        {anchor.folder && (
          <span className="flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400">
            <Folder size={10} />{anchor.folder}
          </span>
        )}
      </div>

      {/* Preview */}
      <p className="text-sm text-gray-700 dark:text-gray-300 line-clamp-3 mb-2">{preview}</p>

      {/* Annotation */}
      {anchor.annotation && (
        <p className="text-sm text-violet-600 dark:text-violet-400 italic mb-2">{anchor.annotation}</p>
      )}

      {/* Tags */}
      {anchor.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {anchor.tags.map((tag) => (
            <TagBadge key={tag.id} name={tag.name} color={tag.color} />
          ))}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between mt-3">
        <div className="flex items-center gap-3 text-xs text-gray-400">
          {anchor.conversationName && (
            <span className="flex items-center gap-1"><MessageSquare size={10} />{anchor.conversationName}</span>
          )}
          <span>{formatDate(anchor.createdAt)}</span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => onNavigate(anchor)} className="flex items-center gap-1 px-2 py-1 text-xs text-violet-600 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-900/20 rounded transition-colors">
            <ExternalLink size={12} />Go to message
          </button>
          <button onClick={() => onEdit(anchor)} className="p-1 text-gray-400 hover:text-gray-600 rounded transition-colors" title="Edit"><Pencil size={14} /></button>
          <button onClick={() => onDelete(anchor)} className="p-1 text-gray-400 hover:text-red-500 rounded transition-colors" title="Delete"><Trash2 size={14} /></button>
        </div>
      </div>
    </div>
  );
}

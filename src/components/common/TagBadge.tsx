import { X } from 'lucide-react';

interface TagBadgeProps {
  name: string;
  color?: string | null;
  onRemove?: () => void;
  size?: 'sm' | 'md';
}

const DEFAULT_COLOR = '#7c3aed'; // violet-600

export function TagBadge({ name, color, onRemove, size = 'sm' }: TagBadgeProps) {
  const bgColor = color || DEFAULT_COLOR;
  const isSmall = size === 'sm';

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-medium ${
        isSmall ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-sm'
      }`}
      style={{
        backgroundColor: `${bgColor}20`,
        color: bgColor,
        border: `1px solid ${bgColor}40`,
      }}
    >
      {name}
      {onRemove && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="ml-0.5 rounded-full p-0.5 hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
        >
          <X size={isSmall ? 10 : 12} />
        </button>
      )}
    </span>
  );
}

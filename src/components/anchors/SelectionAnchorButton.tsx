import { Anchor } from 'lucide-react';

interface SelectionAnchorButtonProps {
  rect: DOMRect;
  onClick: () => void;
}

export function SelectionAnchorButton({ rect, onClick }: SelectionAnchorButtonProps) {
  const top = rect.top + window.scrollY - 36;
  const left = rect.left + window.scrollX + rect.width / 2 - 16;

  return (
    <button
      onClick={onClick}
      style={{ position: 'absolute', top, left }}
      className="z-30 flex items-center gap-1 px-2 py-1 text-xs bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg shadow-lg transition-colors"
    >
      <Anchor size={12} />
      Anchor
    </button>
  );
}

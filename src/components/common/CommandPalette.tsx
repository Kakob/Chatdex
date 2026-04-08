import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  Clock,
  BarChart3,
  MessageSquare,
  Anchor,
  Upload,
  Settings,
  Command,
} from 'lucide-react';
import { useShortcutStore, type ShortcutEntry } from '../../stores/shortcutStore';

const NAV_ACTIONS = [
  { id: 'nav-search', label: 'Go to Search', path: '/search', icon: Search },
  { id: 'nav-timeline', label: 'Go to Timeline', path: '/timeline', icon: Clock },
  { id: 'nav-analytics', label: 'Go to Analytics', path: '/analytics', icon: BarChart3 },
  { id: 'nav-browse', label: 'Go to Browse', path: '/conversations', icon: MessageSquare },
  { id: 'nav-knowledge', label: 'Go to Knowledge', path: '/knowledge', icon: Anchor },
  { id: 'nav-import', label: 'Go to Import', path: '/import', icon: Upload },
  { id: 'nav-settings', label: 'Go to Settings', path: '/settings', icon: Settings },
];

function formatShortcut(entry: ShortcutEntry): string {
  const parts: string[] = [];
  if (entry.meta) parts.push('\u2318');
  if (entry.ctrl) parts.push('Ctrl');
  if (entry.shift) parts.push('\u21E7');
  if (entry.alt) parts.push('\u2325');
  parts.push(entry.key.length === 1 ? entry.key.toUpperCase() : entry.key);
  return parts.join('');
}

export function CommandPalette() {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const { paletteOpen, setPaletteOpen, getAll } = useShortcutStore();
  const shortcuts = getAll().filter((s) => s.id !== 'cmd-palette');

  const items = useMemo(() => {
    const all = [
      ...NAV_ACTIONS.map((nav) => ({
        id: nav.id,
        label: nav.label,
        icon: nav.icon,
        hint: '',
        action: () => navigate(nav.path),
      })),
      ...shortcuts.map((s) => ({
        id: s.id,
        label: s.label,
        icon: Command,
        hint: formatShortcut(s),
        action: s.handler,
      })),
    ];

    if (!query.trim()) return all;

    const q = query.toLowerCase();
    return all.filter((item) => item.label.toLowerCase().includes(q));
  }, [query, shortcuts, navigate]);

  // Reset selection when items change
  useEffect(() => {
    setSelectedIndex(0);
  }, [items.length]);

  // Focus input on open
  useEffect(() => {
    if (paletteOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [paletteOpen]);

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.children[selectedIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  if (!paletteOpen) return null;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && items[selectedIndex]) {
      e.preventDefault();
      items[selectedIndex].action();
      setPaletteOpen(false);
    } else if (e.key === 'Escape') {
      setPaletteOpen(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]"
      onClick={() => setPaletteOpen(false)}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 dark:bg-black/60" />

      {/* Palette */}
      <div
        className="relative w-full max-w-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <Search size={18} className="text-gray-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a command..."
            className="flex-1 bg-transparent text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none text-sm"
          />
          <kbd className="text-xs text-gray-400 bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-700 font-mono">
            esc
          </kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-72 overflow-y-auto py-2">
          {items.length === 0 && (
            <p className="px-4 py-6 text-center text-sm text-gray-400">
              No results found
            </p>
          )}
          {items.map((item, i) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                onClick={() => {
                  item.action();
                  setPaletteOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                  i === selectedIndex
                    ? 'bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-300'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
                }`}
              >
                <Icon size={16} className="shrink-0 opacity-60" />
                <span className="flex-1 text-left">{item.label}</span>
                {item.hint && (
                  <span className="text-xs text-gray-400 font-mono">{item.hint}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

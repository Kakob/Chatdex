import { useEffect } from 'react';
import { useShortcutStore, type ShortcutEntry } from '../stores/shortcutStore';

function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.isContentEditable
  );
}

function buildKeyId(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.metaKey) parts.push('meta');
  if (e.ctrlKey) parts.push('ctrl');
  if (e.shiftKey) parts.push('shift');
  if (e.altKey) parts.push('alt');
  parts.push(e.key.toLowerCase());
  return parts.join('+');
}

function entryKeyId(entry: ShortcutEntry): string {
  const parts: string[] = [];
  if (entry.meta) parts.push('meta');
  if (entry.ctrl) parts.push('ctrl');
  if (entry.shift) parts.push('shift');
  if (entry.alt) parts.push('alt');
  parts.push(entry.key.toLowerCase());
  return parts.join('+');
}

/**
 * Global keyboard shortcut listener.
 * Mount once (e.g. in Layout) to handle all registered shortcuts.
 */
export function useGlobalShortcutListener() {
  const shortcuts = useShortcutStore((s) => s.shortcuts);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const pressed = buildKeyId(e);

      for (const entry of shortcuts.values()) {
        if (entryKeyId(entry) === pressed) {
          // Some shortcuts (like Cmd+K) should work even in inputs
          const allowInInput = entry.meta || entry.ctrl;
          if (!allowInInput && isEditableTarget(e.target)) return;

          e.preventDefault();
          entry.handler();
          return;
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [shortcuts]);
}

/**
 * Register shortcuts on mount, unregister on unmount.
 */
export function useKeyboardShortcuts(entries: ShortcutEntry[]) {
  const { register, unregister } = useShortcutStore();

  useEffect(() => {
    for (const entry of entries) {
      register(entry);
    }
    return () => {
      for (const entry of entries) {
        unregister(entry.id);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

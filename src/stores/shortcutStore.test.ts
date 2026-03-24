import { describe, it, expect, beforeEach } from 'vitest';
import { useShortcutStore, type ShortcutEntry } from './shortcutStore';

const makeEntry = (id: string): ShortcutEntry => ({
  id,
  key: 'k',
  label: `Shortcut ${id}`,
  handler: () => {},
});

describe('shortcutStore', () => {
  beforeEach(() => {
    useShortcutStore.setState({ shortcuts: new Map(), paletteOpen: false });
  });

  it('starts with empty shortcuts and palette closed', () => {
    const state = useShortcutStore.getState();
    expect(state.shortcuts.size).toBe(0);
    expect(state.paletteOpen).toBe(false);
  });

  it('register adds a shortcut entry', () => {
    useShortcutStore.getState().register(makeEntry('test'));
    expect(useShortcutStore.getState().shortcuts.size).toBe(1);
  });

  it('register overwrites entry with same id', () => {
    const { register } = useShortcutStore.getState();
    register(makeEntry('test'));
    register({ ...makeEntry('test'), label: 'Updated' });
    const entry = useShortcutStore.getState().shortcuts.get('test');
    expect(entry?.label).toBe('Updated');
    expect(useShortcutStore.getState().shortcuts.size).toBe(1);
  });

  it('unregister removes a shortcut by id', () => {
    const { register, unregister } = useShortcutStore.getState();
    register(makeEntry('test'));
    unregister('test');
    expect(useShortcutStore.getState().shortcuts.size).toBe(0);
  });

  it('unregister is a no-op for non-existent id', () => {
    useShortcutStore.getState().unregister('nonexistent');
    expect(useShortcutStore.getState().shortcuts.size).toBe(0);
  });

  it('togglePalette flips paletteOpen', () => {
    useShortcutStore.getState().togglePalette();
    expect(useShortcutStore.getState().paletteOpen).toBe(true);
    useShortcutStore.getState().togglePalette();
    expect(useShortcutStore.getState().paletteOpen).toBe(false);
  });

  it('setPaletteOpen sets explicit value', () => {
    useShortcutStore.getState().setPaletteOpen(true);
    expect(useShortcutStore.getState().paletteOpen).toBe(true);
    useShortcutStore.getState().setPaletteOpen(false);
    expect(useShortcutStore.getState().paletteOpen).toBe(false);
  });

  it('getAll returns array of all entries', () => {
    const { register } = useShortcutStore.getState();
    register(makeEntry('a'));
    register(makeEntry('b'));
    const all = useShortcutStore.getState().getAll();
    expect(all).toHaveLength(2);
  });

  it('getAll returns empty array when no shortcuts', () => {
    expect(useShortcutStore.getState().getAll()).toHaveLength(0);
  });
});

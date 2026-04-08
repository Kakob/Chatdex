import { Outlet } from 'react-router-dom';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { CommandPalette } from '../common/CommandPalette';
import { ToastContainer } from '../common/Toast';
import { useGlobalShortcutListener, useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts';
import { useShortcutStore } from '../../stores/shortcutStore';

export function Layout() {
  const togglePalette = useShortcutStore((s) => s.togglePalette);

  // Listen for all registered keyboard shortcuts
  useGlobalShortcutListener();

  // Register the Cmd+K shortcut for the command palette
  useKeyboardShortcuts([
    {
      id: 'cmd-palette',
      key: 'k',
      meta: true,
      label: 'Command Palette',
      description: 'Open the command palette',
      handler: togglePalette,
    },
  ]);

  return (
    <div className="h-screen flex flex-col bg-gray-50 dark:bg-gray-950">
      <Header />
      <div className="flex-1 flex overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </div>
      <CommandPalette />
      <ToastContainer />
    </div>
  );
}

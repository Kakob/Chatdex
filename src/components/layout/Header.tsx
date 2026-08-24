import { Menu, Sun, Moon, ShieldCheck } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';

export function Header() {
  const { theme, setTheme, toggleSidebar, conversationCount } = useAppStore();

  const toggleTheme = () => {
    if (theme === 'light') {
      setTheme('dark');
      document.documentElement.classList.add('dark');
    } else {
      setTheme('light');
      document.documentElement.classList.remove('dark');
    }
  };

  return (
    <header className="h-14 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between px-4">
      <div className="flex items-center gap-4">
        <button
          onClick={toggleSidebar}
          className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          aria-label="Toggle sidebar"
        >
          <Menu size={20} className="text-gray-600 dark:text-gray-400" />
        </button>

        <div className="flex items-center gap-2">
          <span className="text-xl font-semibold text-gray-900 dark:text-white">
            Chatdex
          </span>
          {conversationCount > 0 && (
            <span className="text-xs text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded-full">
              {conversationCount} conversations
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <span
          className="hidden sm:flex items-center gap-1.5 px-2 py-1 text-xs text-gray-500 dark:text-gray-400"
          title="Primary history and project artifacts stay in this browser unless encrypted sync is configured"
        >
          <ShieldCheck size={14} className="text-emerald-500" /> Local-first
        </span>

        <button
          onClick={toggleTheme}
          className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          aria-label="Toggle theme"
        >
          {theme === 'dark' ? (
            <Sun size={18} className="text-gray-600 dark:text-gray-400" />
          ) : (
            <Moon size={18} className="text-gray-600 dark:text-gray-400" />
          )}
        </button>
      </div>
    </header>
  );
}

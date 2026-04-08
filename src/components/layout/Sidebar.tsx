import { NavLink } from 'react-router-dom';
import {
  Search,
  Clock,
  BarChart3,
  MessageSquare,
  Anchor,
  Upload,
  Settings,
} from 'lucide-react';
import { useAppStore } from '../../stores/appStore';

const navItems = [
  { to: '/search', icon: Search, label: 'Search' },
  { to: '/timeline', icon: Clock, label: 'Timeline' },
  { to: '/analytics', icon: BarChart3, label: 'Analytics' },
  { to: '/conversations', icon: MessageSquare, label: 'Browse' },
  { to: '/knowledge', icon: Anchor, label: 'Knowledge' },
  { to: '/import', icon: Upload, label: 'Import' },
];

export function Sidebar() {
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);

  if (!sidebarOpen) {
    return null;
  }

  return (
    <aside className="w-56 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 flex flex-col">
      <nav className="flex-1 p-4 space-y-1">
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400'
                  : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
              }`
            }
          >
            <Icon size={18} />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="p-4 border-t border-gray-200 dark:border-gray-800">
        <NavLink
          to="/settings"
          className={({ isActive }) =>
            `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              isActive
                ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400'
                : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
            }`
          }
        >
          <Settings size={18} />
          Settings
        </NavLink>
      </div>
    </aside>
  );
}

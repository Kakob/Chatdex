import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  Search,
  MessageSquare,
  FolderKanban,
  Upload,
  Settings,
} from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import { loadPendingReviewCounts } from '../../lib/understanding/pendingReviews';

const navItems = [
  { to: '/projects', icon: FolderKanban, label: 'Projects' },
  { to: '/conversations', icon: MessageSquare, label: 'Sources' },
  { to: '/search', icon: Search, label: 'Global search' },
  { to: '/import', icon: Upload, label: 'Import' },
];

export function Sidebar() {
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const setSidebarOpen = useAppStore((s) => s.setSidebarOpen);
  const location = useLocation();
  const [pendingReviews, setPendingReviews] = useState(0);

  // Reviews awaiting attention (U6.2) — recounted on navigation, which is
  // when the number can have changed (reviews, discovery, reconciliation).
  useEffect(() => {
    let cancelled = false;
    void loadPendingReviewCounts().then((counts) => {
      if (!cancelled) setPendingReviews(counts.total);
    });
    return () => {
      cancelled = true;
    };
  }, [location.pathname]);

  if (!sidebarOpen) {
    return null;
  }

  const closeOnNarrowScreen = () => {
    if (window.innerWidth < 768) setSidebarOpen(false);
  };

  return (
    <>
      <button
        type="button"
        aria-label="Close navigation"
        onClick={() => setSidebarOpen(false)}
        className="fixed inset-x-0 bottom-0 top-14 z-30 bg-black/30 md:hidden"
      />
      <aside className="fixed bottom-0 left-0 top-14 z-40 flex w-56 flex-col border-r border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900 md:static md:z-auto">
      <nav className="flex-1 p-4 space-y-1">
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            onClick={closeOnNarrowScreen}
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
            {to === '/projects' && pendingReviews > 0 && (
              <span
                className="ml-auto px-1.5 py-0.5 text-xs rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 tabular-nums"
                title={`${pendingReviews} item${pendingReviews !== 1 ? 's' : ''} awaiting review`}
              >
                {pendingReviews > 99 ? '99+' : pendingReviews}
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="p-4 border-t border-gray-200 dark:border-gray-800">
        <NavLink
          to="/settings"
          onClick={closeOnNarrowScreen}
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
    </>
  );
}

import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/layout';
import {
  SearchPage,
  AnalyticsPage,
  TimelinePage,
  ConversationsPage,
  ChatPage,
  KnowledgePage,
  InvestigatePage,
  InvestigationWorkbenchPage,
  ProjectsPage,
  ProjectUnderstandingPage,
  ImportPage,
  SettingsPage,
  HowDetectionWorksPage,
} from './pages';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Navigate to="/search" replace />} />
          <Route path="search" element={<SearchPage />} />
          <Route path="timeline" element={<TimelinePage />} />
          <Route path="analytics" element={<AnalyticsPage />} />
          <Route path="conversations" element={<ConversationsPage />} />
          <Route path="conversations/:id" element={<ConversationsPage />} />
          {/* One route with an optional param: navigating /chat → /chat/:id
              must not remount the page mid-stream. */}
          <Route path="chat/:id?" element={<ChatPage />} />
          <Route path="knowledge" element={<KnowledgePage />} />
          <Route path="investigate" element={<InvestigatePage />} />
          <Route path="investigate/:anchorId" element={<InvestigationWorkbenchPage />} />
          <Route path="projects" element={<ProjectsPage />} />
          <Route path="projects/:id" element={<ProjectUnderstandingPage />} />
          <Route path="import" element={<ImportPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="how-detection-works" element={<HowDetectionWorksPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

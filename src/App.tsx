import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Layout, ProjectWorkspaceLayout } from './components/layout';
import {
  SearchPage,
  AnalyticsPage,
  TimelinePage,
  ConversationsPage,
  ChatPage,
  KnowledgePage,
  InvestigatePage,
  InvestigationWorkbenchPage,
  QuestionInvestigationPage,
  LedgerPage,
  ProjectsPage,
  ProjectUnderstandingPage,
  ProjectOverviewPage,
  PrepareChangePage,
  ImportPage,
  SettingsPage,
  HowDetectionWorksPage,
} from './pages';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Navigate to="/projects" replace />} />
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
          <Route path="ledger" element={<LedgerPage />} />
          <Route path="projects" element={<ProjectsPage />} />
          <Route path="projects/unassigned" element={<ProjectUnderstandingPage />} />
          <Route path="projects/:id" element={<ProjectWorkspaceLayout />}>
            <Route index element={<ProjectOverviewPage />} />
            <Route path="investigate" element={<InvestigatePage projectScoped />} />
            <Route
              path="investigate/questions/:caseId"
              element={<QuestionInvestigationPage />}
            />
            <Route
              path="investigate/:anchorId"
              element={<InvestigationWorkbenchPage projectScoped />}
            />
            <Route
              path="understanding"
              element={<ProjectUnderstandingPage workspaceMode />}
            />
            <Route path="prepare" element={<PrepareChangePage />} />
          </Route>
          <Route path="import" element={<ImportPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="how-detection-works" element={<HowDetectionWorksPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

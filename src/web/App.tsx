import { Route, Routes } from 'react-router';
import { ErrorState } from './components/ui';
import { LoginPage } from './features/auth/LoginPage';
import { WorkspaceRoute } from './features/auth/session';
import { LandingPage } from './features/landing/LandingPage';
import { RequestDetailPage } from './features/requests/RequestDetailPage';
import { RequestsPage } from './features/requests/RequestsPage';
import { SettingsPage } from './features/settings/SettingsPage';
import { AppShell } from './features/shell/AppShell';
import { SigningPage } from './features/signing/SigningPage';
import { TemplateBuilderPage } from './features/templates/TemplateBuilderPage';
import { TemplatesPage } from './features/templates/TemplatesPage';

function NotFoundPage() {
  return (
    <main className="page page--narrow">
      <ErrorState title="Page not found" message="There is nothing at this address." />
    </main>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/sign/:token" element={<SigningPage />} />
      <Route
        path="/w/:workspaceId"
        element={<WorkspaceRoute shell={(content) => <AppShell>{content}</AppShell>} />}
      >
        <Route index element={<RequestsPage />} />
        <Route path="requests" element={<RequestsPage />} />
        <Route path="requests/:requestId" element={<RequestDetailPage />} />
        <Route path="templates" element={<TemplatesPage />} />
        <Route path="templates/:templateId" element={<TemplateBuilderPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}

import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { PageLoading } from './components/Layout.tsx';
import { ToastProvider } from './lib/toast.tsx';
import { BackroomPage } from './pages/BackroomPage.tsx';
import { FaqPage } from './pages/FaqPage.tsx';
import { HomePage } from './pages/HomePage.tsx';
import { NotFoundPage } from './pages/NotFoundPage.tsx';
import { RulesPage } from './pages/RulesPage.tsx';
import './index.css';

// The room (socket.io and the game shell) and the admin area load on demand, so the landing
// page stays small.
const RoomPage = lazy(() => import('./pages/RoomPage.tsx').then((m) => ({ default: m.RoomPage })));
const AdminPage = lazy(() =>
  import('./pages/AdminPage.tsx').then((m) => ({ default: m.AdminPage })),
);
// The stats page carries the chart library, so it gets a chunk of its own.
const StatsPage = lazy(() =>
  import('./pages/StatsPage.tsx').then((m) => ({ default: m.StatsPage })),
);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <ToastProvider>
        <BrowserRouter>
          <Suspense fallback={<PageLoading />}>
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/r/:roomId" element={<RoomPage />} />
              <Route path="/rules" element={<RulesPage />} />
              <Route path="/faq" element={<FaqPage />} />
              <Route path="/rules/:gameId" element={<RulesPage />} />
              <Route path="/tavern-keeper" element={<AdminPage />} />
              <Route path="/tavern-keeper/stats" element={<StatsPage />} />
              <Route path="/backroom" element={<BackroomPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </ToastProvider>
    </ErrorBoundary>
  </StrictMode>,
);

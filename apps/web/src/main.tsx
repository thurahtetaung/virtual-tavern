import { IconSprite } from '@vt/ui';
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
// A phone linking to its player's PC.
const LinkPage = lazy(() => import('./pages/LinkPage.tsx').then((m) => ({ default: m.LinkPage })));
const AdminPage = lazy(() =>
  import('./pages/AdminPage.tsx').then((m) => ({ default: m.AdminPage })),
);
const GamesPage = lazy(() =>
  import('./pages/GamesPage.tsx').then((m) => ({ default: m.GamesPage })),
);
const PlaytestPage = lazy(() =>
  import('./pages/PlaytestPage.tsx').then((m) => ({ default: m.PlaytestPage })),
);
// The table screen: its pairing page and the show, which TVs and laptops load and phones never do.
const StagePage = lazy(() =>
  import('./pages/StagePage.tsx').then((m) => ({ default: m.StagePage })),
);
const StageShowPage = lazy(() =>
  import('./pages/StageShowPage.tsx').then((m) => ({ default: m.StageShowPage })),
);
// The component sheet, for the tavern keeper and the screenshot spec.
const ComponentsPage = lazy(() =>
  import('./pages/ComponentsPage.tsx').then((m) => ({ default: m.ComponentsPage })),
);
// The stats page carries the chart library, so it gets a chunk of its own.
const StatsPage = lazy(() =>
  import('./pages/StatsPage.tsx').then((m) => ({ default: m.StatsPage })),
);

/**
 * The table screen's pages load on a plain page in the screen's own theme (set before first
 * paint): never the site's frame, whose theme would flash on the TV.
 */
function StageLoading() {
  return <div className="fixed inset-0 bg-page" aria-busy="true" />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <IconSprite />
    <ErrorBoundary>
      <ToastProvider>
        <BrowserRouter>
          <Suspense fallback={<PageLoading />}>
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/r/:roomId" element={<RoomPage />} />
              <Route path="/link" element={<LinkPage />} />
              <Route path="/rules" element={<RulesPage />} />
              <Route path="/faq" element={<FaqPage />} />
              <Route path="/rules/:gameId" element={<RulesPage />} />
              <Route path="/tavern-keeper" element={<AdminPage />} />
              <Route path="/tavern-keeper/games" element={<GamesPage />} />
              <Route path="/tavern-keeper/stats" element={<StatsPage />} />
              <Route path="/tavern-keeper/playtest" element={<PlaytestPage />} />
              <Route path="/tavern-keeper/components" element={<ComponentsPage />} />
              <Route path="/backroom" element={<BackroomPage />} />
              <Route
                path="/stage"
                element={
                  <Suspense fallback={<StageLoading />}>
                    <StagePage />
                  </Suspense>
                }
              />
              <Route
                path="/stage/:roomId"
                element={
                  <Suspense fallback={<StageLoading />}>
                    <StageShowPage />
                  </Suspense>
                }
              />
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </ToastProvider>
    </ErrorBoundary>
  </StrictMode>,
);

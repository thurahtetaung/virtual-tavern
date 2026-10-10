import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { ToastProvider } from './lib/toast.tsx';
import { AdminPage } from './pages/AdminPage.tsx';
import { BackroomPage } from './pages/BackroomPage.tsx';
import { HomePage } from './pages/HomePage.tsx';
import { NotFoundPage } from './pages/NotFoundPage.tsx';
import { RoomPage } from './pages/RoomPage.tsx';
import { RulesPage } from './pages/RulesPage.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <ToastProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/r/:roomId" element={<RoomPage />} />
            <Route path="/rules" element={<RulesPage />} />
            <Route path="/rules/:gameId" element={<RulesPage />} />
            <Route path="/admin" element={<AdminPage />} />
            <Route path="/backroom" element={<BackroomPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </ErrorBoundary>
  </StrictMode>,
);

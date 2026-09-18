import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { AuthProvider } from './lib/auth';
import { ToastProvider } from './components/ui';
import { ApiError } from './lib/api';
import './styles/app.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Moderation data goes stale the moment someone else acts on it, so the
      // panel refetches when the tab regains focus rather than trusting a cache.
      refetchOnWindowFocus: true,
      staleTime: 15_000,
      retry: (failureCount, error) => {
        // 4xx means the request was wrong or not allowed; retrying it just
        // burns the admin rate limit and delays the error the operator needs.
        if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
        return failureCount < 2;
      },
    },
    mutations: { retry: false },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename="/admin">
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <AuthProvider>
            <App />
          </AuthProvider>
        </ToastProvider>
      </QueryClientProvider>
    </BrowserRouter>
  </StrictMode>,
);

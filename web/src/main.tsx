import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { SessionDTO } from '@campusflow/shared';
import { MotionConfig } from 'motion/react';
import { ApiError } from './lib/api';
import { sessionKey } from './lib/session';
import { ToastProvider } from './components/ui/Toast';
import { App } from './App';
import './styles/index.css';

const queryClient: QueryClient = new QueryClient({
  queryCache: new QueryCache({
    // A 401 while we believe someone is signed in means the session ended elsewhere (expiry, another
    // device, a server restart with a wiped DB): re-read the session so the UI stops showing them.
    onError: (err) => {
      if (err instanceof ApiError && err.status === 401 && queryClient.getQueryData<SessionDTO>(sessionKey)?.user) {
        void queryClient.invalidateQueries({ queryKey: sessionKey });
      }
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: true,
      // Retry transient network failures, never authorisation or validation errors.
      retry: (count, err) => (err instanceof ApiError && err.status > 0 && err.status < 500 ? false : count < 2),
    },
    mutations: { retry: false },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <MotionConfig reducedMotion="user">
        <ToastProvider>
          <App />
        </ToastProvider>
      </MotionConfig>
    </QueryClientProvider>
  </StrictMode>,
);

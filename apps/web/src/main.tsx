import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from '@/auth/AuthProvider';
import { ApiError } from '@/lib/api';
import { App } from './App';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      // Inutile de réessayer une erreur métier ou de droits ; seulement les erreurs réseau / serveur.
      retry: (count, error) => count < 2 && (!(error instanceof ApiError) || error.status === 0 || error.status >= 500),
    },
    mutations: { retry: false },
  },
});

const root = document.getElementById('root');
if (!root) throw new Error('Élément #root introuvable.');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);

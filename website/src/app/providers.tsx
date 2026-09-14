'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';

import { bootstrapSession } from '@/features/auth/api';

/**
 * Client providers.
 *
 * `bootstrapSession` runs once here, not in every page. It is the single place
 * that resolves "does the refresh cookie still buy us a session?" — a page-level
 * effect would run it on every navigation and, worse, race with the pages that
 * depend on the answer.
 */
export function Providers({ children }: { children: ReactNode }) {
  // `useState` rather than a module-level client: a module singleton is shared
  // across requests on the server, which leaks one user's cache into another's.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  useEffect(() => {
    void bootstrapSession();
  }, []);

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

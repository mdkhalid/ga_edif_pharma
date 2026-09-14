'use client';

import { useAuthStore, type AuthStatus } from './store';

/**
 * Reads the session from the store.
 *
 * Selectors are per-field rather than returning the whole store: `useAuthStore()`
 * without a selector subscribes the component to every change, so a token refresh
 * would re-render the header, the sidebar and every form on the page.
 */
export function useAuth(): {
  user: ReturnType<typeof useAuthStore.getState>['user'];
  status: AuthStatus;
  isAuthenticated: boolean;
} {
  const user = useAuthStore((state) => state.user);
  const status = useAuthStore((state) => state.status);

  return { user, status, isAuthenticated: status === 'authenticated' };
}

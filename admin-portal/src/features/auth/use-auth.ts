'use client';

import { useAuthStore } from './store';

export function useAuth(): {
  user: ReturnType<typeof useAuthStore.getState>['user'];
  status: ReturnType<typeof useAuthStore.getState>['status'];
  isAuthenticated: boolean;
} {
  const user = useAuthStore((state) => state.user);
  const status = useAuthStore((state) => state.status);

  return { user, status, isAuthenticated: status === 'authenticated' };
}

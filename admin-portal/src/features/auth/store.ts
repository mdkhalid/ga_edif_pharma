import type { AuthenticatedUserProfile } from '@medichain/shared-types';
import { create } from 'zustand';

/**
 * The admin session store.
 *
 * Identical in shape to the website's, and identical in its most important
 * property: the access token lives in memory only. The admin portal is the higher-
 * value target — it can change prices, approve credit and read every order — so the
 * rules are stricter here, not looser.
 */

export type AuthStatus = 'unknown' | 'authenticated' | 'anonymous';

interface AuthState {
  accessToken: string | null;
  user: AuthenticatedUserProfile | null;
  status: AuthStatus;
  setSession: (accessToken: string, user: AuthenticatedUserProfile) => void;
  setAccessToken: (accessToken: string) => void;
  clear: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  user: null,
  status: 'unknown',

  setSession: (accessToken, user) => set({ accessToken, user, status: 'authenticated' }),

  setAccessToken: (accessToken) =>
    set((state) => ({
      accessToken,
      status: state.status === 'unknown' ? 'authenticated' : state.status,
    })),

  clear: () => set({ accessToken: null, user: null, status: 'anonymous' }),
}));

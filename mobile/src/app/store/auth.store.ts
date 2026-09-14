import type { AuthenticatedUserProfile } from '@medichain/shared-types';
import { create } from 'zustand';

/**
 * Session state for the app.
 *
 * The access token is in memory only — never persisted, not even to the Keychain.
 * It is short-lived (15 minutes) and re-obtainable from the refresh token, so
 * persisting it would add a durable secret for no benefit. This mirrors the web
 * apps' store exactly, for the same reason.
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

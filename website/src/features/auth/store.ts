import type { AuthenticatedUserProfile } from '@medichain/shared-types';
import { create } from 'zustand';

/**
 * The browser's authentication state.
 *
 * ## The access token is in memory, and only in memory
 *
 * It is deliberately not in `localStorage`, not in `sessionStorage`, and not in a
 * readable cookie. Any of those is readable by an injected script, which turns one
 * XSS into a durable account takeover. In memory it dies with the tab.
 *
 * The consequence — a reload loses the token — is handled by the refresh cookie:
 * on load, the app silently exchanges the HttpOnly cookie for a new access token.
 * That is why there is an `unknown` status: the app is neither signed in nor
 * signed out until that exchange has been attempted.
 *
 * The refresh token is never in this store. It is set by the BFF route as an
 * HttpOnly cookie and is unreadable from here by design.
 */

export type AuthStatus = 'unknown' | 'authenticated' | 'anonymous';

interface AuthState {
  accessToken: string | null;
  user: AuthenticatedUserProfile | null;
  status: AuthStatus;
  /** Called after login or a successful refresh. */
  setSession: (accessToken: string, user: AuthenticatedUserProfile) => void;
  /** Called after a silent refresh, which returns a token but not a profile. */
  setAccessToken: (accessToken: string) => void;
  setUser: (user: AuthenticatedUserProfile) => void;
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
      // A refresh proves the session is valid, so an `unknown` state resolves to
      // authenticated even before the profile has been re-fetched.
      status: state.status === 'unknown' ? 'authenticated' : state.status,
    })),

  setUser: (user) => set({ user }),

  clear: () => set({ accessToken: null, user: null, status: 'anonymous' }),
}));

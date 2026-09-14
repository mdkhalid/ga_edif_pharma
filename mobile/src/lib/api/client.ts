import {
  ApiError,
  createApiClient,
  createAuthApi,
  type AuthApi,
  type RegisterResult,
} from '@medichain/api-client';
import type { AuthenticatedUserProfile } from '@medichain/shared-types';

import { env } from '../env';
import { useAuthStore } from '../../app/store/auth.store';
import { clearRefreshToken, getRefreshToken, saveRefreshToken } from '../storage/secure-store';

/**
 * The mobile API layer.
 *
 * There is no BFF here — a native app has no server to hold the refresh token — so
 * the app talks to `/auth/refresh` directly and stores the rotated token in the
 * Keychain. That makes the single-flight guard below more important than it is on the
 * web: two concurrent refreshes would present the same one-time token, the API would
 * read the second as theft, and every session in the family would be revoked.
 */

function clientWith(getAccessToken?: () => string | null) {
  return createApiClient({
    baseUrl: env.apiBaseUrl,
    appVersion: env.appVersion,
    appPlatform: env.appPlatform,
    ...(getAccessToken === undefined ? {} : { getAccessToken }),
  });
}

/** Endpoints that need no token: register, verify, forgot/reset password. */
export const publicAuthApi: AuthApi = createAuthApi(clientWith());

let refreshInFlight: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  refreshInFlight ??= (async (): Promise<string | null> => {
    try {
      const refreshToken = await getRefreshToken();
      if (refreshToken === null) return null;

      const session = await publicAuthApi.refresh(refreshToken);

      // The backend rotated the token; the old one is now dead, so persisting the
      // new one before anything else is what keeps the session alive.
      await saveRefreshToken(session.tokens.refreshToken);
      useAuthStore.getState().setAccessToken(session.tokens.accessToken);
      return session.tokens.accessToken;
    } catch {
      // A refresh token the API has rejected is dead (expired, revoked, or replayed).
      // Keeping it would make every launch retry a request that cannot succeed.
      await clearRefreshToken().catch(() => undefined);
      useAuthStore.getState().clear();
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

export async function callAuthed<T>(fn: (auth: AuthApi) => Promise<T>): Promise<T> {
  try {
    return await fn(createAuthApi(clientWith(() => useAuthStore.getState().accessToken)));
  } catch (error) {
    if (error instanceof ApiError && error.isUnauthenticated) {
      const token = await refreshAccessToken();
      if (token !== null) return fn(createAuthApi(clientWith(() => token)));
    }
    throw error;
  }
}

/** Resolves the session on launch from the Keychain. */
export async function bootstrapSession(): Promise<void> {
  const token = await refreshAccessToken();
  if (token === null) {
    useAuthStore.getState().clear();
    return;
  }

  try {
    const user: AuthenticatedUserProfile = await callAuthed((auth) => auth.me());
    useAuthStore.getState().setSession(token, user);
  } catch {
    useAuthStore.getState().clear();
  }
}

export async function login(values: { identifier: string; password: string }): Promise<void> {
  const session = await publicAuthApi.login(values);

  await saveRefreshToken(session.tokens.refreshToken);
  useAuthStore.getState().setSession(session.tokens.accessToken, session.user);
}

export async function logout(): Promise<void> {
  try {
    await callAuthed((auth) => auth.logout());
  } catch {
    // Best effort — the local session is cleared regardless, because a network
    // failure must not leave the user apparently signed in.
  } finally {
    await clearRefreshToken().catch(() => undefined);
    useAuthStore.getState().clear();
  }
}

/**
 * An `Idempotency-Key` for registration.
 *
 * Uses the Web Crypto API when the runtime provides it and falls back to a
 * timestamp-plus-randomness key otherwise. Hermes does not implement
 * `crypto.randomUUID` on every platform yet, and a registration that fails because a
 * helper was missing is a bad failure mode; the key only needs to be unique per
 * attempt, not unguessable.
 */
function idempotencyKey(): string {
  const runtimeCrypto = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (typeof runtimeCrypto?.randomUUID === 'function') {
    return runtimeCrypto.randomUUID();
  }
  return `mob-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function register(values: {
  fullName: string;
  email: string;
  password: string;
}): Promise<RegisterResult> {
  return publicAuthApi.register(values, idempotencyKey());
}

export async function requestContactVerification(
  identifier: string,
): Promise<{ devCode?: string }> {
  return publicAuthApi.requestContactVerification(identifier);
}

export async function verifyContact(identifier: string, code: string): Promise<void> {
  await publicAuthApi.verifyContact(identifier, code);
}

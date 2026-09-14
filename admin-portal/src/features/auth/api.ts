'use client';

import { ApiError, createApiClient, createAuthApi, toApiError, type AuthApi } from '@medichain/api-client';
import type { AuthenticatedUserProfile } from '@medichain/shared-types';

import { env } from '@/lib/env';

import type { LoginValues } from './schemas';
import { useAuthStore } from './store';

/**
 * The admin portal's auth API.
 *
 * Same split as the website: `login`/`refresh`/`logout` go through the BFF routes
 * (the only calls that touch the refresh cookie), everything else calls the API
 * directly with a bearer token.
 */

function clientWith(getAccessToken?: () => string | null) {
  return createApiClient({
    baseUrl: env.apiBaseUrl,
    appVersion: env.appVersion,
    appPlatform: env.appPlatform,
    ...(getAccessToken === undefined ? {} : { getAccessToken }),
  });
}

async function bffError(response: Response): Promise<ApiError> {
  const parsed: unknown = await response.json().catch(() => undefined);
  return toApiError(response, parsed);
}

/**
 * Single-flight refresh.
 *
 * The backend rotates the refresh token on every use, so concurrent refreshes would
 * present an already-used token, be read as theft, and revoke the family. Sharing
 * one in-flight promise is what makes rotation safe when several admin tables load
 * at once.
 */
let refreshInFlight: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  refreshInFlight ??= (async (): Promise<string | null> => {
    try {
      const response = await fetch('/api/auth/refresh', {
        method: 'POST',
        credentials: 'same-origin',
      });
      if (!response.ok) {
        useAuthStore.getState().clear();
        return null;
      }
      const body = (await response.json()) as { data: { accessToken: string } };
      useAuthStore.getState().setAccessToken(body.data.accessToken);
      return body.data.accessToken;
    } catch {
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

export async function login(values: LoginValues): Promise<void> {
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(values),
  });

  if (!response.ok) throw await bffError(response);

  const body = (await response.json()) as {
    data: { accessToken: string; user: AuthenticatedUserProfile };
  };
  useAuthStore.getState().setSession(body.data.accessToken, body.data.user);
}

export async function logout(): Promise<void> {
  const { accessToken } = useAuthStore.getState();

  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'same-origin',
      headers: accessToken === null ? {} : { Authorization: `Bearer ${accessToken}` },
    });
  } finally {
    useAuthStore.getState().clear();
  }
}

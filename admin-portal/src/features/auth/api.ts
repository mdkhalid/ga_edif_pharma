'use client';

import { ApiError, createApiClient, createAuthApi, toApiError, type MediChainClient } from '@medichain/api-client';
import type { AuthenticatedUserProfile, MfaSetupResult } from '@medichain/shared-types';

import { env } from '@/lib/env';

import type { LoginValues } from './schemas';
import { useAuthStore } from './store';

/**
 * The admin portal's auth API.
 *
 * Same split as the website: `login`/`refresh`/`logout` go through the BFF routes
 * (the only calls that touch the refresh cookie), everything else calls the API
 * directly with a bearer token.
 *
 * MFA rides the same split: the challenge from `login` is redeemed at
 * `/api/auth/mfa/*`, which sets the cookie on success just as the password step
 * would have.
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

export async function callAuthed<T>(fn: (client: MediChainClient) => Promise<T>): Promise<T> {
  try {
    return await fn(clientWith(() => useAuthStore.getState().accessToken));
  } catch (error) {
    if (error instanceof ApiError && error.isUnauthenticated) {
      const token = await refreshAccessToken();
      if (token !== null) return fn(clientWith(() => token));
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
    const user: AuthenticatedUserProfile = await callAuthed((client) => createAuthApi(client).me());
    useAuthStore.getState().setSession(token, user);
  } catch {
    useAuthStore.getState().clear();
  }
}

/** Password accepted but a second factor is owed — no session exists yet. */
export interface MfaChallengeState {
  readonly mfaToken: string;
  readonly mfaEnrollment: boolean;
}

/**
 * Outcome of the password step.
 *
 * A challenge is returned rather than thrown: it is a normal intermediate
 * state of sign-in, not a failure, and the page switches steps on it.
 */
export type LoginOutcome = { mfaRequired: false } | ({ mfaRequired: true } & MfaChallengeState);

export async function login(values: LoginValues): Promise<LoginOutcome> {
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(values),
  });

  if (!response.ok) throw await bffError(response);

  const body = (await response.json()) as {
    data:
      | { mfaRequired: false; accessToken: string; user: AuthenticatedUserProfile }
      | { mfaRequired: true; mfaToken: string; mfaEnrollment: boolean; expiresAt: string };
  };

  if (body.data.mfaRequired) {
    return {
      mfaRequired: true,
      mfaToken: body.data.mfaToken,
      mfaEnrollment: body.data.mfaEnrollment,
    };
  }

  useAuthStore.getState().setSession(body.data.accessToken, body.data.user);
  return { mfaRequired: false };
}

interface SessionBody {
  accessToken: string;
  user: AuthenticatedUserProfile;
}

function adoptSession(data: SessionBody): void {
  useAuthStore.getState().setSession(data.accessToken, data.user);
}

/** Starts TOTP enrolment for the pending sign-in challenge. */
export async function mfaSetup(mfaToken: string): Promise<MfaSetupResult> {
  const response = await fetch('/api/auth/mfa/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ mfaToken }),
  });

  if (!response.ok) throw await bffError(response);
  const body = (await response.json()) as { data: MfaSetupResult };
  return body.data;
}

/**
 * Confirms enrolment with a code from the authenticator app.
 *
 * During sign-in the BFF sets the refresh cookie and the store gets the
 * session; the recovery codes are returned for the one display the user gets.
 */
export async function mfaConfirm(
  mfaToken: string,
  code: string,
): Promise<{ recoveryCodes: readonly string[] }> {
  const response = await fetch('/api/auth/mfa/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ mfaToken, code }),
  });

  if (!response.ok) throw await bffError(response);
  const body = (await response.json()) as {
    data: { accessToken?: string; user?: AuthenticatedUserProfile; recoveryCodes: readonly string[] };
  };

  if (body.data.accessToken !== undefined && body.data.user !== undefined) {
    adoptSession({ accessToken: body.data.accessToken, user: body.data.user });
  }

  return { recoveryCodes: body.data.recoveryCodes };
}

/** Redeems an enrolled account's challenge with a TOTP or recovery code. */
export async function mfaLogin(mfaToken: string, code: string): Promise<void> {
  const response = await fetch('/api/auth/mfa/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ mfaToken, code }),
  });

  if (!response.ok) throw await bffError(response);
  const body = (await response.json()) as { data: SessionBody };
  adoptSession(body.data);
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

'use client';

import {
  ApiError,
  createApiClient,
  createAuthApi,
  toApiError,
  type AuthApi,
  type MediChainClient,
  type RegisterResult,
} from '@medichain/api-client';
import type { AuthenticatedUserProfile } from '@medichain/shared-types';

import { env } from '@/lib/env';

import type {
  ForgotPasswordValues,
  LoginValues,
  RegisterValues,
  ResetPasswordValues,
} from './schemas';
import { useAuthStore } from './store';

/**
 * The browser's auth API.
 *
 * ## Two transports, on purpose
 *
 * `login`, `refresh` and `logout` go to **our own BFF routes** (`/api/auth/*`),
 * because they are the only calls that touch the refresh token — and the refresh
 * token must live in an HttpOnly cookie, which only a server route can set.
 *
 * Everything else calls the backend **directly** with a bearer token. Routing
 * those through the BFF as well would turn every request into two hops and make the
 * Next server a bottleneck for no security benefit.
 */

function clientWith(getAccessToken?: () => string | null) {
  return createApiClient({
    baseUrl: env.apiBaseUrl,
    appVersion: env.appVersion,
    appPlatform: 'web',
    ...(getAccessToken === undefined ? {} : { getAccessToken }),
  });
}

/** Endpoints that need no token: register, verify, forgot/reset password. */
export const publicAuthApi: AuthApi = createAuthApi(clientWith());

/** Turns a failed BFF response into the same `ApiError` the client produces. */
async function bffError(response: Response): Promise<ApiError> {
  const parsed: unknown = await response.json().catch(() => undefined);
  return toApiError(response, parsed);
}

/**
 * In-flight refresh, shared by every caller.
 *
 * Without this, five components that all get a 401 at once trigger five refreshes.
 * The backend rotates the refresh token on every use, so four of those five would
 * present an already-used token — which the API correctly reads as token theft,
 * revokes the whole family, and signs the user out. De-duplicating is not an
 * optimisation; it is what makes rotation safe under concurrency.
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

/**
 * Runs an authenticated call, refreshing once and retrying on a 401.
 *
 * The callable is handed a **client**, not an `AuthApi`, so every feature runs
 * through this one function rather than growing its own transport. That matters
 * more than it looks: the single-flight guard above is what makes concurrent 401s
 * safe, and a second copy of this function is a second place for the guard to be
 * forgotten — at which point five simultaneous refreshes present an already-rotated
 * token and the API, correctly, revokes the whole family.
 *
 * The retry is bounded to a single attempt: a second 401 after a successful
 * refresh means the problem is not an expired token, and looping would hammer the
 * API while the user stares at a spinner.
 */
export async function callAuthed<T>(fn: (client: MediChainClient) => Promise<T>): Promise<T> {
  try {
    return await fn(clientWith(() => useAuthStore.getState().accessToken));
  } catch (error) {
    if (error instanceof ApiError && error.isUnauthenticated) {
      const token = await refreshAccessToken();
      if (token !== null) {
        return fn(clientWith(() => token));
      }
    }
    throw error;
  }
}

/**
 * Resolves the session on page load.
 *
 * The access token is memory-only, so a reload always starts signed out as far as
 * this tab knows. The HttpOnly refresh cookie is the durable half; exchanging it is
 * what turns a reload back into a signed-in session, without the user re-entering
 * anything.
 */
export async function bootstrapSession(): Promise<void> {
  const token = await refreshAccessToken();
  if (token === null) {
    useAuthStore.getState().clear();
    return;
  }

  try {
    const user: AuthenticatedUserProfile = await callAuthed((client) =>
      createAuthApi(client).me(),
    );
    useAuthStore.getState().setSession(token, user);
  } catch {
    useAuthStore.getState().clear();
  }
}

export type LoginOutcome =
  | { mfaRequired: false }
  | { mfaRequired: true; mfaEnrollment: boolean };

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

  // Buyers are exempt from MFA, so a challenge here is unexpected — but the
  // union is still branched on so a future policy change fails visibly instead
  // of writing `undefined` into the session store.
  if (body.data.mfaRequired) {
    return { mfaRequired: true, mfaEnrollment: body.data.mfaEnrollment };
  }

  useAuthStore.getState().setSession(body.data.accessToken, body.data.user);
  return { mfaRequired: false };
}

export async function logout(): Promise<void> {
  const { accessToken } = useAuthStore.getState();

  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'same-origin',
      // The backend revokes the *session* the access token belongs to, so it needs
      // the token. The refresh cookie alone would not identify which session to end.
      headers: accessToken === null ? {} : { Authorization: `Bearer ${accessToken}` },
    });
  } finally {
    // Local state is cleared whatever the server said. A logout that leaves the
    // user apparently signed in because the network failed is a worse outcome than
    // a server-side session that outlives its client.
    useAuthStore.getState().clear();
  }
}

export async function register(values: RegisterValues): Promise<RegisterResult> {
  return publicAuthApi.register(
    {
      fullName: values.fullName,
      email: values.email,
      password: values.password,
      ...(values.tenantCode === undefined || values.tenantCode === ''
        ? {}
        : { tenantCode: values.tenantCode }),
    },
    // The backend requires an Idempotency-Key on registration: a double-click, or a
    // retry after a dropped response, must not create a second account.
    crypto.randomUUID(),
  );
}

export async function requestContactVerification(identifier: string): Promise<{ devCode?: string }> {
  return publicAuthApi.requestContactVerification(identifier);
}

export async function verifyContact(identifier: string, code: string): Promise<void> {
  await publicAuthApi.verifyContact(identifier, code);
}

export async function forgotPassword(values: ForgotPasswordValues): Promise<{ devCode?: string }> {
  return publicAuthApi.forgotPassword(values.identifier);
}

export async function resetPassword(values: ResetPasswordValues): Promise<void> {
  await publicAuthApi.resetPassword({
    identifier: values.identifier,
    code: values.code,
    newPassword: values.newPassword,
  });
}

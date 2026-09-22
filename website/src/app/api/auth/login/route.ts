import { ApiError, createApiClient, createAuthApi } from '@medichain/api-client';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { REFRESH_COOKIE, refreshCookieOptions } from '@/lib/auth/cookies';
import { isSameOrigin, secondsUntil } from '@/lib/auth/session';
import { env } from '@/lib/env';

/**
 * BFF sign-in.
 *
 * The browser cannot hold the refresh token: it must be HttpOnly, which means only
 * a server can set it. So the browser posts credentials here, this route exchanges
 * them at the API, keeps the refresh token in a cookie, and returns the **access**
 * token to the page — which holds it in memory and never persists it.
 *
 * This route runs on the Node.js runtime because it imports the API client, which
 * uses Node's `fetch` and its own header handling. It could run on the edge, but
 * there is no reason to pay for that portability here.
 */

const API_BASE_URL = process.env.API_BASE_URL ?? env.apiBaseUrl;
const SERVER_CLIENT = createApiClient({ baseUrl: API_BASE_URL, appPlatform: 'web' });

interface LoginBody {
  identifier?: unknown;
  password?: unknown;
}

function readCredentials(body: unknown): { identifier: string; password: string } | null {
  if (typeof body !== 'object' || body === null) return null;
  const { identifier, password } = body as LoginBody;
  if (typeof identifier !== 'string' || typeof password !== 'string') return null;
  if (identifier.trim() === '' || password === '') return null;
  return { identifier, password };
}

export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) {
    return NextResponse.json(
      { detail: 'Cross-origin sign-in is not permitted.' },
      { status: 403 },
    );
  }

  const credentials = readCredentials(await request.json().catch(() => null));
  if (credentials === null) {
    return NextResponse.json(
      { detail: 'An identifier and a password are required.' },
      { status: 400 },
    );
  }

  try {
    const session = await createAuthApi(SERVER_CLIENT).login(credentials);

    // Buyers are exempt from MFA today, but the union is handled anyway: a
    // challenge must never set a refresh cookie, because no session exists yet.
    if (session.mfaRequired) {
      return NextResponse.json({
        data: {
          mfaRequired: true,
          mfaToken: session.mfaToken,
          mfaEnrollment: session.mfaEnrollment,
          expiresAt: session.expiresAt,
        },
      });
    }

    const store = await cookies();

    store.set(
      REFRESH_COOKIE,
      session.tokens.refreshToken,
      refreshCookieOptions(
        secondsUntil(session.tokens.refreshTokenExpiresAt),
        process.env.NODE_ENV === 'production',
      ),
    );

    // The refresh token is deliberately absent from this response. Returning it
    // would put it back within reach of an injected script, which is the whole
    // thing the cookie exists to prevent.
    return NextResponse.json({
      data: {
        mfaRequired: false,
        accessToken: session.tokens.accessToken,
        accessTokenExpiresAt: session.tokens.accessTokenExpiresAt,
        user: session.user,
      },
    });
  } catch (error) {
    if (error instanceof ApiError) {
      // The upstream problem document is passed through unchanged, so the browser
      // sees the same `ErrorCode` the API produced — `ACCOUNT_NOT_VERIFIED`,
      // `INVALID_CREDENTIALS`, `RATE_LIMITED` — and can branch on it.
      return NextResponse.json(
        error.problem ?? { detail: error.message, status: error.status },
        { status: error.status },
      );
    }

    return NextResponse.json({ detail: 'Sign-in failed. Try again.' }, { status: 502 });
  }
}

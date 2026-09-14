import { ApiError, createApiClient, createAuthApi } from '@medichain/api-client';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { REFRESH_COOKIE, refreshCookieOptions } from '@/lib/auth/cookies';
import { isSameOrigin, secondsUntil } from '@/lib/auth/session';
import { env } from '@/lib/env';

/**
 * Admin BFF sign-in.
 *
 * The browser cannot hold the refresh token (it must be HttpOnly), so credentials are
 * posted here, exchanged at the API, and the refresh token is kept in a cookie scoped
 * to `/api/auth`. Only the access token goes back to the page.
 *
 * The cookie name differs from the website's (`mc_admin_refresh`), so a staff member
 * signed into both portals holds two independent sessions — revoking one does not
 * disturb the other.
 */

const API_BASE_URL = process.env.API_BASE_URL ?? env.apiBaseUrl;
const SERVER_CLIENT = createApiClient({ baseUrl: API_BASE_URL, appPlatform: env.appPlatform });

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
    return NextResponse.json({ detail: 'Cross-origin sign-in is not permitted.' }, { status: 403 });
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
    const store = await cookies();

    store.set(
      REFRESH_COOKIE,
      session.tokens.refreshToken,
      refreshCookieOptions(
        secondsUntil(session.tokens.refreshTokenExpiresAt),
        process.env.NODE_ENV === 'production',
      ),
    );

    return NextResponse.json({
      data: {
        accessToken: session.tokens.accessToken,
        accessTokenExpiresAt: session.tokens.accessTokenExpiresAt,
        user: session.user,
      },
    });
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        error.problem ?? { detail: error.message, status: error.status },
        { status: error.status },
      );
    }
    return NextResponse.json({ detail: 'Sign-in failed. Try again.' }, { status: 502 });
  }
}

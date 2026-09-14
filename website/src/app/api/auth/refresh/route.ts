import { ApiError, createApiClient, createAuthApi } from '@medichain/api-client';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { REFRESH_COOKIE, refreshCookieOptions } from '@/lib/auth/cookies';
import { isSameOrigin, secondsUntil } from '@/lib/auth/session';
import { env } from '@/lib/env';

/**
 * BFF token rotation.
 *
 * The page calls this when a request comes back 401, and once on load to recover a
 * session after a reload. The refresh token never leaves the server: it is read
 * from the cookie, exchanged at the API, and replaced in the cookie with the newly
 * rotated value.
 *
 * Every failure clears the cookie. A refresh token that the API has rejected —
 * expired, revoked, or replayed and had its whole family revoked — is dead, and
 * leaving it in the browser means every subsequent reload retries a request that
 * cannot succeed.
 */

const API_BASE_URL = process.env.API_BASE_URL ?? env.apiBaseUrl;
const SERVER_CLIENT = createApiClient({ baseUrl: API_BASE_URL, appPlatform: 'web' });

export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ detail: 'Cross-origin refresh is not permitted.' }, { status: 403 });
  }

  const store = await cookies();
  const refreshToken = store.get(REFRESH_COOKIE)?.value;
  const secure = process.env.NODE_ENV === 'production';

  /** Expire the cookie in place. `maxAge: 0` with the same path is the reliable form. */
  const clearCookie = (): void => {
    store.set(REFRESH_COOKIE, '', refreshCookieOptions(0, secure));
  };

  if (refreshToken === undefined || refreshToken === '') {
    return NextResponse.json({ detail: 'No session to refresh.' }, { status: 401 });
  }

  try {
    const session = await createAuthApi(SERVER_CLIENT).refresh(refreshToken);

    store.set(
      REFRESH_COOKIE,
      session.tokens.refreshToken,
      refreshCookieOptions(secondsUntil(session.tokens.refreshTokenExpiresAt), secure),
    );

    return NextResponse.json({
      data: { accessToken: session.tokens.accessToken, user: session.user },
    });
  } catch (error) {
    clearCookie();

    if (error instanceof ApiError) {
      return NextResponse.json(
        error.problem ?? { detail: error.message, status: error.status },
        { status: error.status },
      );
    }

    return NextResponse.json({ detail: 'Could not refresh the session.' }, { status: 401 });
  }
}

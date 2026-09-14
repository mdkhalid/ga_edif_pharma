import { ApiError, createApiClient, createAuthApi } from '@medichain/api-client';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { REFRESH_COOKIE, refreshCookieOptions } from '@/lib/auth/cookies';
import { isSameOrigin, secondsUntil } from '@/lib/auth/session';
import { env } from '@/lib/env';

/**
 * Admin BFF token rotation.
 *
 * Called on load to recover a session after a reload, and when a request comes back
 * 401. The refresh token stays server-side: read from the cookie, exchanged at the
 * API, replaced in the cookie with the rotated value.
 *
 * Every failure clears the cookie — a refresh token the API has rejected is dead, and
 * leaving it in the browser means every reload retries a request that cannot succeed.
 */

const API_BASE_URL = process.env.API_BASE_URL ?? env.apiBaseUrl;
const SERVER_CLIENT = createApiClient({ baseUrl: API_BASE_URL, appPlatform: env.appPlatform });

export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ detail: 'Cross-origin refresh is not permitted.' }, { status: 403 });
  }

  const store = await cookies();
  const refreshToken = store.get(REFRESH_COOKIE)?.value;
  const secure = process.env.NODE_ENV === 'production';

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
    store.set(REFRESH_COOKIE, '', refreshCookieOptions(0, secure));

    if (error instanceof ApiError) {
      return NextResponse.json(
        error.problem ?? { detail: error.message, status: error.status },
        { status: error.status },
      );
    }
    return NextResponse.json({ detail: 'Could not refresh the session.' }, { status: 401 });
  }
}

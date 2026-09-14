import { createApiClient, createAuthApi } from '@medichain/api-client';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { REFRESH_COOKIE, refreshCookieOptions } from '@/lib/auth/cookies';
import { isSameOrigin } from '@/lib/auth/session';
import { env } from '@/lib/env';

/**
 * Admin BFF sign-out.
 *
 * Revokes the session server-side (best effort — the access token identifies which
 * session to end) and clears the cookie in the browser. Neither alone is sufficient:
 * skipping the revoke leaves a live refresh token in the database, skipping the clear
 * leaves the page retrying a dead one.
 */

const API_BASE_URL = process.env.API_BASE_URL ?? env.apiBaseUrl;

export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ detail: 'Cross-origin sign-out is not permitted.' }, { status: 403 });
  }

  const accessToken = request.headers
    .get('authorization')
    ?.replace(/^Bearer\s+/i, '')
    .trim();

  if (accessToken !== undefined && accessToken !== '') {
    try {
      const client = createApiClient({
        baseUrl: API_BASE_URL,
        appPlatform: env.appPlatform,
        getAccessToken: () => accessToken,
      });
      await createAuthApi(client).logout();
    } catch {
      // Best effort; see the note above.
    }
  }

  const store = await cookies();
  store.set(REFRESH_COOKIE, '', refreshCookieOptions(0, process.env.NODE_ENV === 'production'));

  return new NextResponse(null, { status: 204 });
}

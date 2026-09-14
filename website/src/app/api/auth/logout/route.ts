import { createApiClient, createAuthApi } from '@medichain/api-client';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { REFRESH_COOKIE, refreshCookieOptions } from '@/lib/auth/cookies';
import { isSameOrigin } from '@/lib/auth/session';
import { env } from '@/lib/env';

/**
 * BFF sign-out.
 *
 * Two things must happen, and neither is sufficient alone: the API must revoke the
 * session server-side, and the cookie must be cleared in the browser. Skipping the
 * first leaves a valid refresh token in the database; skipping the second leaves a
 * token in the browser that the page will try to use on the next load.
 *
 * The upstream revoke is best-effort. If it fails, the cookie is still cleared and
 * the response is still 204 — the session will expire on its own, and refusing to
 * sign the user out locally because the network is down is the wrong trade.
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
        appPlatform: 'web',
        getAccessToken: () => accessToken,
      });
      await createAuthApi(client).logout();
    } catch {
      // Best effort; see the note above.
    }
  }

  const store = await cookies();
  store.set(
    REFRESH_COOKIE,
    '',
    refreshCookieOptions(0, process.env.NODE_ENV === 'production'),
  );

  return new NextResponse(null, { status: 204 });
}

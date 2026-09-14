import { NextResponse, type NextRequest } from 'next/server';

import { REFRESH_COOKIE } from '@/lib/auth/cookies';

/**
 * Route protection for the authenticated area.
 *
 * ## What this is, and what it is not
 *
 * It is a **redirect convenience**. It checks that a refresh cookie is present and,
 * if not, sends the visitor to the sign-in page with a `next` parameter so they
 * land where they were headed.
 *
 * It is **not** access control. The cookie's presence says nothing about whether
 * the session is still valid, and the middleware cannot verify it anyway — the
 * access token lives in memory and the refresh token is opaque. Every byte of
 * protected data is authorised by the API on the strength of a bearer token. A
 * visitor who forges a cookie gets past this redirect and then sees an empty,
 * broken shell, which is the correct failure mode.
 */
export function middleware(request: NextRequest): NextResponse {
  if (request.cookies.has(REFRESH_COOKIE)) {
    return NextResponse.next();
  }

  const url = request.nextUrl.clone();
  url.pathname = '/login';
  url.search = '';
  url.searchParams.set('next', request.nextUrl.pathname);
  return NextResponse.redirect(url);
}

export const config = {
  // Only the authenticated area. Everything else — the landing page, the public
  // catalogue, the auth screens themselves — must stay reachable.
  matcher: ['/dashboard/:path*'],
};

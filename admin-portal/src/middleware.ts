import { NextResponse, type NextRequest } from 'next/server';

import { REFRESH_COOKIE } from '@/lib/auth/cookies';

/**
 * Route protection for the back office.
 *
 * A redirect convenience, not access control: it checks that a refresh cookie is
 * present and otherwise sends the visitor to sign-in. Whether the session is still
 * *valid* is decided by the API on every request — a forged cookie gets past this and
 * then sees nothing but refused requests, which is the correct failure mode.
 */
export function middleware(request: NextRequest): NextResponse {
  if (request.cookies.has(REFRESH_COOKIE)) {
    return NextResponse.next();
  }

  const url = request.nextUrl.clone();
  url.pathname = '/login';
  url.search = '';
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/onboarding/:path*',
    '/catalog/:path*',
    '/orders/:path*',
    '/settings/:path*',
  ],
};

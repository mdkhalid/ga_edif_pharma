/**
 * Refresh-cookie constants.
 *
 * Copied from the website rather than shared. The two apps are separate
 * deployables with different threat models — the admin portal is expected to gain a
 * stricter session policy (shorter TTL, idle timeout, IP allow-list) — and a shared
 * constant would force them to move together. The *names* must still match what the
 * backend and the BFF routes use, so this is pinned by the same test in both apps.
 *
 * Kept dependency-free: `proxy.ts` runs ahead of every matched request and must
 * not pull in `next/headers`.
 */

/** Name of the refresh-token cookie. HttpOnly; never readable from the browser. */
export const REFRESH_COOKIE = 'mc_admin_refresh';

/**
 * Scoped to the BFF routes that manage it, not `/`, so it is never attached to
 * ordinary page requests or to direct calls the browser makes to the API.
 */
export const REFRESH_COOKIE_PATH = '/api/auth';

export interface RefreshCookieOptions {
  httpOnly: true;
  secure: boolean;
  sameSite: 'strict';
  path: string;
  maxAge: number;
}

export function refreshCookieOptions(maxAgeSeconds: number, secure: boolean): RefreshCookieOptions {
  return {
    httpOnly: true,
    secure,
    sameSite: 'strict',
    path: REFRESH_COOKIE_PATH,
    maxAge: maxAgeSeconds,
  };
}

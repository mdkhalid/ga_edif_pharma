/**
 * Refresh-cookie constants, shared by the middleware and the BFF route handlers.
 *
 * Kept in a dependency-free module on purpose: `middleware.ts` runs on the edge
 * runtime, and importing a file that pulls in `next/headers` or a server-only
 * dependency would break the build. A duplicated string constant would be worse —
 * the cookie name drifting between the writer and the reader is a silent,
 * total sign-out.
 */

/** Name of the refresh-token cookie. HttpOnly; never readable from the browser. */
export const REFRESH_COOKIE = 'mc_refresh';

/**
 * The refresh cookie is scoped to the BFF routes that manage it, not to `/`.
 *
 * Scoping it means the cookie is not attached to ordinary page requests or to the
 * direct calls the browser makes to the API, so it cannot leak through a request
 * the application does not control.
 */
export const REFRESH_COOKIE_PATH = '/api/auth';

export interface RefreshCookieOptions {
  httpOnly: true;
  secure: boolean;
  sameSite: 'strict';
  path: string;
  maxAge: number;
}

/**
 * Cookie attributes.
 *
 * `SameSite=Strict` is the CSRF defence for a cookie-authenticated endpoint: a
 * cross-site form post cannot cause the browser to attach it. `secure` is off in
 * development because the dev server is plain HTTP.
 */
export function refreshCookieOptions(maxAgeSeconds: number, secure: boolean): RefreshCookieOptions {
  return {
    httpOnly: true,
    secure,
    sameSite: 'strict',
    path: REFRESH_COOKIE_PATH,
    maxAge: maxAgeSeconds,
  };
}

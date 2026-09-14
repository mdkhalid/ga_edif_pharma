/**
 * Server-side helpers for the admin BFF route handlers.
 */

/**
 * Rejects a state-changing request whose `Origin` is not this site.
 *
 * `SameSite=Strict` on the refresh cookie blocks a cross-site post from carrying it;
 * this is the independent second check, and it also covers the login route, which
 * sets the cookie in the first place.
 *
 * A missing `Origin` is allowed — some same-origin clients omit it, and the cookie's
 * SameSite policy still applies.
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (origin === null || origin === '') return true;

  const host = request.headers.get('host');
  if (host === null) return false;

  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** Seconds from now until `iso`, floored at zero, for a cookie `maxAge`. */
export function secondsUntil(iso: string | undefined): number {
  if (iso === undefined) return 0;
  const millis = new Date(iso).getTime() - Date.now();
  return millis <= 0 ? 0 : Math.floor(millis / 1000);
}

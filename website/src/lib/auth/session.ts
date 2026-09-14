/**
 * Small server-side helpers for the BFF route handlers.
 */

/**
 * Rejects a state-changing request whose `Origin` is not this site.
 *
 * `SameSite=Strict` on the refresh cookie already blocks a cross-site post from
 * carrying it, but this is the second, independent check: it also protects the
 * login route, which sets the cookie in the first place. Login CSRF is a real
 * attack — a victim silently signed into an attacker's account, after which the
 * attacker can read what the victim uploads.
 *
 * A missing `Origin` is allowed: same-origin `fetch` from a service worker or a
 * native shell may omit it, and the cookie's SameSite policy still applies.
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

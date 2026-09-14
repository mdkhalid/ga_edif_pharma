/**
 * Public environment.
 *
 * Only `NEXT_PUBLIC_*` values may appear here — they are inlined into the browser
 * bundle at build time, so anything secret would be published. The API base URL is
 * public by definition: the browser calls the API directly with a bearer token.
 * The refresh token never goes through this path; it lives in an HttpOnly cookie
 * managed by the BFF route handlers under `/api/auth`.
 */
const DEFAULT_API_BASE_URL = 'http://localhost:3001/api/v1';

export const env = {
  /** Absolute, and includes the `/api/v1` prefix the OpenAPI document omits. */
  apiBaseUrl: process.env.NEXT_PUBLIC_API_BASE_URL ?? DEFAULT_API_BASE_URL,
  /** Sent as `X-App-Version` for the server's force-upgrade check. */
  appVersion: process.env.NEXT_PUBLIC_APP_VERSION ?? '0.1.0',
} as const;

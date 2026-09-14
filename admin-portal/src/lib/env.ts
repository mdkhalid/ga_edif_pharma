/**
 * Public environment — see the website's copy for why only `NEXT_PUBLIC_*` values
 * may appear here.
 */
const DEFAULT_API_BASE_URL = 'http://localhost:3001/api/v1';

export const env = {
  /** Absolute, and includes the `/api/v1` prefix the OpenAPI document omits. */
  apiBaseUrl: process.env.NEXT_PUBLIC_API_BASE_URL ?? DEFAULT_API_BASE_URL,
  appVersion: process.env.NEXT_PUBLIC_APP_VERSION ?? '0.1.0',
  /** Sent as `X-App-Platform`, so the server can tell admin traffic from buyer traffic. */
  appPlatform: 'admin',
} as const;

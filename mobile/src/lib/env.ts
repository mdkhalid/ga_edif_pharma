/**
 * Mobile environment.
 *
 * `EXPO_PUBLIC_*` values are inlined into the JS bundle at build time, so only
 * public values may appear here. The API base URL is public by definition — the app
 * calls the API directly with a bearer token.
 *
 * Unlike the web apps there is no BFF: a React Native app has no server to set an
 * HttpOnly cookie, which is exactly why the refresh token goes into the device
 * Keychain/Keystore instead (see `src/lib/storage/secure-store.ts`).
 */
const DEFAULT_API_BASE_URL = 'http://localhost:3001/api/v1';

export const env = {
  apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL ?? DEFAULT_API_BASE_URL,
  appVersion: process.env.EXPO_PUBLIC_APP_VERSION ?? '0.1.0',
  /** Sent as `X-App-Platform`; the server uses it for the force-upgrade check. */
  appPlatform: 'mobile',
} as const;

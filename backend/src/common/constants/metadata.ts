/**
 * Reflector metadata keys.
 *
 * Declared as `const` objects rather than bare strings so that a typo in a
 * decorator is a compile error at the read site instead of a silently absent
 * guard — which would be a security hole that type-checks.
 */

export const META = {
  /** Marks a route as reachable without a valid access token. */
  IS_PUBLIC: 'medichain:is-public',
  /** Capabilities required to reach the route. ALL must be held. */
  REQUIRED_CAPABILITIES: 'medichain:required-capabilities',
  /** Capabilities of which at least one must be held. */
  REQUIRED_ANY_CAPABILITY: 'medichain:required-any-capability',
  /** System role codes allowed to reach the route. */
  REQUIRED_ROLES: 'medichain:required-roles',
  /** Per-route rate-limit override. */
  RATE_LIMIT: 'medichain:rate-limit',
  /** Route is idempotent; the interceptor enforces the Idempotency-Key header. */
  IDEMPOTENT: 'medichain:idempotent',
  /** Route legitimately runs without a tenant (login, platform settings). */
  SKIP_TENANT_SCOPE: 'medichain:skip-tenant-scope',
  /** Audit action recorded when the route succeeds. */
  AUDIT: 'medichain:audit',
  /** Response is not wrapped in the `{ data }` envelope. */
  RAW_RESPONSE: 'medichain:raw-response',
} as const;

export type MetaKey = (typeof META)[keyof typeof META];

/** Well-known request headers. Referenced by guards, interceptors and clients. */
export const HEADERS = {
  REQUEST_ID: 'x-request-id',
  CORRELATION_ID: 'x-correlation-id',
  IDEMPOTENCY_KEY: 'idempotency-key',
  /** Client build number, used by the mobile force-upgrade check. */
  APP_VERSION: 'x-app-version',
  APP_PLATFORM: 'x-app-platform',
  /** Stable per-installation id, used for device-bound sessions. */
  DEVICE_ID: 'x-device-id',
  TENANT_HINT: 'x-tenant-id',
} as const;

/**
 * Route-level rate limits.
 *
 * Applied by `@RateLimit()`. Keys are logical buckets, not paths, so the same
 * limit can be shared by several routes (every auth route, for instance).
 */
export const RATE_LIMIT_BUCKET = {
  AUTH: 'auth',
  SEARCH: 'search',
  DEFAULT: 'default',
  OTP: 'otp',
  EXPORT: 'export',
} as const;

export type RateLimitBucket = (typeof RATE_LIMIT_BUCKET)[keyof typeof RATE_LIMIT_BUCKET];

/**
 * Cache key builders and the list of things that may be cached.
 *
 * ## The allow-list is the point
 *
 * ADR-004 says price and stock are never served from a cache: they are the two
 * values a buyer acts on, and a stale one produces either a rejected order at
 * dispatch time or a margin loss. "Remember not to cache price" is a rule that
 * survives until the first time someone is chasing latency.
 *
 * So caching goes through `CacheNamespace` below. There is no
 * `cache.get('price:' + id)` helper to reach for, and adding a namespace is a
 * reviewable one-line diff rather than an invisible decision inside a service.
 */

export const CacheNamespace = {
  /** Product detail projection. Prices are joined at read time, never stored. */
  PRODUCT_DETAIL: 'catalog:product',
  /** Category tree. Changes rarely; read on every navigation. */
  CATEGORY_TREE: 'catalog:category-tree',
  /** Manufacturer list for filters. */
  MANUFACTURER_LIST: 'catalog:manufacturer-list',
  /** Salt composition → product id map. The salt-engine lookup index. */
  SALT_INDEX: 'salt:index',
  /** A tenant's feature-flag evaluation result. */
  FEATURE_FLAGS: 'flags:tenant',
  /** Platform settings, resolved and decrypted. */
  PLATFORM_SETTINGS: 'platform:settings',
  /** Session grant: roles + capabilities + revocation state, keyed by session id. */
  SESSION_GRANT: 'session:grant',
  /** Cached permission set per role, keyed by role code. */
  ROLE_CAPABILITIES: 'iam:role-caps',
  /** Idempotency response replay. */
  IDEMPOTENCY: 'idempotency',
  /** Reference data: GST rates, HSN codes, payment terms. */
  REFERENCE_DATA: 'reference',
} as const;

export type CacheNamespace = (typeof CacheNamespace)[keyof typeof CacheNamespace];

/**
 * Namespaces that are explicitly NOT cacheable, with the reason.
 *
 * Kept as data rather than a comment so a reviewer can see the prohibition and
 * a future lint rule can enforce it.
 */
export const NEVER_CACHED = {
  PRICE: 'Resolved prices depend on the buyer, the quantity and the active scheme — a shared key would serve one buyer another buyer’s price (ADR-004).',
  STOCK: 'Available-to-promise changes with every reservation; a stale value oversells inventory (ADR-004).',
  CREDIT_LIMIT: 'Exposure changes with every order and payment; a stale value lets a buyer exceed their limit (ADR-004).',
  ORDER_STATUS: 'Order state transitions must be read from the primary; a cached status shows a cancelled order as active.',
  CART: 'The cart is mutable per user and per request; caching it introduces lost updates.',
} as const;

export type NeverCached = keyof typeof NEVER_CACHED;

/** Builds a namespaced cache key. */
export function cacheKey(namespace: CacheNamespace, ...parts: readonly (string | number)[]): string {
  return [namespace, ...parts].join(':');
}

/** Session-grant key, shared with the IAM invalidator. */
export function sessionGrantKey(sessionId: string): string {
  return cacheKey(CacheNamespace.SESSION_GRANT, sessionId);
}

/** Per-tenant feature-flag key. */
export function featureFlagKey(tenantId: string): string {
  return cacheKey(CacheNamespace.FEATURE_FLAGS, tenantId);
}

/**
 * Default TTLs, in seconds.
 *
 * Chosen by asking "how wrong may this be, and for how long?". A category tree
 * that is an hour stale is invisible to users. A session grant that is an hour
 * stale means a revoked session keeps working for an hour, so it is short and
 * explicitly invalidated on change.
 */
export const CACHE_TTL = {
  PRODUCT_DETAIL: 300,
  CATEGORY_TREE: 3_600,
  MANUFACTURER_LIST: 3_600,
  SALT_INDEX: 900,
  FEATURE_FLAGS: 60,
  PLATFORM_SETTINGS: 30,
  SESSION_GRANT: 300,
  ROLE_CAPABILITIES: 300,
  IDEMPOTENCY: 86_400,
  REFERENCE_DATA: 86_400,
} as const satisfies Record<string, number>;

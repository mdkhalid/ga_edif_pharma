/**
 * Rate-limiting port.
 *
 * Declared in `common/` and implemented in `infra/cache/` for the same reason as
 * the auth ports: the guard states *what* it needs, the adapter decides *how*.
 * Swapping the in-Redis sliding window for a hosted limiter (or a Cloudflare
 * edge rule) becomes a module-binding change, not a guard rewrite.
 */

export const RATE_LIMITER = Symbol('RateLimiter');

export interface RateLimitDecision {
  readonly allowed: boolean;
  /** Requests still available in the current window. */
  readonly remaining: number;
  /** The ceiling that was applied. */
  readonly limit: number;
  /** Seconds until the window resets. Sent as `Retry-After` when blocked. */
  readonly resetAfterSeconds: number;
}

export interface RateLimiter {
  /**
   * Consumes one unit from `key`'s budget.
   *
   * Must be atomic. A read-then-write implementation lets two concurrent
   * requests both observe `remaining: 1` and both proceed, which is precisely
   * the race a limiter exists to prevent.
   *
   * Implementations must **fail open**: if the backing store is unreachable,
   * return `allowed: true`. See ADR-014 — the reasoning is that a Redis outage
   * must not take the whole API down with it. Rate limiting protects capacity;
   * it is not an authorisation control, and every genuinely security-sensitive
   * path (login, OTP) is additionally protected by account lockout in Postgres,
   * which does not depend on Redis.
   */
  consume(key: string, max: number, windowSeconds: number): Promise<RateLimitDecision>;
}

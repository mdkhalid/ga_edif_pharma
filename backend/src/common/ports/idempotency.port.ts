/**
 * Idempotency port.
 *
 * Declared in `common/` and implemented in `infra/cache/` for the same reason as
 * the rate-limiter port: the interceptor states *what* it needs, the adapter
 * decides *how*. Moving replay storage from Redis to Postgres (or to a hosted
 * dedupe service) becomes a module-binding change rather than an interceptor
 * rewrite — and it lets a unit test bind the token to an in-memory stub instead
 * of standing up Redis.
 */

export const IDEMPOTENCY_STORE = Symbol('IdempotencyStore');

/**
 * How long the in-flight marker lives before it is assumed abandoned.
 *
 * Must exceed the request timeout (30 s, see `TimeoutInterceptor`) so a slow but
 * legitimate handler is not treated as crashed while it is still running. It is
 * deliberately short: a process that dies mid-request holds the key only for the
 * length of the marker, after which the client's retry is allowed through.
 */
export const IDEMPOTENCY_LOCK_TTL_SECONDS = 60;

/** Default replay window when a route does not specify one. */
export const IDEMPOTENCY_DEFAULT_TTL_SECONDS = 86_400;

/**
 * A stored idempotency record.
 *
 * Two states rather than one, because the write is two-phase: `in-flight` is
 * written *before* the handler runs, and `done` replaces it once the handler has
 * produced a response. A marker written only on success leaves a window in which
 * two concurrent retries both execute — which is the exact failure the mechanism
 * exists to prevent.
 */
export interface IdempotencyRecord {
  readonly state: 'in-flight' | 'done';
  /**
   * Hash of the request body. Reusing a key with a *different* body is a client
   * bug and must be rejected rather than silently replaying the wrong response.
   */
  readonly fingerprint: string;
  /** Present only when `state` is `done`. */
  readonly status?: number;
  readonly body?: unknown;
}

/** What `begin` decided about this request. */
export type IdempotencyBeginResult =
  /** No record existed; the caller now owns the key and must run the handler. */
  | { readonly outcome: 'acquired' }
  /** An identical request is currently running. Answer 409 and let the client retry. */
  | { readonly outcome: 'in-progress' }
  /** The key was used before with a different body. Answer 409. */
  | { readonly outcome: 'mismatch' }
  /** The key was used before with the same body. Replay this response verbatim. */
  | { readonly outcome: 'replay'; readonly status: number; readonly body: unknown }
  /**
   * The backing store could not be reached. Fail open (ADR-014): the request
   * proceeds unprotected rather than turning a cache outage into a write outage.
   */
  | { readonly outcome: 'unavailable' };

export interface IdempotencyStore {
  /**
   * Claims `scope`, or reports what the previous request with that scope did.
   *
   * Must be atomic. A read-then-write implementation lets two concurrent
   * retries both observe "no record" and both execute the handler.
   */
  begin(scope: string, fingerprint: string, lockTtlSeconds: number): Promise<IdempotencyBeginResult>;

  /** Replaces the in-flight marker with the completed response. */
  complete(
    scope: string,
    fingerprint: string,
    status: number,
    body: unknown,
    ttlSeconds: number,
  ): Promise<void>;

  /**
   * Drops the marker after a failed handler, so the client's retry is not held
   * out for the whole lock window by a request that never completed.
   */
  release(scope: string): Promise<void>;
}

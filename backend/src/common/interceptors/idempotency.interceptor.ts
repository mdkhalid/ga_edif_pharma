import {
  Inject,
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash } from 'node:crypto';
import {
  catchError,
  concatMap,
  defer,
  from,
  map,
  mergeMap,
  of,
  throwError,
  type Observable,
} from 'rxjs';

import { HEADERS, META } from '../constants/metadata';
import type { IdempotencyOptions } from '../decorators/idempotent.decorator';
import {
  IdempotencyKeyReusedError,
  RequestInProgressError,
  ValidationFailedError,
} from '../exceptions/domain.exception';
import {
  IDEMPOTENCY_DEFAULT_TTL_SECONDS,
  IDEMPOTENCY_LOCK_TTL_SECONDS,
  IDEMPOTENCY_STORE,
  type IdempotencyStore,
} from '../ports/idempotency.port';

interface IdempotentRequest {
  method?: string;
  originalUrl?: string;
  route?: { path?: string };
  headers?: Record<string, unknown>;
  body?: unknown;
}

interface IdempotentResponse {
  statusCode?: number;
}

/**
 * Makes an `@Idempotent()` route safely retryable.
 *
 * Registered globally so the decorator alone is enough to opt a route in; the
 * interceptor no-ops on every route that does not carry the metadata.
 *
 * ## The contract
 *
 *   1. The caller supplies an `Idempotency-Key` header. Without it the request
 *      is rejected — a route that needs the header cannot silently do without
 *      it, or the protection exists only for clients that remembered to opt in.
 *   2. The first request claims the key and runs. Its response is stored.
 *   3. A retry with the same key and the same body replays the stored response
 *      verbatim, status code included. It does **not** re-run the handler.
 *   4. A retry with the same key and a *different* body is a client bug, not a
 *      retry, and is rejected with 409 `IDEMPOTENCY_KEY_REUSED`.
 *   5. A retry that arrives while the first is still running is rejected with
 *      409 `REQUEST_IN_PROGRESS` rather than executing twice.
 *
 * ## Why the body is fingerprinted
 *
 * Without it, a client that reuses one key for two different payloads would
 * silently receive the first payload's response for the second request. The
 * mismatch check turns that into a loud, diagnosable failure.
 *
 * ## Fail-open when the store is unreachable
 *
 * Follows ADR-014, the same policy as the rate limiter: if Redis is down the
 * request proceeds unprotected rather than failing every write. The alternative
 * — rejecting all writes during a cache outage — is the outage the design was
 * built to avoid. See `RedisIdempotencyStore` for the accepted trade-off.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    @Inject(IDEMPOTENCY_STORE) private readonly store: IdempotencyStore,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const options = this.reflector.getAllAndOverride<IdempotencyOptions | undefined>(
      META.IDEMPOTENT,
      [context.getHandler(), context.getClass()],
    );
    if (options === undefined) return next.handle();

    const http = context.switchToHttp();
    const request = http.getRequest<IdempotentRequest>();
    const response = http.getResponse<IdempotentResponse>();

    const key = readHeader(request, HEADERS.IDEMPOTENCY_KEY);
    if (key === undefined || key === '') {
      throw new ValidationFailedError(
        `This endpoint requires an ${HEADERS.IDEMPOTENCY_KEY} header so a retry cannot be ` +
          'mistaken for a second request.',
        { header: HEADERS.IDEMPOTENCY_KEY },
      );
    }

    // Route + key, so the same client-generated key on two different endpoints
    // cannot collide and replay one endpoint's response for another.
    const route = request.route?.path ?? request.originalUrl ?? 'unknown';
    const scope = `${request.method ?? 'POST'} ${route} ${key}`;
    const fingerprint = options.fingerprintBody === false ? '' : fingerprintOf(request.body);
    const ttlSeconds = options.ttlSeconds ?? IDEMPOTENCY_DEFAULT_TTL_SECONDS;

    return from(this.store.begin(scope, fingerprint, IDEMPOTENCY_LOCK_TTL_SECONDS)).pipe(
      mergeMap((result) => {
        switch (result.outcome) {
          case 'mismatch':
            throw new IdempotencyKeyReusedError();

          case 'in-progress':
            throw new RequestInProgressError();

          case 'replay': {
            if (response.statusCode !== undefined) response.statusCode = result.status;
            return of(result.body);
          }

          case 'unavailable':
            // Fail open: run the handler with no replay protection, and do not
            // touch the store afterwards (there is nothing to release).
            return next.handle();

          case 'acquired':
          default:
            return next.handle().pipe(
              concatMap((value: unknown) =>
                defer(() =>
                  this.store.complete(
                    scope,
                    fingerprint,
                    response.statusCode ?? 200,
                    value,
                    ttlSeconds,
                  ),
                ).pipe(map(() => value)),
              ),
              // A failed handler must not hold the key for the whole lock
              // window: release it so the client's retry can run immediately.
              catchError((error: unknown) =>
                defer(() => this.store.release(scope)).pipe(mergeMap(() => throwError(() => error))),
              ),
            );
        }
      }),
    );
  }
}

/** Reads a header case-insensitively, tolerating the array form Express uses. */
function readHeader(request: IdempotentRequest, name: string): string | undefined {
  const headers = request.headers;
  if (headers === undefined) return undefined;

  const raw = headers[name];
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    return trimmed === '' ? undefined : trimmed;
  }
  if (Array.isArray(raw) && typeof raw[0] === 'string') {
    const trimmed = raw[0].trim();
    return trimmed === '' ? undefined : trimmed;
  }
  return undefined;
}

/** Stable hash of the request body, independent of key order. */
function fingerprintOf(body: unknown): string {
  return createHash('sha256').update(stableStringify(body)).digest('hex');
}

/**
 * `JSON.stringify` with object keys sorted, so two payloads that differ only in
 * key order fingerprint identically — otherwise a client that serialises its
 * retry from a different map would be told its identical request is a mismatch.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;

  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

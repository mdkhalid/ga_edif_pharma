import { SetMetadata, applyDecorators } from '@nestjs/common';
import { ApiHeader } from '@nestjs/swagger';

import { META } from '../constants/metadata';

export interface IdempotencyOptions {
  /**
   * How long a completed response is replayable, in seconds.
   *
   * Must exceed the client's realistic retry window. If a record expires before
   * the client gives up, the retry is treated as a fresh request and a duplicate
   * order is created — the exact failure this mechanism exists to prevent.
   */
  readonly ttlSeconds?: number;
  /**
   * Include the request body in the idempotency fingerprint.
   *
   * Enabled by default. Reusing a key with a *different* body is a client bug
   * and returns 409 rather than silently replaying the wrong response. Disable
   * only for routes where the body is genuinely irrelevant.
   */
  readonly fingerprintBody?: boolean;
}

/**
 * Makes a route safely retryable.
 *
 *   @Idempotent({ ttlSeconds: 86_400 })
 *   @Post('orders')
 *
 * The interceptor requires an `Idempotency-Key` header, stores the in-flight
 * marker in Redis *before* the handler runs, and replays the stored response on
 * a repeat. Storage is two-phase because a marker that is only written on
 * success leaves a window where two concurrent retries both execute.
 *
 * Mandatory on: order placement, payment initiation, refunds, stock
 * adjustments, credit-limit changes. Anything that moves money or stock.
 *
 * ## Why the header is documented here too
 *
 * The interceptor *requires* the header, so the published contract must declare
 * it — otherwise the generated client has no way to send one, and every call to
 * the route fails at runtime with a 400 that nothing in the type system warned
 * about. Documenting it alongside the metadata that enforces it means the two
 * cannot disagree: adding `@Idempotent()` to a route is the whole change, and
 * omitting it is the whole omission. It was previously written out by hand on
 * `POST /auth/register` alone, which is why the four Phase 1 routes that also
 * require a key did not declare it.
 */
export const Idempotent = (options: IdempotencyOptions = {}) =>
  applyDecorators(
    SetMetadata(META.IDEMPOTENT, {
      ttlSeconds: options.ttlSeconds ?? 86_400,
      fingerprintBody: options.fingerprintBody ?? true,
    } satisfies IdempotencyOptions),
    ApiHeader({
      name: 'Idempotency-Key',
      required: true,
      description:
        'Client-generated unique key (a UUID). A retry with the same key and body replays the ' +
        'original response instead of performing the operation a second time; reusing a key ' +
        'with a different body is rejected with 409 IDEMPOTENCY_KEY_REUSED.',
    }),
  );

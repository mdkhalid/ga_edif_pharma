import { Global, Module } from '@nestjs/common';

import { IDEMPOTENCY_STORE } from '../../common/ports/idempotency.port';
import { RATE_LIMITER } from '../../common/ports/rate-limiter.port';
import { CacheService } from './cache.service';
import { RedisIdempotencyStore } from './redis-idempotency.store';
import { RedisRateLimiter } from './redis-rate-limiter.service';
import { RedisService } from './redis.service';

/**
 * Cache, rate-limiting and lock infrastructure.
 *
 * `@Global()` for the same reason as the database module: it is universal
 * infrastructure with no per-consumer configuration.
 *
 * ## Why `RATE_LIMITER` is bound to a token rather than the concrete class
 *
 * The guard depends on the `RateLimiter` interface, not on
 * `RedisRateLimiter`. That is what makes the ADR-014 fail-open behaviour
 * testable: a unit test binds the token to a stub that throws, and asserts the
 * guard allows the request. Binding the class directly would force the test to
 * stand up Redis to prove a behaviour about Redis being unavailable.
 */
@Global()
@Module({
  providers: [
    RedisService,
    CacheService,
    RedisRateLimiter,
    RedisIdempotencyStore,
    { provide: RATE_LIMITER, useExisting: RedisRateLimiter },
    { provide: IDEMPOTENCY_STORE, useExisting: RedisIdempotencyStore },
  ],
  exports: [RedisService, CacheService, RATE_LIMITER, IDEMPOTENCY_STORE],
})
export class CacheModule {}

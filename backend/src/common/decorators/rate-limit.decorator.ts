import { SetMetadata } from '@nestjs/common';

import { META, RATE_LIMIT_BUCKET, type RateLimitBucket } from '../constants/metadata';

export interface RateLimitOptions {
  readonly bucket?: RateLimitBucket;
  /** Maximum requests permitted inside the window. */
  readonly max?: number;
  readonly windowSeconds?: number;
  /**
   * What to key the counter on.
   *
   * `ip` alone is wrong behind a carrier NAT — a thousand pharmacies on one
   * mobile network would share a budget. `user` is unavailable pre-auth, so
   * auth routes use `ip+identifier`, which limits an attack on a single account
   * without punishing everyone behind the same NAT.
   */
  readonly keyBy?: 'ip' | 'user' | 'ip+identifier' | 'tenant';
}

/**
 * Overrides the global rate limit for a route.
 *
 *   @RateLimit({ bucket: RATE_LIMIT_BUCKET.AUTH, max: 10, windowSeconds: 60 })
 *
 * The limiter is a sliding window in Redis so that N pods enforce one shared
 * budget. A per-process counter would multiply the effective limit by the pod
 * count, which is how a "10/min" login limit becomes "120/min" in production.
 */
export const RateLimit = (options: RateLimitOptions = {}) =>
  SetMetadata(META.RATE_LIMIT, {
    bucket: options.bucket ?? RATE_LIMIT_BUCKET.DEFAULT,
    keyBy: options.keyBy ?? 'ip',
    ...(options.max === undefined ? {} : { max: options.max }),
    ...(options.windowSeconds === undefined ? {} : { windowSeconds: options.windowSeconds }),
  } satisfies RateLimitOptions);

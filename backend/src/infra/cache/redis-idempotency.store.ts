import { Injectable, Logger } from '@nestjs/common';

import type {
  IdempotencyBeginResult,
  IdempotencyRecord,
  IdempotencyStore,
} from '../../common/ports/idempotency.port';
import { idempotencyKey } from './cache-keys';
import { RedisService } from './redis.service';

/**
 * Redis-backed idempotency replay store.
 *
 * ## Why `SET NX` and not `GET` then `SET`
 *
 * `begin` must be atomic. The obvious implementation — read the key, and if it
 * is absent write it — has a race that fires exactly when it matters most: two
 * concurrent retries of the same "place order" request both read "absent", both
 * write, and both run the handler. `SET … NX` makes the claim a single atomic
 * operation, so exactly one caller is told it owns the key.
 *
 * ## Why the store never throws
 *
 * Every method catches and logs. Redis is optional by design (ADR-014), and
 * `begin` returns an explicit `unavailable` outcome that the interceptor turns
 * into a fail-open (the request proceeds unprotected). Letting a Redis error
 * escape here would convert a cache outage into an outage of every idempotent
 * write path — the opposite of the documented degraded behaviour.
 *
 * The honest cost: while Redis is unreachable, a duplicated retry is no longer
 * deduplicated. That is accepted because the fallback the design calls for (a
 * database-backed store) is deferred until there are money routes to protect —
 * the only idempotent route today is registration, where a duplicate surfaces as
 * a unique-constraint 409 rather than a double charge.
 */
@Injectable()
export class RedisIdempotencyStore implements IdempotencyStore {
  private readonly logger = new Logger(RedisIdempotencyStore.name);

  constructor(private readonly redis: RedisService) {}

  async begin(
    scope: string,
    fingerprint: string,
    lockTtlSeconds: number,
  ): Promise<IdempotencyBeginResult> {
    const key = idempotencyKey(scope);
    const marker: IdempotencyRecord = { state: 'in-flight', fingerprint };

    try {
      const claimed = await this.redis.raw.set(
        this.redis.withPrefix(key),
        JSON.stringify(marker),
        'EX',
        Math.ceil(lockTtlSeconds),
        'NX',
      );

      if (claimed === 'OK') return { outcome: 'acquired' };

      const existing = await this.redis.getJson<IdempotencyRecord>(key);

      if (existing === null) {
        // The marker expired between `SET NX` and `GET`. Treated as in-progress
        // so the caller retries rather than racing the request that owns it; at
        // worst the client loses one retry.
        return { outcome: 'in-progress' };
      }

      if (existing.state === 'in-flight') return { outcome: 'in-progress' };
      if (existing.fingerprint !== fingerprint) return { outcome: 'mismatch' };

      return { outcome: 'replay', status: existing.status ?? 200, body: existing.body };
    } catch (error) {
      this.logger.warn(
        `Idempotency store unreachable; the request proceeds without replay protection. ${describe(error)}`,
      );
      return { outcome: 'unavailable' };
    }
  }

  async complete(
    scope: string,
    fingerprint: string,
    status: number,
    body: unknown,
    ttlSeconds: number,
  ): Promise<void> {
    const record: IdempotencyRecord = { state: 'done', fingerprint, status, body };

    try {
      // Overwrites the in-flight marker (no `NX`), so a retry after this point
      // replays the stored response instead of seeing a request "in progress".
      await this.redis.setJson(idempotencyKey(scope), record, ttlSeconds);
    } catch (error) {
      // A failure here only means the retry will not be replayed; the response
      // already produced must still reach the client.
      this.logger.warn(`Failed to persist idempotency record. ${describe(error)}`);
    }
  }

  async release(scope: string): Promise<void> {
    try {
      await this.redis.del(idempotencyKey(scope));
    } catch (error) {
      this.logger.warn(`Failed to release idempotency marker. ${describe(error)}`);
    }
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

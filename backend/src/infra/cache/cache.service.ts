import { Injectable, Logger } from '@nestjs/common';

import { CACHE_TTL, type CacheNamespace } from './cache-keys';
import { RedisService } from './redis.service';

/**
 * Cache-aside with in-process single-flight.
 *
 * ## Cache-aside, and why not write-through
 *
 * Reads populate the cache; writes invalidate it. Write-through would mean every
 * write pays the cache's latency inside its transaction, and a cache outage
 * would become a write outage. With cache-aside a Redis failure degrades to
 * "everything hits the database", which is slow but correct.
 *
 * ## Single-flight, and why it matters more than it sounds
 *
 * On a cache miss, every concurrent request for the same key calls the loader.
 * For a hot product page after a deploy — the cache is cold and traffic is not —
 * that is hundreds of simultaneous identical database queries, all of them
 * slower than the one query they are duplicating. The stampede is what turns a
 * cache miss into an outage.
 *
 * `inFlight` collapses them: the first caller runs the loader, the rest await
 * the same promise. It is per-process, so N pods still issue up to N queries —
 * bounded and predictable, versus unbounded and not.
 *
 * ## What is deliberately missing
 *
 * There is no `getOrSet` overload that takes a namespace for price, stock or
 * credit. See `NEVER_CACHED` in `cache-keys.ts` — the prohibition is expressed
 * in the module's API, not in a comment a future contributor has to find.
 */
@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);

  /** Loaders currently running, keyed by cache key. Collapses the stampede. */
  private readonly inFlight = new Map<string, Promise<unknown>>();

  constructor(private readonly redis: RedisService) {}

  /**
   * Returns the cached value, or runs `loader` and caches the result.
   *
   * A `null` return from the loader is cached as a negative entry, so a request
   * for a product that does not exist does not hit the database on every retry.
   * Callers that must not cache absence should not use this method.
   */
  async getOrSet<T>(
    key: string,
    loader: () => Promise<T>,
    ttlSeconds: number = CACHE_TTL.REFERENCE_DATA,
  ): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== undefined) return cached;

    const existing = this.inFlight.get(key);
    if (existing !== undefined) return existing as Promise<T>;

    const promise = loader()
      .then(async (value) => {
        // Cache write failures are swallowed: the value is already computed and
        // the caller must not be failed by a cache that is merely unavailable.
        await this.redis
          .setJson(key, value, ttlSeconds)
          .catch((error: unknown) =>
            this.logger.warn(
              `Failed to write cache key ${key}: ${error instanceof Error ? error.message : ''}`,
            ),
          );
        return value;
      })
      .finally(() => {
        this.inFlight.delete(key);
      });

    this.inFlight.set(key, promise);
    return promise;
  }

  /** Reads a cached value. `undefined` means "not cached" — `null` is a value. */
  async get<T>(key: string): Promise<T | undefined> {
    try {
      const value = await this.redis.getJson<T>(key);
      return value === null ? undefined : value;
    } catch (error) {
      // A cache read must never fail the request. Treat an unreachable Redis as
      // a miss and let the loader run.
      this.logger.warn(
        `Cache read failed for ${key}: ${error instanceof Error ? error.message : ''}`,
      );
      return undefined;
    }
  }

  /** Writes a value with an explicit TTL. */
  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    await this.redis.setJson(key, value, ttlSeconds).catch(() => undefined);
  }

  /** Removes a single key. Call this after any write to the underlying row. */
  async invalidate(key: string): Promise<void> {
    await this.redis.del(key).catch(() => undefined);
  }

  /** Removes several keys in one round trip. */
  async invalidateMany(keys: readonly string[]): Promise<void> {
    if (keys.length === 0) return;
    await Promise.all(keys.map((key) => this.invalidate(key)));
  }

  /**
   * Removes every key under a prefix.
   *
   * Uses `SCAN`, never `KEYS`. `KEYS` walks the entire keyspace in a single
   * blocking call, and on a production instance that is a self-inflicted stall
   * for every other client — Redis is single-threaded, so the whole server waits.
   * `SCAN` returns a cursor and costs a bounded slice per call.
   *
   * Deletes in batches to bound the size of a single command.
   */
  async invalidatePrefix(prefix: string): Promise<number> {
    const client = this.redis.raw;
    const pattern = this.redis.withPrefix(`${prefix}*`);

    let cursor = '0';
    let deleted = 0;
    const batch: string[] = [];

    do {
      const [nextCursor, keys] = await client.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
      cursor = nextCursor;
      batch.push(...keys);

      if (batch.length >= 500) {
        deleted += await this.deleteBatch(batch);
        batch.length = 0;
      }
    } while (cursor !== '0');

    if (batch.length > 0) deleted += await this.deleteBatch(batch);
    return deleted;
  }

  /** Invalidates every key in a namespace. */
  async invalidateNamespace(namespace: CacheNamespace): Promise<number> {
    return this.invalidatePrefix(`${namespace}:`);
  }

  private async deleteBatch(keys: readonly string[]): Promise<number> {
    if (keys.length === 0) return 0;
    try {
      // Keys from SCAN already carry the prefix, so they are passed through as
      // returned rather than re-prefixed.
      return await this.redis.raw.del(...keys);
    } catch (error) {
      this.logger.warn(
        `Cache invalidation batch failed: ${error instanceof Error ? error.message : ''}`,
      );
      return 0;
    }
  }
}

import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import Redis, { type RedisOptions } from 'ioredis';

import { AppConfigService } from '../../config/app-config.service';

/**
 * Owns the Redis connection pool.
 *
 * One client, shared. ioredis multiplexes commands over a single connection and
 * pipelines them, so a pool per feature is not just unnecessary but actively
 * harmful — every extra connection is another socket the server must keep and
 * another source of "max clients reached" during a deploy.
 *
 * ## Lazy connect
 *
 * `lazyConnect: true` means the module can be constructed (and the app can
 * start) before Redis is reachable. That matters in two situations: local
 * development, where a developer may run the API before `docker compose up`,
 * and a rolling deploy, where the readiness probe — not the boot sequence —
 * should decide when the pod takes traffic.
 *
 * ## Retry policy
 *
 * Retries are capped and use a bounded backoff. An uncapped retry loop turns a
 * Redis outage into a reconnect storm that also takes out the network path the
 * database needs.
 *
 * ## Commands fail fast when Redis is down — they do not queue
 *
 * `enableOfflineQueue: false` is the setting that makes ADR-014 true rather than
 * aspirational, and it is not the default.
 *
 * With the default (`true`), a command issued while the connection is down is
 * held in a queue and replayed after a reconnect. Each command therefore waits
 * out the reconnect backoff before it can fail — measured here at roughly 13
 * seconds against a refused connection. Every cache read and every rate-limit
 * check in a request pays that cost, and a handler that performs several reads
 * accumulates it: `/auth/sessions` exceeded a 15-second client timeout. The API
 * did not "degrade" — it hung, which is the failure mode the degraded design was
 * meant to prevent.
 *
 * With `false`, a command on a non-ready connection is rejected immediately.
 * Every caller already treats a Redis failure as a defined degraded outcome — a
 * cache miss falls through to Postgres, the limiter fails open, idempotency
 * falls back to its database store — so failing fast converts a hang into the
 * behaviour the system was designed to have. The cost is that commands in flight
 * during a brief reconnect are lost rather than replayed, which is the correct
 * trade for a cache and is why every value here has a database behind it.
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: Redis;
  private readonly keyPrefix: string;

  /**
   * True while Redis is known to be unreachable.
   *
   * Connection errors repeat for as long as the outage lasts — ioredis emits one
   * per reconnect attempt, which is roughly every three seconds. Logging each one
   * produced around 28,000 identical lines per pod per day, which is enough noise
   * to hide a real error and enough volume to be a line-item cost. The flag turns
   * that into one line when the outage begins and one when it ends.
   */
  private degraded = false;

  constructor(@Inject(AppConfigService) config: AppConfigService) {
    const { url } = config.redis;
    this.keyPrefix = config.redis.keyPrefix;

    const options: RedisOptions = {
      lazyConnect: true,
      // NOTE: ioredis's `keyPrefix` option is deliberately NOT used.
      //
      // Its application to scripts is subtle: keys passed to `EVAL` are prefixed
      // only in some code paths, so a Lua script can end up addressing a key
      // that differs from the one the JavaScript side reads — and the symptom is
      // a limiter or lock that silently never triggers, which is far worse than
      // an outright error. `withPrefix()` below prefixes explicitly and
      // greppably, so both sides provably address the same key.
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      // Capped at 30 s rather than 3 s: this is the *reconnect* interval, and a
      // long outage does not need a probe every three seconds. Recovery still
      // happens within half a minute of Redis returning.
      retryStrategy: (attempt) => Math.min(attempt * 200, 30_000),
      reconnectOnError: (error) => {
        // A replica promoted to primary answers writes with READONLY. Reconnecting
        // is the correct recovery; any other error is handled by the caller.
        if (error.message.includes('READONLY')) return 2;
        return false;
      },
      // Bounds the TCP/TLS handshake. Command-level waiting is handled by
      // `enableOfflineQueue: false` above, which rejects immediately rather than
      // waiting for this to elapse.
      connectTimeout: 5_000,
    };

    this.client = new Redis(url, options);
    this.client.on('error', (error: Error) => this.reportDegraded(error));
    this.client.on('ready', () => this.reportRecovered());
  }

  /** Logs the first failure of an outage; stays quiet for the rest of it. */
  private reportDegraded(error: Error): void {
    if (this.degraded) return;
    this.degraded = true;
    this.logger.warn(
      `Redis unreachable (${error.message}). Serving in degraded mode: cache misses, ` +
        'fail-open rate limiting, database-backed idempotency. Further connection errors ' +
        'are suppressed until the connection recovers.',
    );
  }

  /** Logs recovery once, so the end of an outage is visible in the log. */
  private reportRecovered(): void {
    if (this.degraded) {
      this.logger.log('Redis connection recovered; caching and rate limiting are active again.');
    } else {
      this.logger.log('Redis connection ready.');
    }
    this.degraded = false;
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.client.connect();
    } catch (error) {
      // Non-fatal by design: the health endpoint reports the degradation and
      // the limiter fails open. Crashing here would make Redis a hard dependency
      // of starting at all, which is the opposite of what ADR-014 intends.
      //
      // The `error` listener normally reports the cause first, so this only
      // speaks when it has not — otherwise every boot with Redis down would
      // print the same failure twice.
      if (!this.degraded) {
        this.reportDegraded(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    // `quit` sends QUIT and waits for in-flight replies, so a request that is
    // mid-command during shutdown still gets its answer.
    await this.client.quit().catch(() => this.client.disconnect());
  }

  /** The underlying client. Prefer a wrapper; use this for ad-hoc commands. */
  get raw(): Redis {
    return this.client;
  }

  /** Round-trip latency in milliseconds, or `null` when unreachable. */
  async ping(): Promise<number | null> {
    const startedAt = Date.now();
    try {
      const reply = await this.client.ping();
      return reply === 'PONG' ? Date.now() - startedAt : null;
    } catch {
      return null;
    }
  }

  /**
   * Applies the configured namespace to a logical key.
   *
   * Every key written by this application goes through here, so a shared Redis
   * instance (a cache, a limiter and a queue on one server) cannot collide with
   * itself, and two environments pointed at the same instance stay separate.
   */
  withPrefix(key: string): string {
    return `${this.keyPrefix}${key}`;
  }

  /** Reads a JSON value, or `null` when absent or unparseable. */
  async getJson<T>(key: string): Promise<T | null> {
    const raw = await this.client.get(this.withPrefix(key));
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      // A corrupted or foreign value is treated as a miss. Throwing here would
      // turn a poisoned key into a permanent outage of that code path.
      await this.client.del(this.withPrefix(key)).catch(() => undefined);
      return null;
    }
  }

  /** Writes a JSON value with a TTL. `ttlSeconds` is required, never optional. */
  async setJson(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    if (ttlSeconds <= 0) {
      throw new RangeError('setJson requires a positive TTL — an unbounded cache key is a leak.');
    }
    await this.client.set(
      this.withPrefix(key),
      JSON.stringify(value),
      'EX',
      Math.ceil(ttlSeconds),
    );
  }

  /** Deletes a key. Safe to call when the key does not exist. */
  async del(key: string): Promise<void> {
    await this.client.del(this.withPrefix(key));
  }

  /**
   * Runs a Lua script atomically.
   *
   * Keys are prefixed by the caller via `withPrefix()` before being passed here,
   * and are passed through to Redis untouched — no implicit prefixing, so the
   * keys the script addresses are exactly the keys the JavaScript side
   * addresses.
   */
  async evalScript(
    lua: string,
    keys: readonly string[],
    args: readonly (string | number)[],
  ): Promise<unknown> {
    return this.client.eval(lua, keys.length, ...keys, ...args.map(String));
  }
}

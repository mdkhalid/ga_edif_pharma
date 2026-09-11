import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

import { AppConfigService } from '../config/app-config.service';
import { tenantScopingExtension } from './tenant-scoping.extension';

/**
 * Prisma client lifecycle and connection configuration.
 *
 * ## Why the datasource URL is built rather than used verbatim
 *
 * `statement_timeout` and `idle_in_transaction_session_timeout` are *server-side*
 * safeguards, and they are the ones that actually hold. An application-level
 * timeout cannot cancel a query the database is still executing — the client
 * gives up, the server keeps burning CPU, and under load those orphaned queries
 * are what exhaust the connection pool.
 *
 * Setting them per-connection via the `options` parameter means every connection
 * the pool opens carries them, which a one-off `SET` cannot guarantee (it would
 * apply to whichever pooled connection happened to serve it).
 *
 * `idle_in_transaction_session_timeout` is the specific defence against the
 * most common production incident in a system like this: a transaction that
 * acquires a row lock, then awaits an HTTP call to a payment gateway, and holds
 * the lock for the duration. Other transactions pile up behind it and the whole
 * orders table stops accepting writes.
 *
 * ## Why `connection_limit` is set from config
 *
 * The arithmetic matters: `pool_max × pod_count` must stay below Postgres's
 * `max_connections` minus reserved slots. At 12 pods with `pool_max=20` that is
 * 240 against a default limit of 200 — the database starts refusing connections
 * and the pods crash-loop, which looks like a database failure but is a
 * configuration failure. Setting it here from one validated value means the
 * number in the deployment manifest and the number the client uses cannot drift.
 */
export const PRISMA_EXTENDED = Symbol('PRISMA_EXTENDED');

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor(@Inject(AppConfigService) private readonly config: AppConfigService) {
    const database = config.database;

    super({
      datasourceUrl: buildDatasourceUrl(database.url, {
        poolMax: database.poolMax,
        statementTimeoutMs: database.statementTimeoutMs,
        idleInTransactionTimeoutMs: database.idleInTransactionTimeoutMs,
      }),
      // Emitted as events rather than written to stdout, so the slow-query
      // handler below can decide what is worth keeping. Prisma's built-in query
      // logging has no threshold, and a log line per query on a busy API is
      // both useless and expensive.
      log: [
        { emit: 'event', level: 'query' },
        { emit: 'event', level: 'warn' },
        { emit: 'event', level: 'error' },
      ],
      errorFormat: config.isProduction ? 'minimal' : 'pretty',
    });

    this.registerQueryObservers();
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log(
      `Postgres connected (pool_max=${this.config.database.poolMax}, ` +
        `statement_timeout=${this.config.database.statementTimeoutMs}ms).`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    // `$disconnect` drains in-flight queries before closing. Skipping it leaves
    // transactions open on the server until their idle timeout fires, which
    // during a rolling deploy means the old pods hold locks the new ones need.
    await this.$disconnect();
  }

  /**
   * Reports whether the database is reachable, with latency.
   *
   * Deliberately a real round trip (`SELECT 1`), not a pool-introspection call:
   * a pool can report a healthy connection to a server that has stopped
   * accepting queries. Returns `null` when unreachable so the health endpoint
   * can report *why* it is unhealthy rather than just that it is.
   */
  async ping(): Promise<number | null> {
    const startedAt = Date.now();
    try {
      await this.$queryRaw`SELECT 1`;
      return Date.now() - startedAt;
    } catch (error) {
      this.logger.warn(
        `Postgres ping failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      return null;
    }
  }

  /**
   * Warns on queries that exceed the configured budget.
   *
   * This is the cheapest useful production signal: it needs no APM agent, it
   * catches the N+1 that slipped through review, and it names the exact query
   * rather than leaving an engineer to guess from a latency graph.
   */
  private registerQueryObservers(): void {
    const slowThresholdMs = Math.max(200, Math.floor(this.config.database.statementTimeoutMs / 10));

    // The generated client types `$on` for the event names declared in `log`.
    const emitter = this as unknown as {
      $on: (event: 'query' | 'warn' | 'error', handler: (payload: unknown) => void) => void;
    };

    emitter.$on('query', (payload: unknown) => {
      const event = payload as { duration?: number; query?: string };
      const duration = event.duration ?? 0;
      if (duration < slowThresholdMs) return;

      // Truncated: a Prisma query string can embed a large IN list, and the log
      // is not the place to store a copy of the query's parameters.
      const preview = (event.query ?? '').replace(/\s+/g, ' ').slice(0, 300);
      this.logger.warn(`Slow query (${duration}ms): ${preview}`);
    });

    emitter.$on('warn', (payload: unknown) => {
      this.logger.warn(`Prisma warning: ${JSON.stringify(payload)}`);
    });

    emitter.$on('error', (payload: unknown) => {
      this.logger.error(`Prisma error: ${JSON.stringify(payload)}`);
    });
  }
}

/**
 * Merges the required server-side settings into the connection URL.
 *
 * Written as a merge rather than string concatenation so an operator who has
 * already put `?schema=public` (or an SSL parameter) in `DATABASE_URL` does not
 * end up with two `?` characters and a connection that fails to parse.
 */
export function buildDatasourceUrl(
  url: string,
  options: {
    poolMax: number;
    statementTimeoutMs: number;
    idleInTransactionTimeoutMs: number;
  },
): string {
  const separator = url.includes('?') ? '&' : '?';

  const postgresOptions = [
    `-c statement_timeout=${options.statementTimeoutMs}`,
    `-c idle_in_transaction_session_timeout=${options.idleInTransactionTimeoutMs}`,
  ].join(' ');

  const params = new URLSearchParams({
    connection_limit: String(options.poolMax),
    // Prisma's own wait for a free connection. Kept below the request timeout so
    // a saturated pool surfaces as a clear error rather than a generic timeout.
    pool_timeout: '20',
    options: postgresOptions,
  });

  // `URLSearchParams` encodes spaces as `+`, which libpq does not decode inside
  // `options`. The spec-compliant `%20` is what Postgres expects.
  return `${url}${separator}${params.toString().replace(/\+/g, '%20')}`;
}

/**
 * The extended client type.
 *
 * `Omit<PrismaClient, '$extends'>` rather than `ReturnType<PrismaClient['$extends']>`.
 *
 * The `ReturnType` form is the obvious choice and it is a trap: `$extends` is
 * heavily overloaded, so the inferred return type collapses to something whose
 * model delegates are typed `never` or `unknown`. Every `findMany` result then
 * loses its type, callbacks receive implicit `any`, and the compiler stops
 * checking anything that matters.
 *
 * Omitting `$extends` keeps the full generated model types — which is what
 * consumers actually need — and removes the one method that would hand back an
 * untyped client. Re-extending a client is not something application code should
 * do anyway; the extension is applied once, in the module factory.
 */
export type ExtendedPrismaClient = Omit<PrismaClient, '$extends'>;

/** Creates the tenant-scoped client from the base one. */
export function extendPrismaClient(base: PrismaClient): ExtendedPrismaClient {
  // The cast is required because `$extends` returns its own opaque type. It is
  // safe: the extension only intercepts queries, and every model delegate it
  // exposes has the same signature as the base client's.
  return base.$extends(tenantScopingExtension()) as unknown as ExtendedPrismaClient;
}

/** Re-exported so callers can name transaction client types without importing Prisma. */
export type { Prisma };

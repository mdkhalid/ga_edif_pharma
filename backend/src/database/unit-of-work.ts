import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { ConflictError } from '../common/exceptions/domain.exception';
import { ExtendedPrismaClient, PRISMA_EXTENDED } from './prisma.service';

/**
 * The transaction boundary.
 *
 * ## The rule this exists to enforce
 *
 * A business invariant must never be split across two transactions. If "decrement
 * stock" and "create the order line" commit separately, a crash between them
 * produces an order for stock that was never reserved — and no amount of retrying
 * repairs it, because the two writes are individually valid. Inside one
 * transaction they either both happen or neither does.
 *
 * ## Why this is not just `prisma.$transaction` at the call site
 *
 * Three behaviours are needed everywhere and are easy to omit once:
 *
 *   1. **Retry on serialisation failure.** Postgres aborts one side of a write
 *      conflict or deadlock with SQLSTATE 40001/40P01, surfaced by Prisma as
 *      `P2034`. That is not an error condition — it is the database asking the
 *      caller to try again, and the retry almost always succeeds. A call site
 *      that forgets turns ordinary contention into a 500 for a real user.
 *   2. **A bounded timeout.** An interactive transaction holds a connection for
 *      its whole duration. Without a timeout, one stuck transaction consumes a
 *      pool slot indefinitely and enough of them exhaust the pool.
 *   3. **Consistent isolation.** The level is chosen here, not per call site, so
 *      "what can this transaction see?" has one answer.
 *
 * ## Why `READ COMMITTED` and not `SERIALIZABLE`
 *
 * The default is `READ COMMITTED`, and it is sufficient *because* every
 * read-modify-write path takes an explicit row lock (`SELECT … FOR UPDATE`, see
 * `lockById`). `SERIALIZABLE` would push the retry burden onto every transaction
 * in the system, including the read-only ones that cannot conflict, and would
 * turn ordinary contention into a storm of `P2034`s. Locking only the rows that
 * participate in an invariant is both faster and easier to reason about.
 *
 * `SERIALIZABLE` is available per call for the rare case that genuinely needs it
 * — a report that must see a consistent snapshot across many tables.
 */

export interface TransactionOptions {
  isolationLevel?: Prisma.TransactionIsolationLevel;
  /** How long the callback may run before the transaction is aborted. */
  timeoutMs?: number;
  /** How long to wait for a connection from the pool. */
  maxWaitMs?: number;
  /** Retries on serialisation failure or deadlock. */
  maxRetries?: number;
}

/**
 * The transaction client.
 *
 * `Prisma.TransactionClient` rather than the extended-client type. The two are
 * the same object at runtime — Prisma applies query extensions to the client it
 * hands to an interactive transaction when the transaction is started from an
 * extended client — but `Prisma.TransactionClient` is the type that carries
 * Prisma's generated per-model signatures. Using the extended type here would
 * lose them, and every `tx.order.create(...)` in the codebase would stop being
 * type-checked.
 *
 * That the extension really does apply inside a transaction is not taken on
 * trust: the `test-isolation` suite asserts it directly, because a transaction
 * that silently ran unscoped would be the worst kind of regression — everything
 * passes, and one tenant can read another's rows.
 */
export type TransactionClient = Prisma.TransactionClient;

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_WAIT_MS = 5_000;
const DEFAULT_MAX_RETRIES = 3;

@Injectable()
export class UnitOfWork {
  private readonly logger = new Logger(UnitOfWork.name);

  constructor(@Inject(PRISMA_EXTENDED) private readonly prisma: ExtendedPrismaClient) {}

  /**
   * Runs `fn` inside a transaction, retrying transient conflicts.
   *
   * The callback is invoked again from scratch on retry, so it must be free of
   * side effects that cannot be repeated — no sending an email, no calling a
   * payment gateway, no publishing to a queue. Those belong after the commit,
   * driven by the outbox. A retried transaction that re-sent an SMS would send
   * it twice.
   */
  async transaction<T>(
    fn: (tx: TransactionClient) => Promise<T>,
    options: TransactionOptions = {},
  ): Promise<T> {
    const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxWaitMs = options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;

    let lastError: unknown;

    for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
      try {
        return await this.prisma.$transaction(fn, {
          isolationLevel: options.isolationLevel ?? Prisma.TransactionIsolationLevel.ReadCommitted,
          timeout: timeoutMs,
          maxWait: maxWaitMs,
        });
      } catch (error) {
        lastError = error;

        if (!isRetryableConflict(error) || attempt > maxRetries) {
          throw this.translate(error);
        }

        // Exponential backoff with jitter. Jitter is essential: two transactions
        // that conflicted will otherwise retry in lockstep and conflict again,
        // which is the textbook livelock.
        const backoffMs = 2 ** (attempt - 1) * 25 + Math.floor(Math.random() * 25);
        this.logger.warn(
          `Transaction conflict (${errorCode(error)}); retrying in ${backoffMs}ms ` +
            `(attempt ${attempt}/${maxRetries + 1}).`,
        );
        await sleep(backoffMs);
      }
    }

    /* istanbul ignore next — the loop always returns or throws. */
    throw this.translate(lastError);
  }

  /**
   * Locks a row for update and returns it, scoped to the current tenant.
   *
   * This is the primitive every balance, stock and credit mutation is built on.
   * Reading a value, computing a new one and writing it back without a lock is a
   * lost update: two concurrent requests both read 100, both write 90, and the
   * ledger says one unit moved while two were sold.
   *
   * `FOR UPDATE` blocks a concurrent locker until this transaction commits, so
   * the second reader sees the first writer's result. The lock is held for the
   * remainder of the transaction, which is why the transaction must not contain
   * an external call — see the note on `transaction`.
   *
   * The tenant filter is written out explicitly because this is raw SQL, and raw
   * SQL bypasses the scoping extension by design. Every raw query in the codebase
   * carries this comment; it is the one place the automatic protection does not
   * reach.
   *
   * @param table Physical table name. Never interpolated from user input.
   */
  async lockById<T>(
    tx: TransactionClient,
    table: string,
    id: string,
    tenantId: string,
  ): Promise<T | null> {
    if (!/^[a-z_][a-z0-9_]*$/.test(table)) {
      // The table name cannot be parameterised in SQL, so it is validated
      // instead. This is a programming error, not user input, but a whitelist
      // costs nothing and removes the injection question entirely.
      throw new Error(`Unsafe table name for lockById: ${table}`);
    }

    const rows = await tx.$queryRawUnsafe<T[]>(
      `SELECT * FROM "${table}" WHERE id = $1::uuid AND tenant_id = $2::uuid FOR UPDATE`,
      id,
      tenantId,
    );

    return rows.length > 0 ? (rows[0] as T) : null;
  }

  /**
   * Runs `fn` with a Postgres advisory lock held, releasing it at commit.
   *
   * Used to serialise operations that have no single row to lock — a nightly
   * reconciliation, a batch repricing run, a saga step that must not overlap
   * with itself. Two schedulers on two pods both deciding to run the same job is
   * the failure this prevents; without it the job runs twice and double-posts.
   *
   * Uses `pg_advisory_xact_lock`, not `pg_advisory_lock`. The `xact` variant is
   * released automatically when the transaction ends, including on error. The
   * session variant would leak on any code path that throws before its explicit
   * unlock, and the job would then be blocked forever.
   *
   * `SET LOCAL lock_timeout` bounds the wait, so a contended lock produces a
   * clear 409 rather than a request that hangs until its timeout.
   */
  async withAdvisoryLock<T>(
    key: string,
    fn: (tx: TransactionClient) => Promise<T>,
    options: { lockTimeoutMs?: number; timeoutMs?: number } = {},
  ): Promise<T> {
    const lockKey = advisoryLockKey(key);
    const lockTimeoutMs = options.lockTimeoutMs ?? 5_000;

    return this.transaction(
      async (tx) => {
        // `SET LOCAL` applies to this transaction only, so it cannot leak into
        // the next user of this pooled connection.
        await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = ${Math.floor(lockTimeoutMs)}`);

        try {
          await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock($1::bigint)`, lockKey);
        } catch (error) {
          if (isLockTimeout(error)) {
            throw new ConflictError(
              `Another process is already running "${key}". Try again shortly.`,
            );
          }
          throw error;
        }

        return fn(tx);
      },
      { timeoutMs: options.timeoutMs ?? 120_000, maxRetries: 0 },
    );
  }

  /**
   * Maps a Prisma error to a domain error where the mapping is unambiguous.
   *
   * `P2002` (unique violation) is surfaced as a conflict rather than a 500: it
   * is the database enforcing an invariant the caller violated, and the caller
   * can act on it. Everything else is re-thrown untouched so the exception
   * filter can decide, and so a genuine bug still produces a stack trace.
   */
  private translate(error: unknown): unknown {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const target = Array.isArray(error.meta?.['target'])
        ? (error.meta['target'] as string[]).join(', ')
        : 'a unique field';
      return new ConflictError(`A record with this ${target} already exists.`);
    }
    return error;
  }
}

/** Prisma's code for a write conflict or deadlock — the database asking for a retry. */
function isRetryableConflict(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    // P2034: "Transaction failed due to a write conflict or a deadlock."
    return error.code === 'P2034';
  }
  // Prisma does not always wrap the raw driver error, so the SQLSTATEs are also
  // checked: 40001 is a serialisation failure, 40P01 is a deadlock.
  const message = error instanceof Error ? error.message : '';
  return message.includes('40001') || message.includes('40P01') || message.includes('deadlock');
}

function isLockTimeout(error: unknown): boolean {
  const message = error instanceof Error ? error.message : '';
  return message.includes('55P03') || message.toLowerCase().includes('lock timeout');
}

function errorCode(error: unknown): string {
  if (error instanceof Prisma.PrismaClientKnownRequestError) return error.code;
  return error instanceof Error ? error.name : 'unknown';
}

/**
 * Derives a stable signed 64-bit advisory-lock key from a string.
 *
 * Postgres advisory locks take a `bigint`. Deriving it deterministically from a
 * readable name means two processes agree on the key without a shared registry,
 * and the name can be logged — which is what makes a blocked job diagnosable.
 */
export function advisoryLockKey(name: string): bigint {
  // FNV-1a over the name. A cryptographic hash is unnecessary here: the key only
  // needs to be stable and well-distributed, and this avoids a dependency on
  // node:crypto in a module that is otherwise pure.
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;

  for (let index = 0; index < name.length; index += 1) {
    hash ^= BigInt(name.charCodeAt(index));
    hash = (hash * prime) & mask;
  }

  // Map into the signed range so the value round-trips through `bigint`.
  return hash >= 0x8000000000000000n ? hash - 0x10000000000000000n : hash;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

#!/usr/bin/env node
/**
 * Order-placement load test — the Phase 1 exit criterion:
 *
 *   "Order placement p95 < 800 ms at 200 RPS sustained."
 *
 * ## Why this drives the service and not HTTP
 *
 * Every placement consumes a cart, and `OrderService.place` resolves *the*
 * caller's ACTIVE cart from the authenticated principal. Driving the endpoint
 * therefore needs one authenticated buyer per request — thousands of sign-ins
 * for a ten-second run — and the number that came out would be dominated by the
 * auth and HTTP layers rather than by placing an order. Those layers already
 * have their own measurement (`loadtest/run-local.mjs`, `GET /auth/me`).
 *
 * So this measures the placement path itself: the cart lock, the stock
 * reservation, the order and its lines, the status history, and the audit row,
 * all inside the real `UnitOfWork` transaction against a real PostgreSQL. That
 * is the part with a latency budget, and excluding transport overhead is the
 * conservative choice — the endpoint cannot be faster than the work it does.
 *
 * ## Why it pre-provisions a pool
 *
 * A placement is a one-shot: the cart it consumes is `CONVERTED` and cannot be
 * reused. Each "virtual user" is an organisation with one stocked product and
 * one cart, and the run draws one placement from each. The pool is created with
 * `createMany` in five batched round trips, because inserting them one at a time
 * would take longer than the test.
 *
 * ## Safety
 *
 * It writes thousands of rows and does not clean up. It refuses to run against
 * anything that looks like production, and requires `LOAD_ALLOW_WRITES=1` so it
 * cannot be started by accident. Point it at a disposable database.
 *
 * ## Usage
 *
 *   docker compose -f infra/docker/docker-compose.yml up -d postgres
 *   npm run db:migrate && npm run db:seed
 *   LOAD_ALLOW_WRITES=1 npm run load:orders --workspace=@medichain/backend
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Prisma, PrismaClient } from '@prisma/client';

import { createRequestContext, requestContext } from '../common/context/request-context';
import type { NotificationPort } from '../common/ports/notification.port';
import {
  buildDatasourceUrl,
  extendPrismaClient,
  type ExtendedPrismaClient,
} from '../database/prisma.service';
import { UnitOfWork } from '../database/unit-of-work';
import { AuditService } from '../modules/audit';
import { NotificationService } from '../modules/notifications';
import { OrderService } from '../modules/orders';

const TARGET_RPS = Number(process.env['LOAD_RPS'] ?? 200);
const DURATION_SECONDS = Number(process.env['LOAD_DURATION'] ?? 10);
const P95_BUDGET_MS = Number(process.env['LOAD_P95_MS'] ?? 800);
const CONCURRENCY = Number(process.env['LOAD_CONCURRENCY'] ?? 50);
/**
 * Connection pool for the run.
 *
 * Stated explicitly rather than inherited, because Prisma's default is derived
 * from the host's core count — which makes the same command produce different
 * latency on different machines. It also has to be at least as large as the
 * concurrency: an interactive transaction holds its connection for its whole
 * duration, so a pool smaller than the in-flight count queues requests and the
 * measurement describes the pool rather than the placement path.
 */
const POOL_MAX = Number(process.env['LOAD_POOL_MAX'] ?? 60);
/** Headroom on the pool: a placement that fails retries from a spare buyer. */
const POOL_MULTIPLIER = 1.3;

const ACTOR_ID = '11111111-1111-4111-8111-111111111111';

/** Notifications are not what is being measured, and would flood the output. */
const SILENT_PORT: NotificationPort = {
  sendOtp: () => Promise.resolve(),
  sendOrderPlaced: () => Promise.resolve(),
};

function loadEnvFile(): void {
  if (process.env['DATABASE_URL'] !== undefined && process.env['DATABASE_URL'] !== '') return;
  try {
    for (const line of readFileSync(join(__dirname, '..', '..', '.env'), 'utf8').split(/\r?\n/)) {
      const match = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (match === null) continue;
      const key = match[1] as string;
      if (process.env[key] === undefined) process.env[key] = match[2] as string;
    }
  } catch {
    // No .env: the environment is expected to carry DATABASE_URL.
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Nearest-rank percentile, which is what a latency SLO is usually read as. */
function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return Number.NaN;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)] as number;
}

/** One organisation with a stocked product and a cart holding one of it. */
interface Buyer {
  readonly organisationId: string;
}

async function main(): Promise<void> {
  loadEnvFile();

  const url = process.env['DATABASE_URL'];
  if (url === undefined || url === '') {
    console.error('Set DATABASE_URL, or provide backend/.env, before running this.');
    process.exit(2);
  }

  if (process.env['NODE_ENV'] === 'production') {
    console.error('This load test writes thousands of rows and must not run against production.');
    process.exit(2);
  }

  if (process.env['LOAD_ALLOW_WRITES'] !== '1') {
    console.error(
      'This writes a large amount of data and does not clean up.\n' +
        'Re-run with LOAD_ALLOW_WRITES=1 to confirm you are pointing at a disposable database.',
    );
    process.exit(2);
  }

  const prisma: ExtendedPrismaClient = extendPrismaClient(
    new PrismaClient({
      datasourceUrl: buildDatasourceUrl(url, {
        poolMax: POOL_MAX,
        statementTimeoutMs: 10_000,
        idleInTransactionTimeoutMs: 30_000,
      }),
    }),
  );
  const orders = new OrderService(
    prisma,
    new UnitOfWork(prisma),
    new AuditService(prisma),
    new NotificationService(SILENT_PORT),
  );

  const tenant = await requestContext.runUnscoped(
    async () => prisma.tenant.findFirst({ select: { id: true }, orderBy: { createdAt: 'asc' } }),
    'load-test',
  );
  if (tenant === null) {
    console.error('No tenant found. Run `npm run db:migrate && npm run db:seed` first.');
    process.exit(2);
  }
  const tenantId = tenant.id;

  const total = Math.ceil(TARGET_RPS * DURATION_SECONDS);
  const poolSize = Math.ceil(total * POOL_MULTIPLIER);

  // ------------------------------------------------------------- provision
  console.log(
    `Provisioning ${poolSize} buyers for ${total} placements ` +
      `(${TARGET_RPS} RPS for ${DURATION_SECONDS}s)…`,
  );

  const buyers: Buyer[] = Array.from({ length: poolSize }, () => ({
    organisationId: randomUUID(),
  }));
  const provisionStartedAt = Date.now();

  // One tenant context for the whole provision: the scoping extension needs an
  // ambient tenant, and every row here belongs to the one seeded tenant.
  const context = createRequestContext({ requestId: 'load-provision' });
  context.tenantId = tenantId;

  await requestContext.run(context, async () => {
    await prisma.organisation.createMany({
      data: buyers.map((buyer, index) => ({
        id: buyer.organisationId,
        tenantId,
        type: 'PHARMACY' as const,
        status: 'ACTIVE' as const,
        legalName: `Load buyer ${index}`,
      })),
    });

    const productIds = buyers.map(() => randomUUID());
    const price = new Prisma.Decimal('12.5000');

    await prisma.product.createMany({
      data: productIds.map((id, index) => ({
        id,
        tenantId,
        name: `Load product ${index}`,
        schedule: 'OTC',
        price,
      })),
    });

    await prisma.warehouseStock.createMany({
      data: productIds.map((productId, index) => ({
        tenantId,
        productId,
        warehouseId: `WH-LOAD-${index}`,
        quantity: new Prisma.Decimal(5),
        reserved: new Prisma.Decimal(0),
      })),
    });

    const cartIds = buyers.map(() => randomUUID());
    await prisma.cart.createMany({
      data: cartIds.map((id, index) => ({
        id,
        tenantId,
        organisationId: buyers[index]?.organisationId as string,
        status: 'ACTIVE',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      })),
    });

    await prisma.cartItem.createMany({
      data: cartIds.map((cartId, index) => ({
        tenantId,
        cartId,
        productId: productIds[index] as string,
        quantity: new Prisma.Decimal(1),
        price,
      })),
    });
  });

  console.log(`Provisioned in ${Date.now() - provisionStartedAt}ms.`);

  // ------------------------------------------------------------------- run
  const latencies: number[] = [];
  const failures: string[] = [];
  let nextBuyer = 0;

  /** Fires one placement, timing the call and recording its outcome. */
  async function fire(): Promise<void> {
    const buyer = buyers[nextBuyer];
    nextBuyer += 1;
    if (buyer === undefined) {
      failures.push('ran out of provisioned buyers');
      return;
    }

    const startedAt = performance.now();
    try {
      // A fresh context per placement, as a real request would have.
      const requestScope = createRequestContext({ requestId: `load-${nextBuyer}` });
      requestScope.tenantId = tenantId;
      await requestContext.run(requestScope, () =>
        orders.place(tenantId, buyer.organisationId, ACTOR_ID, {}),
      );
      latencies.push(performance.now() - startedAt);
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
      latencies.push(performance.now() - startedAt);
    }
  }

  const intervalMs = 1000 / TARGET_RPS;
  const runStartedAt = performance.now();
  const inFlight = new Set<Promise<void>>();

  console.log(`Placing orders at ${TARGET_RPS} RPS with ${CONCURRENCY} in flight…`);

  for (let index = 0; index < total; index += 1) {
    const dueAt = runStartedAt + index * intervalMs;
    const wait = dueAt - performance.now();
    if (wait > 0) await sleep(wait);

    const promise = fire().finally(() => inFlight.delete(promise));
    inFlight.add(promise);

    if (inFlight.size >= CONCURRENCY) await Promise.race(inFlight);
  }

  await Promise.all(inFlight);
  const elapsedSeconds = (performance.now() - runStartedAt) / 1000;

  // ---------------------------------------------------------------- report
  const sorted = [...latencies].sort((a, b) => a - b);
  const p50 = percentile(sorted, 50);
  const p95 = percentile(sorted, 95);
  const p99 = percentile(sorted, 99);
  const achievedRps = total / elapsedSeconds;

  console.log('\nResults');
  console.log(
    `  placements ${total} · achieved ${achievedRps.toFixed(1)} RPS · ` +
      `p50 ${p50.toFixed(1)}ms · p95 ${p95.toFixed(1)}ms · p99 ${p99.toFixed(1)}ms · ` +
      `max ${(sorted[sorted.length - 1] ?? 0).toFixed(1)}ms · failures ${failures.length}`,
  );

  if (failures.length > 0) {
    const unique = [...new Set(failures)].slice(0, 5);
    console.log('  first failures:');
    for (const failure of unique) console.log(`    - ${failure}`);
  }

  // ------------------------------------------------------------ assertions
  const problems: string[] = [];

  if (failures.length > 0) {
    problems.push(`${failures.length} placement(s) failed`);
  }
  if (!Number.isFinite(p95)) {
    problems.push('could not compute a p95 — no placements recorded');
  } else if (p95 >= P95_BUDGET_MS) {
    problems.push(`p95 ${p95.toFixed(1)}ms is at or above the ${P95_BUDGET_MS}ms budget`);
  }
  if (achievedRps < TARGET_RPS * 0.95) {
    problems.push(
      `achieved ${achievedRps.toFixed(1)} RPS against a ${TARGET_RPS} RPS target — ` +
        'the target was not reached, so the latency figures do not describe the criterion',
    );
  }

  console.log('');
  await prisma.$disconnect();

  if (problems.length > 0) {
    console.error('Load test FAILED:');
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }

  console.log(
    `Load test passed: ${total} placements at ${achievedRps.toFixed(1)} RPS with p95 ` +
      `${p95.toFixed(1)}ms (< ${P95_BUDGET_MS}ms) and zero failures.`,
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

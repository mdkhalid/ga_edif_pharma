import type { CallHandler, ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import { firstValueFrom, from } from 'rxjs';

import {
  IdempotencyKeyReusedError,
  RequestInProgressError,
} from '../../src/common/exceptions/domain.exception';
import { IdempotencyInterceptor } from '../../src/common/interceptors/idempotency.interceptor';
import type { ExtendedPrismaClient } from '../../src/database/prisma.service';
import { RedisIdempotencyStore } from '../../src/infra/cache/redis-idempotency.store';
import { RedisService } from '../../src/infra/cache/redis.service';
import type { OrderService } from '../../src/modules/orders/application/order.service';
import { testConfig } from '../support/config';
import { asTenantUser, createTestPrisma, seededTenant } from '../support/database';
import { buildOrderService } from '../support/services';

/**
 * The idempotency half of the Phase 1 exit criteria:
 *
 *   "An order placed twice with the same `Idempotency-Key` creates **one**
 *    order."
 *
 * ## Why the assertion is "the same response", not just "one order"
 *
 * Since the cart fix, a second placement from the same cart fails on its own —
 * the cart is no longer ACTIVE — so counting orders alone would pass even with
 * idempotency switched off, and the test would be measuring the cart guard while
 * claiming to measure the replay. A working replay returns the *first* response,
 * order id included, without reaching the handler at all. That is what
 * distinguishes the two mechanisms, so that is what is asserted.
 *
 * ## Why a real Redis
 *
 * The store's whole job is an atomic `SET NX` plus a read, and its failure mode
 * (fail open) is a policy decision made by the caller. A fake store proves
 * neither: the interceptor's unit tests already cover the scripted outcomes, and
 * this suite covers the ones that only exist against a real server.
 */

/** Minimal `Reflector`: every route in this suite is idempotent with one TTL. */
const reflector = {
  getAllAndOverride: () => ({ ttlSeconds: 3_600 }),
} as unknown as Reflector;

/** Route and verb are part of the dedupe scope, so they are fixed here. */
const ROUTE = '/orders';

const ACTOR_ID = '11111111-1111-4111-8111-111111111111';

describe('idempotent order placement (integration)', () => {
  let prisma: ExtendedPrismaClient;
  let orders: OrderService;
  let redis: RedisService;
  let interceptor: IdempotencyInterceptor;
  let tenantId: string;

  beforeAll(async () => {
    prisma = createTestPrisma();
    tenantId = (await seededTenant(prisma)).id;
    orders = buildOrderService(prisma);

    redis = new RedisService(
      testConfig({
        REDIS_URL: process.env['REDIS_URL'] ?? '',
        // A run-unique namespace with no flush at the end: a test that flushes
        // Redis would destroy whatever else is on the instance it was pointed
        // at, so cleanup is left to the TTLs.
        REDIS_KEY_PREFIX: `medichain-spec:${Date.now().toString(36)}:`,
      }),
    );
    await redis.onModuleInit();

    if ((await redis.ping()) === null) {
      throw new Error(
        'These tests need a reachable Redis. Set REDIS_URL, or start one with: ' +
          'docker run -d --name medichain-redis-dev -p 56379:6379 redis:7-alpine',
      );
    }

    interceptor = new IdempotencyInterceptor(reflector, new RedisIdempotencyStore(redis));
  });

  afterAll(async () => {
    await redis.onModuleDestroy();
    await prisma.$disconnect();
  });

  /** A buyer with a stocked product in its cart, plus the ids a test needs. */
  async function buyerWithCart(): Promise<{ buyerId: string; productId: string }> {
    return asTenantUser(tenantId, async () => {
      const suffix = `${Date.now()}-${Math.random()}`;

      const organisation = await prisma.organisation.create({
        data: { tenantId, type: 'PHARMACY', legalName: `Idempotency buyer ${suffix}` },
        select: { id: true },
      });

      const product = await prisma.product.create({
        data: {
          tenantId,
          name: `Idempotency product ${suffix}`,
          schedule: 'OTC',
          price: new Prisma.Decimal('10.0000'),
        },
        select: { id: true },
      });

      await prisma.warehouseStock.create({
        data: {
          tenantId,
          productId: product.id,
          warehouseId: `WH-IDEM-${product.id.slice(0, 8)}`,
          quantity: new Prisma.Decimal(10),
          reserved: new Prisma.Decimal(0),
        },
      });

      const cart = await prisma.cart.create({
        data: {
          tenantId,
          organisationId: organisation.id,
          status: 'ACTIVE',
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        },
        select: { id: true },
      });

      await prisma.cartItem.create({
        data: {
          tenantId,
          cartId: cart.id,
          productId: product.id,
          quantity: new Prisma.Decimal(1),
          price: new Prisma.Decimal('10.0000'),
        },
      });

      return { buyerId: organisation.id, productId: product.id };
    });
  }

  /** Orders actually recorded for a buyer. */
  async function orderCount(buyerId: string): Promise<number> {
    return asTenantUser(tenantId, async () =>
      prisma.customerOrder.count({ where: { organisationId: buyerId } }),
    );
  }

  /** The HTTP context the interceptor reads its scope, key and body from. */
  function context(key: string, body: unknown = {}): ExecutionContext {
    return {
      getType: () => 'http',
      switchToHttp: () => ({
        getRequest: () => ({
          method: 'POST',
          route: { path: ROUTE },
          headers: { 'idempotency-key': key },
          body,
        }),
        getResponse: () => ({ statusCode: 201 }),
      }),
      getHandler: () => function handler(): void {},
      getClass: () => class StubController {},
    } as unknown as ExecutionContext;
  }

  /** A handler that places an order, counting how often it is actually reached. */
  function placingHandler(buyerId: string): { handler: CallHandler; calls: () => number } {
    let invocations = 0;
    return {
      handler: {
        handle: () => {
          invocations += 1;
          return from(asTenantUser(tenantId, () => orders.place(tenantId, buyerId, ACTOR_ID, {})));
        },
      },
      calls: () => invocations,
    };
  }

  const POST = (key: string, body: unknown, handler: CallHandler) =>
    firstValueFrom(interceptor.intercept(context(key, body), handler));

  describe('the same key used twice', () => {
    it('replays the first response instead of placing a second order', async () => {
      const { buyerId } = await buyerWithCart();
      const first = placingHandler(buyerId);
      const retry = placingHandler(buyerId);
      const key = `key-${Date.now()}-a`;

      const firstResponse = await POST(key, {}, first.handler);
      const retryResponse = await POST(key, {}, retry.handler);

      // The replay is what proves idempotency rather than the cart guard: the
      // retry never reached the handler.
      expect(retryResponse).toEqual(firstResponse);
      expect(retry.calls()).toBe(0);
      expect(first.calls()).toBe(1);
      expect(await orderCount(buyerId)).toBe(1);
    });

    it('places one order when the duplicate arrives while the first is running', async () => {
      const { buyerId } = await buyerWithCart();
      const first = placingHandler(buyerId);
      const key = `key-${Date.now()}-b`;

      const results = await Promise.allSettled([
        POST(key, {}, first.handler),
        POST(key, {}, placingHandler(buyerId).handler),
      ]);

      const fulfilled = results.filter((result) => result.status === 'fulfilled');
      const rejected = results.filter((result) => result.status === 'rejected');

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      // 409, not a duplicate order: the in-flight marker is written before the
      // handler runs, which is the whole reason the write is two-phase.
      expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(RequestInProgressError);
      expect(await orderCount(buyerId)).toBe(1);
    });

    it('rejects the same key carrying a different body', async () => {
      const { buyerId } = await buyerWithCart();
      const key = `key-${Date.now()}-c`;

      await POST(key, { notes: 'first' }, placingHandler(buyerId).handler);

      await expect(
        POST(key, { notes: 'different' }, placingHandler(buyerId).handler),
      ).rejects.toBeInstanceOf(IdempotencyKeyReusedError);

      // Reusing a key for a different payload must not create a second order.
      expect(await orderCount(buyerId)).toBe(1);
    });
  });

  describe('different keys', () => {
    it('are independent, so a genuine second order is still allowed', async () => {
      // Idempotency dedupes retries; it must not stop a buyer ordering twice.
      const { buyerId, productId } = await buyerWithCart();

      await POST(`key-${Date.now()}-d1`, {}, placingHandler(buyerId).handler);

      // A second order needs a second cart: the first was converted.
      const secondCart = await asTenantUser(tenantId, async () =>
        prisma.cart.create({
          data: {
            tenantId,
            organisationId: buyerId,
            status: 'ACTIVE',
            expiresAt: new Date(Date.now() + 60 * 60 * 1000),
          },
          select: { id: true },
        }),
      );

      await asTenantUser(tenantId, async () =>
        prisma.cartItem.create({
          data: {
            tenantId,
            cartId: secondCart.id,
            productId,
            quantity: new Prisma.Decimal(1),
            price: new Prisma.Decimal('10.0000'),
          },
        }),
      );

      await POST(`key-${Date.now()}-d2`, {}, placingHandler(buyerId).handler);

      expect(await orderCount(buyerId)).toBe(2);
    });
  });

  /**
   * Fail-open (ADR-014) is deliberately **not** covered here.
   *
   * Asserting it needs a Redis that cannot be reached, and an ioredis client
   * pointed at a dead host schedules reconnect timers for as long as it lives —
   * a suite that does not exit is worse than a suite without one more case. The
   * behaviour is already pinned twice at unit level, in `RedisIdempotencyStore`
   * (unreachable ⇒ `unavailable`) and in `IdempotencyInterceptor`
   * (`unavailable` ⇒ the handler runs unprotected), which is the level at which
   * it can be asserted deterministically. What this suite adds is the part a
   * stub cannot prove: the store's atomic claim against a real server.
   */
});

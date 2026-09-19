import { Prisma } from '@prisma/client';

import { ErrorCode } from '@medichain/shared-types';

import {
  BusinessRuleViolationError,
  type DomainException,
} from '../../src/common/exceptions/domain.exception';
import type { ExtendedPrismaClient } from '../../src/database/prisma.service';
import type { OrderService } from '../../src/modules/orders/application/order.service';
import { asTenantUser, createTestPrisma, seededBuyerOrganisation, seededTenant } from '../support/database';
import { buildOrderService } from '../support/services';

/**
 * Order placement under contention — the Phase 1 exit criterion:
 *
 *   "Concurrent order placement on the last unit of stock never oversells
 *    (verified by a concurrent integration test)."
 *
 * Two invariants are checked, because they fail for different reasons:
 *
 *   1. **One cart, one order.** Placement converts the cart to `CONVERTED`
 *      inside the transaction. Two callers that both read the cart as `ACTIVE`
 *      must not both place from it.
 *   2. **No oversell.** Reservation walks the stock rows holding `FOR UPDATE`
 *      locks. Two callers racing for the final units must serialise, and the
 *      loser must fail rather than drive `reserved` past `quantity`.
 *
 * These are the tests the roadmap calls a money-path merge gate. They are
 * correctness tests, not benchmarks: each fires a handful of concurrent calls
 * and asserts the invariant, with no timing assumptions beyond "these overlap".
 */

/**
 * A fixed actor id. `order_status_history.actor_id` carries no foreign key, so
 * any UUID is valid; using a constant keeps the assertions deterministic.
 */
const ACTOR_ID = '11111111-1111-4111-8111-111111111111';

describe('order placement under contention', () => {
  let prisma: ExtendedPrismaClient;
  let orders: OrderService;
  let tenantId: string;
  let organisationId: string;

  beforeAll(async () => {
    prisma = createTestPrisma();
    tenantId = (await seededTenant(prisma)).id;
    organisationId = (await seededBuyerOrganisation(prisma, tenantId)).id;

    orders = buildOrderService(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /** Creates a product with stock in a warehouse no other test uses. */
  async function createProductWithStock(stock: number): Promise<string> {
    return asTenantUser(tenantId, async () => {
      const product = await prisma.product.create({
        data: {
          tenantId,
          name: `Contention test product ${stock} @ ${Date.now()}`,
          schedule: 'OTC',
          price: new Prisma.Decimal('10.0000'),
        },
        select: { id: true },
      });

      await prisma.warehouseStock.create({
        data: {
          tenantId,
          productId: product.id,
          warehouseId: `WH-TEST-${product.id.slice(0, 8)}`,
          quantity: new Prisma.Decimal(stock),
          reserved: new Prisma.Decimal(0),
        },
      });

      return product.id;
    });
  }

  /** Opens an ACTIVE cart holding `quantity` of `productId` for `buyerId`. */
  async function openCart(
    buyerId: string,
    productId: string,
    quantity = 1,
  ): Promise<string> {
    return asTenantUser(tenantId, async () => {
      const cart = await prisma.cart.create({
        data: {
          tenantId,
          organisationId: buyerId,
          status: 'ACTIVE',
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        },
        select: { id: true },
      });

      await prisma.cartItem.create({
        data: {
          tenantId,
          cartId: cart.id,
          productId,
          quantity: new Prisma.Decimal(quantity),
          price: new Prisma.Decimal('10.0000'),
        },
      });

      return cart.id;
    });
  }

  /** Reserved units currently held against a product. */
  async function reservedFor(productId: string): Promise<number> {
    // The arrow is `async` on purpose: a Prisma promise is lazy, so returning
    // one directly from `requestContext.run` would defer the query until after
    // the ambient tenant context had already been popped.
    const rows = await asTenantUser(tenantId, async () =>
      prisma.warehouseStock.findMany({
        where: { productId },
        select: { reserved: true },
      }),
    );
    return rows.reduce((total, row) => total + row.reserved.toNumber(), 0);
  }

  const place = (buyerId: string) =>
    asTenantUser(tenantId, () => orders.place(tenantId, buyerId, ACTOR_ID, {}));

  describe('the same cart placed concurrently', () => {
    it('produces exactly one order', async () => {
      // Ten units, so stock is not the constraint — the cart is. This isolates
      // the cart-conversion rule from the reservation rule.
      const productId = await createProductWithStock(10);
      await openCart(organisationId, productId, 1);

      const results = await Promise.allSettled(
        Array.from({ length: 4 }, () => place(organisationId)),
      );

      const placed = results.filter((result) => result.status === 'fulfilled');
      expect(placed).toHaveLength(1);
    });

    it('reserves stock exactly once', async () => {
      const productId = await createProductWithStock(10);
      await openCart(organisationId, productId, 1);

      await Promise.allSettled(Array.from({ length: 4 }, () => place(organisationId)));

      // The strongest single signal: a second order would have reserved again.
      expect(await reservedFor(productId)).toBe(1);
    });
  });

  describe('several buyers racing for the last units', () => {
    it('never oversells', async () => {
      // Two units, four buyers, one unit each: exactly two may win.
      const productId = await createProductWithStock(2);

      const buyers = await asTenantUser(tenantId, async () =>
        Promise.all(
          Array.from({ length: 4 }, async (_, index) => {
            const organisation = await prisma.organisation.create({
              data: {
                tenantId,
                type: 'PHARMACY',
                legalName: `Contention buyer ${index} @ ${Date.now()}`,
              },
              select: { id: true },
            });
            return organisation.id;
          }),
        ),
      );

      for (const buyer of buyers) {
        await openCart(buyer, productId, 1);
      }

      const results = await Promise.allSettled(buyers.map((buyer) => place(buyer)));
      const placed = results.filter((result) => result.status === 'fulfilled');

      expect(placed).toHaveLength(2);
      expect(await reservedFor(productId)).toBe(2);
    });

    it('reports the shortfall as a business-rule violation, not a crash', async () => {
      const productId = await createProductWithStock(1);

      const buyers = await asTenantUser(tenantId, async () =>
        Promise.all(
          Array.from({ length: 3 }, async (_, index) => {
            const organisation = await prisma.organisation.create({
              data: {
                tenantId,
                type: 'PHARMACY',
                legalName: `Shortfall buyer ${index} @ ${Date.now()}`,
              },
              select: { id: true },
            });
            return organisation.id;
          }),
        ),
      );

      for (const buyer of buyers) {
        await openCart(buyer, productId, 1);
      }

      const results = await Promise.allSettled(buyers.map((buyer) => place(buyer)));
      const rejected = results.filter((result) => result.status === 'rejected');

      expect(rejected).toHaveLength(2);
      for (const result of rejected) {
        // A 422 with an explanation the buyer can act on — not a 500, and not
        // an unhandled Prisma error surfacing through the exception filter.
        const reason = (result as PromiseRejectedResult).reason as DomainException;
        expect(reason).toBeInstanceOf(BusinessRuleViolationError);
        expect(reason.httpStatus).toBe(422);
        expect(reason.code).toBe(ErrorCode.BUSINESS_RULE_VIOLATION);
      }
    });
  });
});

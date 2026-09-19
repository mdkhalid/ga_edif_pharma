import { Prisma } from '@prisma/client';

import { OrderStatus, type OrderStatus as OrderStatusType } from '@medichain/shared-types';

import type { ExtendedPrismaClient } from '../../src/database/prisma.service';
import type { OrderService } from '../../src/modules/orders/application/order.service';
import { asTenantUser, createTestPrisma, seededBuyerOrganisation, seededTenant } from '../support/database';
import { buildOrderService } from '../support/services';

/**
 * The order-history half of the Phase 1 exit criteria:
 *
 *   "100% of order state transitions appear in `order_status_history` with an
 *    actor."
 *
 * "100%" is the whole assertion, so the test walks a full lifecycle rather than
 * one edge and checks the record is complete, not merely non-empty. The
 * complement is checked too: a transition the state machine rejects must leave
 * *no* row, or the history would claim a change that never happened.
 */

const ACTOR_ID = '11111111-1111-4111-8111-111111111111';

/** One recorded transition, in the shape the assertion compares. */
interface RecordedTransition {
  fromStatus: string | null;
  toStatus: string;
}

describe('order status history (integration)', () => {
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

  /** Places a one-line order for a freshly created, well-stocked product. */
  async function placeOrder(): Promise<string> {
    await asTenantUser(tenantId, async () => {
      const product = await prisma.product.create({
        data: {
          tenantId,
          name: `History test product @ ${Date.now()}-${Math.random()}`,
          schedule: 'OTC',
          price: new Prisma.Decimal('10.0000'),
        },
        select: { id: true },
      });

      await prisma.warehouseStock.create({
        data: {
          tenantId,
          productId: product.id,
          warehouseId: `WH-HIST-${product.id.slice(0, 8)}`,
          quantity: new Prisma.Decimal(50),
          reserved: new Prisma.Decimal(0),
        },
      });

      const cart = await prisma.cart.create({
        data: {
          tenantId,
          organisationId,
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
    });

    const placed = await asTenantUser(tenantId, () =>
      orders.place(tenantId, organisationId, ACTOR_ID, {}),
    );
    return placed.id;
  }

  /** The recorded history for an order. */
  async function history(orderId: string): Promise<Array<RecordedTransition & { actorId: string }>> {
    const rows = await asTenantUser(tenantId, async () =>
      prisma.orderStatusHistory.findMany({
        where: { orderId },
        select: { fromStatus: true, toStatus: true, actorId: true },
        orderBy: { createdAt: 'asc' },
      }),
    );
    return rows;
  }

  const move = (orderId: string, to: OrderStatusType, reason?: string) =>
    asTenantUser(tenantId, () => orders.transition(tenantId, orderId, to, ACTOR_ID, reason));

  it('records placement as the opening transition, from nothing', async () => {
    const orderId = await placeOrder();

    const rows = await history(orderId);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.fromStatus).toBeNull();
    expect(rows[0]?.toStatus).toBe(OrderStatus.PLACED);
    expect(rows[0]?.actorId).toBe(ACTOR_ID);
  });

  it('records every transition of a full lifecycle', async () => {
    const orderId = await placeOrder();

    await move(orderId, OrderStatus.CONFIRMED);
    await move(orderId, OrderStatus.PROCESSING);
    await move(orderId, OrderStatus.DISPATCHED);
    await move(orderId, OrderStatus.DELIVERED);

    const rows = await history(orderId);

    // Complete, not merely non-empty: the four moves plus placement.
    expect(rows).toHaveLength(5);
    expect(rows.map((row) => `${row.fromStatus ?? '∅'}->${row.toStatus}`)).toEqual(
      expect.arrayContaining([
        '∅->PLACED',
        'PLACED->CONFIRMED',
        'CONFIRMED->PROCESSING',
        'PROCESSING->DISPATCHED',
        'DISPATCHED->DELIVERED',
      ]),
    );
  });

  it('attributes every transition to the acting user', async () => {
    const orderId = await placeOrder();
    await move(orderId, OrderStatus.CONFIRMED);
    await move(orderId, OrderStatus.PROCESSING);

    const rows = await history(orderId);

    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.actorId === ACTOR_ID)).toBe(true);
  });

  it('carries the reason given for the transition', async () => {
    const orderId = await placeOrder();

    await move(orderId, OrderStatus.CANCELLED, 'Buyer asked to cancel.');

    const rows = await asTenantUser(tenantId, async () =>
      prisma.orderStatusHistory.findMany({
        where: { orderId, toStatus: OrderStatus.CANCELLED },
        select: { reason: true },
      }),
    );

    expect(rows[0]?.reason).toBe('Buyer asked to cancel.');
  });

  it('records nothing for a transition the state machine rejects', async () => {
    const orderId = await placeOrder();
    await move(orderId, OrderStatus.CONFIRMED);
    await move(orderId, OrderStatus.PROCESSING);
    await move(orderId, OrderStatus.DISPATCHED);
    await move(orderId, OrderStatus.DELIVERED);

    const before = await history(orderId);

    // DELIVERED may only go to RETURN_REQUESTED; PROCESSING is illegal.
    await expect(move(orderId, OrderStatus.PROCESSING)).rejects.toThrow();

    const after = await history(orderId);

    // The rejected attempt must leave the trail untouched — a history row for a
    // transition that never happened would be worse than a missing one.
    expect(after).toHaveLength(before.length);
    expect(after[after.length - 1]?.toStatus).toBe(OrderStatus.DELIVERED);
  });
});

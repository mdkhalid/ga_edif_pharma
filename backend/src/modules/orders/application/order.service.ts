import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { ORDER_TRANSITIONS, type OrderStatus } from '@medichain/shared-types';

import { ExtendedPrismaClient, PRISMA_EXTENDED } from '../../../database/prisma.service';
import { UnitOfWork, type TransactionClient } from '../../../database/unit-of-work';
import {
  buildOffsetMeta,
  resolveOffset,
} from '../../../common/utils/pagination.util';
import {
  BusinessRuleViolationError,
  ForbiddenError,
  InvalidTransitionError,
  NotFoundError,
} from '../../../common/exceptions/domain.exception';
import { AuditService } from '../../audit';
import { NotificationService } from '../../notifications';
import type { ListOrdersQuery, PlaceOrderDto } from '../api/dto/order.dto';

/**
 * Orders: idempotent placement from the cart with stock reservation, plus
 * the fulfilment state machine.
 *
 * ## No oversell
 *
 * Placement runs in one transaction: the cart row is locked, every touched
 * stock row is locked (`SELECT … FOR UPDATE`), availability is re-checked
 * against live rows, and the reservation (`reserved += qty`) commits
 * atomically with the order. Two concurrent placements on the last unit
 * serialise on the row lock; the loser sees the winner's reservation and
 * fails with a 422, never with negative stock.
 *
 * ## Query discipline
 *
 * Only `findFirst`/`findMany`/`updateMany`/`deleteMany`/`create` appear
 * below — never `findUnique`/`update`/`upsert` by id. The scoping extension
 * appends `tenantId` to the filter, and Prisma rejects a non-unique `where`
 * on the singular operations. Ownership of a locked row is proven by
 * `lockById`, which filters on the tenant explicitly.
 */
@Injectable()
export class OrderService {
  constructor(
    @Inject(PRISMA_EXTENDED) private readonly prisma: ExtendedPrismaClient,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
  ) {}

  async place(
    tenantId: string,
    organisationId: string,
    actorId: string,
    dto: PlaceOrderDto,
  ): Promise<{ id: string; total: string }> {
    // The notification goes out after the commit, never inside it: a
    // retried transaction must not re-send, and a failed send must not roll
    // back a placed order. Best-effort — durability is the outbox relay's
    // job, which is still to come.
    const placed = await this.uow.transaction(async (tx) => {
      const cart = await tx.cart.findFirst({
        where: { organisationId, status: 'ACTIVE' },
        include: {
          items: {
            include: {
              product: { select: { id: true, name: true, status: true, price: true } },
            },
          },
        },
        orderBy: { expiresAt: 'desc' },
      });
      if (!cart || cart.items.length === 0) {
        throw new BusinessRuleViolationError('The cart is empty. Add items before placing an order.');
      }

      // The lock alone is not enough. `FOR UPDATE` serialises the callers, but
      // the row it hands back is the *current* one — and under READ COMMITTED a
      // waiting `SELECT … FOR UPDATE` re-reads the row after the blocking
      // transaction commits, so it sees the `CONVERTED` status written below.
      // Without this check every caller that had already read the cart as
      // ACTIVE would go on to place its own order from it: four concurrent
      // placements produced four orders before this line existed.
      const lockedCart = await this.uow.lockById<{ id: string; status: string }>(
        tx,
        'cart',
        cart.id,
        tenantId,
      );
      if (!lockedCart) throw new NotFoundError('The cart is no longer available.');
      if (lockedCart.status !== 'ACTIVE') {
        throw new BusinessRuleViolationError(
          'This cart has already been ordered. Start a new cart to order again.',
        );
      }

      let total = new Prisma.Decimal(0);
      const lines: Array<{ productId: string; quantity: Prisma.Decimal; price: Prisma.Decimal }> = [];

      for (const item of cart.items) {
        if (item.product.status !== 'ACTIVE') {
          throw new BusinessRuleViolationError(
            `${item.product.name} is no longer available for ordering.`,
          );
        }
        await this.reserve(tx, tenantId, item.productId, item.quantity, item.product.name);
        const lineTotal = item.quantity.mul(item.product.price);
        total = total.add(lineTotal);
        lines.push({ productId: item.productId, quantity: item.quantity, price: item.product.price });
      }

      const order = await tx.customerOrder.create({
        data: {
          tenantId,
          organisationId,
          status: 'PLACED',
          paymentStatus: 'PENDING',
          subtotal: total,
          discount: new Prisma.Decimal(0),
          total,
          currency: 'INR',
          deliveryAddress: dto.deliveryAddress ?? null,
          notes: dto.notes ?? null,
        },
        select: { id: true },
      });

      await tx.orderItem.createMany({
        data: lines.map((line) => ({
          tenantId,
          orderId: order.id,
          productId: line.productId,
          quantity: line.quantity,
          price: line.price,
        })),
      });

      await tx.cart.updateMany({
        where: { id: cart.id },
        data: { status: 'CONVERTED' },
      });

      // The opening row of the order's history. Placement is a transition out
      // of nothing, so `fromStatus` is null. Recorded here rather than inferred
      // later, so the trail starts at the order's creation and the "every
      // transition has a history row" guarantee holds from the first one.
      await tx.orderStatusHistory.create({
        data: {
          tenantId,
          orderId: order.id,
          fromStatus: null,
          toStatus: 'PLACED',
          actorId,
        },
      });

      await this.audit.recordInTransaction(tx, {
        tenantId,
        action: 'order.placed',
        entity: 'CustomerOrder',
        entityId: order.id,
        actorId,
        metadata: { lines: lines.length, total: total.toString() },
      });

      return { id: order.id, total: total.toString(), lines: lines.length };
    });

    const [org, tenant] = await Promise.all([
      this.prisma.organisation.findFirst({
        where: { id: organisationId },
        select: { email: true, phone: true },
      }),
      this.prisma.tenant.findFirst({
        where: { id: tenantId },
        select: { name: true },
      }),
    ]);

    await this.notifications.sendOrderPlaced({
      orderId: placed.id,
      total: placed.total,
      currency: 'INR',
      itemCount: placed.lines,
      tenantName: tenant?.name ?? 'MediChain',
      email: org?.email ?? null,
      phone: org?.phone ?? null,
    });

    return { id: placed.id, total: placed.total };
  }

  async list(
    _tenantId: string,
    organisationId: string | null,
    staff: boolean,
    query: ListOrdersQuery,
  ): Promise<{
    data: Array<{ id: string; status: string; total: string; createdAt: Date }>;
    meta: { page: number; pageSize: number; total: number; totalPages: number; hasNext: boolean; hasPrev: boolean };
  }> {
    const resolved = resolveOffset(query.page, query.pageSize);
    // The tenant filter is injected by the scoping extension; the
    // organisation filter keeps a buyer inside their own orders.
    const where: Prisma.CustomerOrderWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(!staff && organisationId ? { organisationId } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.customerOrder.findMany({
        where,
        select: { id: true, status: true, total: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        skip: resolved.skip,
        take: resolved.take,
      }),
      this.prisma.customerOrder.count({ where }),
    ]);

    return {
      data: rows.map((row) => ({
        id: row.id,
        status: row.status,
        total: row.total.toString(),
        createdAt: row.createdAt,
      })),
      meta: buildOffsetMeta(total, resolved),
    };
  }

  async getById(
    _tenantId: string,
    id: string,
    organisationId: string | null,
    staff: boolean,
  ): Promise<{
    id: string;
    status: string;
    paymentStatus: string;
    total: string;
    items: Array<{
      productId: string;
      productName: string;
      quantity: string;
      price: string;
      lineTotal: string;
    }>;
    statusHistory: Array<{
      fromStatus: string | null;
      toStatus: string;
      actorId: string;
      reason: string | null;
      createdAt: Date;
    }>;
  } | null> {
    // The tenant filter is injected by the scoping extension.
    const row = await this.prisma.customerOrder.findFirst({
      where: { id },
      include: {
        orderItems: { include: { product: { select: { name: true } } } },
        statusHistory: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!row) return null;
    if (!staff && organisationId !== row.organisationId) {
      throw new ForbiddenError('This order belongs to another organisation.');
    }

    return {
      id: row.id,
      status: row.status,
      paymentStatus: row.paymentStatus,
      total: row.total.toString(),
      items: row.orderItems.map((item) => ({
        productId: item.productId,
        productName: item.product.name,
        quantity: item.quantity.toString(),
        price: item.price.toString(),
        lineTotal: item.quantity.mul(item.price).toString(),
      })),
      statusHistory: row.statusHistory.map((entry) => ({
        fromStatus: entry.fromStatus,
        toStatus: entry.toStatus,
        actorId: entry.actorId,
        reason: entry.reason,
        createdAt: entry.createdAt,
      })),
    };
  }

  /**
   * Moves an order to `to`, enforcing the canonical `ORDER_TRANSITIONS`
   * machine from shared-types. Cancelling releases every reservation.
   */
  async transition(
    tenantId: string,
    id: string,
    to: OrderStatus,
    actorId: string,
    reason?: string,
  ): Promise<void> {
    await this.uow.transaction(async (tx) => {
      const locked = await this.uow.lockById<{ id: string; status: string }>(
        tx,
        'customer_order',
        id,
        tenantId,
      );
      if (!locked) throw new NotFoundError('Order not found.');

      const from = locked.status as OrderStatus;
      const allowed = ORDER_TRANSITIONS[from] ?? [];
      if (!allowed.includes(to)) {
        throw new InvalidTransitionError('order', from, to);
      }

      await tx.customerOrder.updateMany({
        where: { id },
        data: {
          status: to,
          ...(to === 'CANCELLED'
            ? { cancelledAt: new Date(), cancelledReason: reason ?? null }
            : {}),
        },
      });

      if (to === 'CANCELLED') {
        await this.releaseAll(tx, tenantId, id);
      }

      // The exit criterion is that *every* transition lands here with an
      // actor, so this write sits inside the same transaction as the status
      // change: a history row that could outlive a rolled-back transition
      // would be worse than no row at all.
      await tx.orderStatusHistory.create({
        data: {
          tenantId,
          orderId: id,
          fromStatus: from,
          toStatus: to,
          actorId,
          reason: reason ?? null,
        },
      });

      await this.audit.recordInTransaction(tx, {
        tenantId,
        action: `order.${to.toLowerCase()}`,
        entity: 'CustomerOrder',
        entityId: id,
        actorId,
        changes: { status: { from, to } },
        metadata: reason ? { reason } : undefined,
      });
    });
  }

  /**
   * Reserves `qty` of a product across warehouse rows, first-fit, holding a
   * row lock on each touched row. Throws when the live availability falls
   * short — the transaction rolls back and nothing is half-reserved.
   */
  private async reserve(
    tx: TransactionClient,
    tenantId: string,
    productId: string,
    qty: Prisma.Decimal,
    productName: string,
  ): Promise<void> {
    const rows = await tx.warehouseStock.findMany({
      where: { productId },
      select: { id: true, quantity: true, reserved: true },
      orderBy: { warehouseId: 'asc' },
    });

    let remaining = qty.toNumber();
    for (const row of rows) {
      if (remaining <= 0) break;
      const locked = await this.uow.lockById<{ id: string; quantity: string; reserved: string }>(
        tx,
        'warehouse_stock',
        row.id,
        tenantId,
      );
      if (!locked) continue;
      const free = Number(locked.quantity) - Number(locked.reserved);
      const take = Math.min(free, remaining);
      if (take <= 0) continue;
      await tx.warehouseStock.updateMany({
        where: { id: row.id },
        data: { reserved: new Prisma.Decimal(Number(locked.reserved) + take) },
      });
      remaining -= take;
    }

    if (remaining > 0) {
      throw new BusinessRuleViolationError(
        `Only ${qty.toNumber() - remaining} units of ${productName} are available.`,
      );
    }
  }

  /** Releases every reservation held for an order's lines, row by row. */
  private async releaseAll(tx: TransactionClient, tenantId: string, orderId: string): Promise<void> {
    const items = await tx.orderItem.findMany({
      where: { orderId },
      select: { productId: true, quantity: true },
    });

    for (const item of items) {
      let remaining = item.quantity.toNumber();
      const rows = await tx.warehouseStock.findMany({
        where: { productId: item.productId },
        select: { id: true },
        orderBy: { warehouseId: 'asc' },
      });
      for (const row of rows) {
        if (remaining <= 0) break;
        const locked = await this.uow.lockById<{ id: string; reserved: string }>(
          tx,
          'warehouse_stock',
          row.id,
          tenantId,
        );
        if (!locked) continue;
        const release = Math.min(Number(locked.reserved), remaining);
        if (release <= 0) continue;
        await tx.warehouseStock.updateMany({
          where: { id: row.id },
          data: { reserved: new Prisma.Decimal(Number(locked.reserved) - release) },
        });
        remaining -= release;
      }
    }
  }
}

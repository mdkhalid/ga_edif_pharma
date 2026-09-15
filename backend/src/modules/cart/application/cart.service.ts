import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { ExtendedPrismaClient, PRISMA_EXTENDED } from '../../../database/prisma.service';
import { UnitOfWork, type TransactionClient } from '../../../database/unit-of-work';
import {
  BusinessRuleViolationError,
  ForbiddenError,
  NotFoundError,
} from '../../../common/exceptions/domain.exception';
import { AuditService } from '../../audit';

export interface CartLine {
  readonly productId: string;
  readonly productName: string;
  readonly quantity: string;
  readonly unitPrice: string;
  readonly lineTotal: string;
  readonly available: string;
}

export interface CartView {
  readonly id: string;
  readonly items: CartLine[];
  readonly total: string;
}

/**
 * Server-side cart, one ACTIVE cart per organisation.
 *
 * Prices are always live: adding an item snapshots the current product price,
 * and reading the cart re-prices from the product master so a stale price
 * can never reach checkout. Availability is the sum of unreserved warehouse
 * stock; every mutation re-checks it inside the transaction.
 *
 * The cart belongs to the caller's organisation (`principal.organisationId`).
 * A principal without an organisation (back-office staff) holds no cart and
 * is refused — staff operate on orders, not on a buyer's cart.
 */
@Injectable()
export class CartService {
  constructor(
    @Inject(PRISMA_EXTENDED) private readonly prisma: ExtendedPrismaClient,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditService,
  ) {}

  /** Requires the caller to belong to a buying organisation. */
  requireOrganisationId(organisationId: string | null): string {
    if (!organisationId) {
      throw new ForbiddenError('A cart belongs to a buying organisation.');
    }
    return organisationId;
  }

  async get(_tenantId: string, organisationId: string): Promise<CartView> {
    const cart = await this.prisma.cart.findFirst({
      where: { organisationId, status: 'ACTIVE' },
      include: {
        items: { include: { product: { select: { name: true, price: true } } } },
      },
      orderBy: { expiresAt: 'desc' },
    });
    if (!cart) throw new NotFoundError('No active cart. Add an item to start one.');

    const lines: CartLine[] = [];
    let total = new Prisma.Decimal(0);
    for (const item of cart.items) {
      const available = await this.availableQty(item.productId);
      const lineTotal = item.quantity.mul(item.product.price);
      total = total.add(lineTotal);
      lines.push({
        productId: item.productId,
        productName: item.product.name,
        quantity: item.quantity.toString(),
        unitPrice: item.product.price.toString(),
        lineTotal: lineTotal.toString(),
        available: available.toString(),
      });
    }

    return { id: cart.id, items: lines, total: total.toString() };
  }

  async add(
    tenantId: string,
    organisationId: string,
    productId: string,
    quantity: number,
    actorId: string,
  ): Promise<{ cartId: string }> {
    const result = await this.uow.transaction(async (tx) => {
      const cartId = await this.ensureActiveCart(tx, tenantId, organisationId);

      // findFirst (not findUnique) and no upsert: the scoping extension adds
      // `tenantId` to the filter, and Prisma rejects a non-unique `where` on
      // findUnique/update/upsert. The transaction serialises concurrent adds.
      const product = await tx.product.findFirst({
        where: { id: productId },
        select: { id: true, name: true, status: true, price: true },
      });
      if (!product) throw new NotFoundError('Product not found.');
      if (product.status !== 'ACTIVE') {
        throw new BusinessRuleViolationError('Only ACTIVE products can be added to a cart.');
      }

      const existing = await tx.cartItem.findFirst({
        where: { cartId, productId },
        select: { quantity: true },
      });
      const wanted = (existing ? existing.quantity.toNumber() : 0) + quantity;

      const available = await this.availableQtyTx(tx, productId);
      if (wanted > available.toNumber()) {
        throw new BusinessRuleViolationError(
          `Only ${available.toString()} units of ${product.name} are available.`,
        );
      }

      if (existing) {
        await tx.cartItem.updateMany({
          where: { cartId, productId },
          data: { quantity: new Prisma.Decimal(wanted), price: product.price },
        });
      } else {
        await tx.cartItem.create({
          data: {
            tenantId,
            cartId,
            productId,
            quantity: new Prisma.Decimal(quantity),
            price: product.price,
          },
        });
      }

      await this.audit.recordInTransaction(tx, {
        tenantId,
        action: 'cart.item.added',
        entity: 'Cart',
        entityId: cartId,
        actorId,
        metadata: { productId, quantity },
      });

      return { cartId };
    });

    return result;
  }

  async updateQty(
    tenantId: string,
    organisationId: string,
    productId: string,
    quantity: number,
    actorId: string,
  ): Promise<void> {
    await this.uow.transaction(async (tx) => {
      const cart = await this.lockActiveCart(tx, tenantId, organisationId);

      if (quantity === 0) {
        await tx.cartItem.deleteMany({ where: { cartId: cart.id, productId } });
      } else {
        const line = await tx.cartItem.findFirst({
          where: { cartId: cart.id, productId },
          select: {
            quantity: true,
            product: { select: { id: true, name: true, status: true } },
          },
        });
        if (!line) throw new NotFoundError('Item is not in the cart.');

        const available = await this.availableQtyTx(tx, productId);
        if (quantity > available.toNumber()) {
          throw new BusinessRuleViolationError(
            `Only ${available.toString()} units of ${line.product.name} are available.`,
          );
        }

        await tx.cartItem.updateMany({
          where: { cartId: cart.id, productId },
          data: { quantity: new Prisma.Decimal(quantity) },
        });
      }

      await this.audit.recordInTransaction(tx, {
        tenantId,
        action: 'cart.item.updated',
        entity: 'Cart',
        entityId: cart.id,
        actorId,
        metadata: { productId, quantity },
      });
    });
  }

  async remove(
    tenantId: string,
    organisationId: string,
    productId: string,
    actorId: string,
  ): Promise<void> {
    await this.updateQty(tenantId, organisationId, productId, 0, actorId);
  }

  /** Units available to promise: sum of (quantity − reserved) across warehouses. */
  async availableQty(productId: string): Promise<Prisma.Decimal> {
    const rows = await this.prisma.warehouseStock.findMany({
      where: { productId },
      select: { quantity: true, reserved: true },
    });
    return rows.reduce(
      (sum, row) => sum.add(row.quantity.sub(row.reserved)),
      new Prisma.Decimal(0),
    );
  }

  private async availableQtyTx(tx: TransactionClient, productId: string): Promise<Prisma.Decimal> {
    const rows = await tx.warehouseStock.findMany({
      where: { productId },
      select: { quantity: true, reserved: true },
    });
    return rows.reduce(
      (sum, row) => sum.add(row.quantity.sub(row.reserved)),
      new Prisma.Decimal(0),
    );
  }

  private async ensureActiveCart(
    tx: TransactionClient,
    tenantId: string,
    organisationId: string,
  ): Promise<string> {
    const existing = await tx.cart.findFirst({
      where: { organisationId, status: 'ACTIVE' },
      select: { id: true },
      orderBy: { expiresAt: 'desc' },
    });
    if (existing) return existing.id;

    const created = await tx.cart.create({
      data: {
        tenantId,
        organisationId,
        status: 'ACTIVE',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
      select: { id: true },
    });
    return created.id;
  }

  private async lockActiveCart(
    tx: TransactionClient,
    tenantId: string,
    organisationId: string,
  ): Promise<{ id: string }> {
    const cart = await tx.cart.findFirst({
      where: { organisationId, status: 'ACTIVE' },
      select: { id: true },
      orderBy: { expiresAt: 'desc' },
    });
    if (!cart) throw new NotFoundError('No active cart. Add an item to start one.');

    const locked = await this.uow.lockById<{ id: string }>(tx, 'cart', cart.id, tenantId);
    if (!locked) throw new NotFoundError('No active cart. Add an item to start one.');
    return locked;
  }
}

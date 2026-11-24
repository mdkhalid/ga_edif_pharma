import { Prisma } from '@prisma/client';

import type { ExtendedPrismaClient } from '../../src/database/prisma.service';
import { AuditService } from '../../src/modules/audit/application/audit.service';
import type { OrderService } from '../../src/modules/orders/application/order.service';
import { PrescriptionService } from '../../src/modules/prescriptions';
import { PrescriptionRepositoryPrisma } from '../../src/modules/prescriptions';
import { asTenantUser, createTestPrisma, seededBuyerOrganisation, seededTenant } from '../support/database';
import { buildOrderServiceWithPort } from '../support/services';
import { SILENT_NOTIFICATION_PORT } from '../support/services';

const ACTOR_ID = '11111111-1111-4111-8111-111111111111';

describe('prescription gate (integration)', () => {
  let prisma: ExtendedPrismaClient;
  let orders: OrderService;
  let prescriptions: PrescriptionService;
  let tenantId: string;
  let organisationId: string;

  beforeAll(async () => {
    prisma = createTestPrisma();
    tenantId = (await seededTenant(prisma)).id;
    organisationId = (await seededBuyerOrganisation(prisma, tenantId)).id;
    orders = buildOrderServiceWithPort(prisma, SILENT_NOTIFICATION_PORT);
    prescriptions = new PrescriptionService(new AuditService(prisma), new PrescriptionRepositoryPrisma(prisma));
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function seedScheduledProduct(): Promise<string> {
    return asTenantUser(tenantId, async () => {
      const product = await prisma.product.create({
        data: {
          tenantId,
          name: `H1 product @ ${Date.now()}-${Math.random()}`,
          schedule: 'H1',
          price: new Prisma.Decimal('10.0000'),
        },
        select: { id: true },
      });
      await prisma.warehouseStock.create({
        data: {
          tenantId,
          productId: product.id,
          warehouseId: `WH-RX-${product.id.slice(0, 8)}`,
          quantity: new Prisma.Decimal(50),
          reserved: new Prisma.Decimal(0),
        },
      });
      return product.id;
    });
  }

  async function placeCartWithProduct(productId: string, prescriptionId?: string): Promise<string> {
    return asTenantUser(tenantId, async () => {
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
          productId,
          quantity: new Prisma.Decimal(1),
          price: new Prisma.Decimal('10.0000'),
        },
      });
      const placed = await orders.place(tenantId, organisationId, ACTOR_ID, {
        prescriptionId,
      });
      return placed.id;
    });
  }

  it('blocks an order for a scheduled product with no prescription', async () => {
    const productId = await seedScheduledProduct();
    await expect(placeCartWithProduct(productId)).rejects.toThrow(/verified prescription/i);
  });

  it('blocks an order with a pending (unverified) prescription', async () => {
    const productId = await seedScheduledProduct();
    const rx = await asTenantUser(tenantId, async () =>
      prescriptions.create(tenantId, ACTOR_ID, { organisationId }),
    );
    await expect(placeCartWithProduct(productId, rx.id)).rejects.toThrow(/not been verified/i);
  });

  it('allows an order with a verified prescription and links it', async () => {
    const productId = await seedScheduledProduct();
    const rx = await asTenantUser(tenantId, async () =>
      prescriptions.create(tenantId, ACTOR_ID, { organisationId, validTo: null }),
    );
    await asTenantUser(tenantId, async () => {
      await prescriptions.verify(tenantId, rx.id, ACTOR_ID, { decision: 'APPROVE' });
    });
    const orderId = await placeCartWithProduct(productId, rx.id);
    const order = await asTenantUser(tenantId, async () =>
      prisma.customerOrder.findUnique({ where: { id: orderId } }),
    );
    expect(order?.prescriptionId).toBe(rx.id);
  });
});

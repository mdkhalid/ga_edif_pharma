import type { ExtendedPrismaClient } from '../../src/database/prisma.service';
import { StockQueryService } from '../../src/modules/inventory/application/stock-query.service';
import { asTenantUser, createTestPrisma, seededTenant } from '../support/database';

describe('stock read API (integration)', () => {
  let prisma: ExtendedPrismaClient;
  let service: StockQueryService;
  let tenantId: string;

  beforeAll(async () => {
    prisma = createTestPrisma();
    tenantId = (await seededTenant(prisma)).id;
    service = new StockQueryService(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('reports quantity, reserved and decimal-exact available stock', async () => {
    const product = await asTenantUser(tenantId, async () =>
      prisma.product.create({
        data: { tenantId, name: 'Stock Read Product', schedule: 'OTC', price: 100 },
        select: { id: true },
      }),
    );

    const created = await asTenantUser(tenantId, async () =>
      prisma.warehouseStock.create({
        data: {
          tenantId,
          productId: product.id,
          warehouseId: 'READ-API-WH',
          quantity: 100.5,
          reserved: 10.25,
          batchId: 'BATCH-1',
        },
        select: { id: true },
      }),
    );

    const page = await asTenantUser(tenantId, async () =>
      service.list(tenantId, { productId: product.id }),
    );
    const row = page.data.find((item) => item.id === created.id);
    expect(row?.quantity).toBe('100.5');
    expect(row?.reserved).toBe('10.25');
    expect(row?.available).toBe('90.25');
    expect(row?.productName).toBe('Stock Read Product');

    const detail = await asTenantUser(tenantId, async () => service.getById(tenantId, created.id));
    expect(detail.batchId).toBe('BATCH-1');
    expect(detail.available).toBe('90.25');
  });
});

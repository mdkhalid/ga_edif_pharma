import type { ExtendedPrismaClient } from '../../src/database/prisma.service';
import { PriceListManagementService } from '../../src/modules/pricing/application/price-list-management.service';
import {
  asTenantUser,
  createTestPrisma,
  seededTenant,
} from '../support/database';

describe('price-list read API (integration)', () => {
  let prisma: ExtendedPrismaClient;
  let service: PriceListManagementService;
  let tenantId: string;

  beforeAll(async () => {
    prisma = createTestPrisma();
    tenantId = (await seededTenant(prisma)).id;
    service = new PriceListManagementService(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('lists price lists and returns exact prices and dates on get', async () => {
    // A dedicated buyer: a customer may belong to only one price list per tenant,
    // and the seeded buyer is already assigned by the commerce fixture.
    const buyer = await asTenantUser(tenantId, async () =>
      prisma.organisation.create({
        data: {
          tenantId,
          type: 'PHARMACY',
          status: 'ACTIVE',
          legalName: `Price List Read Org ${Date.now()}`,
        },
        select: { id: true },
      }),
    );
    const product = await asTenantUser(tenantId, async () =>
      prisma.product.create({
        data: { tenantId, name: 'Read API Product', schedule: 'OTC', price: 100 },
        select: { id: true },
      }),
    );

    const list = await asTenantUser(tenantId, async () => service.list(tenantId, {}));
    expect(list.meta.page).toBe(1);
    expect(Array.isArray(list.data)).toBe(true);

    const created = await asTenantUser(tenantId, async () =>
      prisma.priceList.create({
        data: {
          tenantId,
          name: `Read API list ${Date.now()}`,
          status: 'ACTIVE',
          effectiveFrom: new Date('2026-01-01T00:00:00Z'),
          effectiveTo: new Date('2026-12-31T00:00:00Z'),
          lines: {
            create: { tenantId, productId: product.id, minQty: 1, unitPrice: 90.25 },
          },
          customers: { create: { tenantId, organisationId: buyer.id } },
        },
        select: { id: true },
      }),
    );

    const listed = await asTenantUser(tenantId, async () => service.list(tenantId, { status: 'ACTIVE' }));
    const row = listed.data.find((item) => item.id === created.id);
    expect(row?.lineCount).toBe(1);
    expect(row?.customerCount).toBe(1);
    expect(typeof row?.effectiveFrom).toBe('string');

    const detail = await asTenantUser(tenantId, async () => service.getById(tenantId, created.id));
    expect(detail.lines).toHaveLength(1);
    expect(detail.lines[0]?.unitPrice).toBe('90.25');
    expect(detail.lines[0]?.productName).toBe('Read API Product');
    expect(detail.customerOrganisationIds).toContain(buyer.id);
  });
});

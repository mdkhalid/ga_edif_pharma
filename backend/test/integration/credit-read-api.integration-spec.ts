import type { ExtendedPrismaClient } from '../../src/database/prisma.service';
import { CreditQueryService } from '../../src/modules/credit/application/credit-query.service';
import { asTenantUser, createTestPrisma, seededTenant } from '../support/database';

describe('credit read API (integration)', () => {
  let prisma: ExtendedPrismaClient;
  let service: CreditQueryService;
  let tenantId: string;

  beforeAll(async () => {
    prisma = createTestPrisma();
    tenantId = (await seededTenant(prisma)).id;
    service = new CreditQueryService(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('reports limit, exposure and floored available credit', async () => {
    const organisation = await asTenantUser(tenantId, async () =>
      prisma.organisation.create({
        data: {
          tenantId,
          type: 'PHARMACY',
          status: 'ACTIVE',
          legalName: `Credit Read Org ${Date.now()}`,
          creditLimit: 10_000,
          currentExposure: 12_000,
        },
        select: { id: true },
      }),
    );

    const page = await asTenantUser(tenantId, async () =>
      service.list(tenantId, { search: 'Credit Read Org' }),
    );
    const row = page.data.find((item) => item.organisationId === organisation.id);
    expect(row?.creditLimit).toBe('10000');
    expect(row?.currentExposure).toBe('12000');
    // Exposure over the limit is reported as zero available, as the domain ledger does.
    expect(row?.availableCredit).toBe('0');

    const detail = await asTenantUser(tenantId, async () =>
      service.getById(tenantId, organisation.id),
    );
    expect(detail.legalName).toContain('Credit Read Org');
    expect(detail.availableCredit).toBe('0');
  });
});

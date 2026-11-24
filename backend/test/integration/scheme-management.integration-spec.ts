import type { ExtendedPrismaClient } from '../../src/database/prisma.service';
import { AuditService } from '../../src/modules/audit/application/audit.service';
import { SchemeManagementService } from '../../src/modules/pricing/application/scheme-management.service';
import { asTenantUser, createTestPrisma, seededTenant } from '../support/database';

describe('scheme management (integration)', () => {
  let prisma: ExtendedPrismaClient;
  let schemes: SchemeManagementService;
  let tenantId: string;

  beforeAll(async () => {
    prisma = createTestPrisma();
    tenantId = (await seededTenant(prisma)).id;
    schemes = new SchemeManagementService(prisma, new AuditService(prisma));
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('creates, lists, gets, updates, and archives a scheme', async () => {
    const created = await asTenantUser(tenantId, async () =>
      schemes.create(tenantId, 'actor', {
        name: '10% off',
        kind: 'PERCENTAGE',
        percentOff: 10,
        validFrom: new Date().toISOString(),
        validTo: new Date(Date.now() + 86400000).toISOString(),
      }),
    );
    expect(created.id).toBeTruthy();

    const list = await asTenantUser(tenantId, async () => schemes.list(tenantId, {}));
    expect(list.data.length).toBeGreaterThanOrEqual(1);

    const got = await asTenantUser(tenantId, async () => schemes.getById(tenantId, created.id));
    expect((got as { name: string }).name).toBe('10% off');

    await asTenantUser(tenantId, async () => schemes.update(tenantId, created.id, 'actor', { priority: 5 }));
    const updated = await asTenantUser(tenantId, async () => schemes.getById(tenantId, created.id));
    expect((updated as { priority: number }).priority).toBe(5);

    await asTenantUser(tenantId, async () => schemes.archive(tenantId, created.id, 'actor'));
    const archived = await asTenantUser(tenantId, async () => schemes.getById(tenantId, created.id));
    expect((archived as { status: string }).status).toBe('INACTIVE');
  });
});

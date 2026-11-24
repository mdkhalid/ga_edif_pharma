import type { ExtendedPrismaClient } from '../../src/database/prisma.service';
import { AuditService } from '../../src/modules/audit/application/audit.service';
import { SchemeManagementService } from '../../src/modules/pricing/application/scheme-management.service';
import { asTenantUser, createTestPrisma, seededTenant } from '../support/database';

describe('scheme management (integration)', () => {
  let prisma: ExtendedPrismaClient;
  let schemes: SchemeManagementService;
  let tenantId: string;
  let actorId: string;

  beforeAll(async () => {
    prisma = createTestPrisma();
    tenantId = (await seededTenant(prisma)).id;
    schemes = new SchemeManagementService(prisma, new AuditService(prisma));

    // Audit rows store a UUID actor; a placeholder string would be silently
    // dropped by the audit writer, so the test uses a real user.
    const actor = await asTenantUser(tenantId, async () =>
      prisma.user.create({
        data: {
          tenantId,
          fullName: 'Scheme Admin',
          email: `schemes-${Date.now()}@test.local`,
          passwordHash: 'x',
        },
        select: { id: true },
      }),
    );
    actorId = actor.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('creates, lists, gets, updates, and archives a scheme', async () => {
    const created = await asTenantUser(tenantId, async () =>
      schemes.create(tenantId, actorId, {
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
    const listed = list.data.find((row) => row.id === created.id);
    expect(listed?.name).toBe('10% off');
    // The admin portal consumes this shape: decimals are numbers and dates are
    // ISO strings, never Prisma Decimal/Date objects.
    expect(typeof listed?.validFrom).toBe('string');
    expect(listed?.percentOff).toBe(10);
    expect(listed?.flatOff).toBeNull();

    const got = await asTenantUser(tenantId, async () => schemes.getById(tenantId, created.id));
    expect((got as { name: string }).name).toBe('10% off');

    await asTenantUser(tenantId, async () => schemes.update(tenantId, created.id, actorId, { priority: 5 }));
    const updated = await asTenantUser(tenantId, async () => schemes.getById(tenantId, created.id));
    expect((updated as { priority: number }).priority).toBe(5);

    await asTenantUser(tenantId, async () => schemes.archive(tenantId, created.id, actorId));
    const archived = await asTenantUser(tenantId, async () => schemes.getById(tenantId, created.id));
    expect((archived as { status: string }).status).toBe('INACTIVE');
  });
});

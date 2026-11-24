import type { ExtendedPrismaClient } from '../../src/database/prisma.service';
import { NotificationCentreService } from '../../src/modules/notifications/application/notification-centre.service';
import { asTenantUser, createTestPrisma, seededTenant } from '../support/database';

describe('notification centre (integration)', () => {
  let prisma: ExtendedPrismaClient;
  let centre: NotificationCentreService;
  let tenantId: string;
  let userId: string;

  beforeAll(async () => {
    prisma = createTestPrisma();
    tenantId = (await seededTenant(prisma)).id;
    centre = new NotificationCentreService(prisma);
    // create a user
    const user = await asTenantUser(tenantId, async () =>
      prisma.user.create({
        data: {
          tenantId,
          fullName: 'Notify User',
          email: `notify-${Date.now()}@test.local`,
          passwordHash: 'x',
        },
        select: { id: true },
      }),
    );
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('creates, lists, and marks notifications read', async () => {
    const created = await asTenantUser(tenantId, async () =>
      centre.create({ tenantId, recipientId: userId, type: 'ORDER_PLACED', title: 'Order placed', body: 'Your order is placed.' }),
    );

    const list = await asTenantUser(tenantId, async () =>
      centre.list(tenantId, userId, { unreadOnly: false }),
    );
    expect(list.unreadCount).toBeGreaterThanOrEqual(1);
    expect(list.data.some((n) => n.id === created.id)).toBe(true);

    await asTenantUser(tenantId, async () => centre.markRead(tenantId, created.id, userId));

    const after = await asTenantUser(tenantId, async () =>
      centre.list(tenantId, userId, { unreadOnly: true }),
    );
    expect(after.data.some((n) => n.id === created.id)).toBe(false);
  });

  it('markAllRead clears all unread', async () => {
    await asTenantUser(tenantId, async () =>
      centre.create({ tenantId, recipientId: userId, type: 'X', title: 't', body: 'b' }),
    );
    const res = await asTenantUser(tenantId, async () => centre.markAllRead(tenantId, userId));
    expect(res.count).toBeGreaterThanOrEqual(1);
    const list = await asTenantUser(tenantId, async () => centre.list(tenantId, userId, { unreadOnly: true }));
    expect(list.unreadCount).toBe(0);
  });
});

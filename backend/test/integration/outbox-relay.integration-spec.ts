import { Prisma } from '@prisma/client';

import type { ExtendedPrismaClient } from '../../src/database/prisma.service';
import { AuditService } from '../../src/modules/audit/application/audit.service';
import { NotificationService } from '../../src/modules/notifications/application/notification.service';
import { OutboxService } from '../../src/modules/outbox';
import { asTenantUser, createTestPrisma, seededTenant } from '../support/database';
import { UnitOfWork } from '../../src/database/unit-of-work';

const ACTOR_ID = '11111111-1111-4111-8111-111111111111';

describe('outbox relay (integration)', () => {
  let prisma: ExtendedPrismaClient;
  let outbox: OutboxService;
  let tenantId: string;
  const delivered: string[] = [];

  beforeAll(async () => {
    prisma = createTestPrisma();
    tenantId = (await seededTenant(prisma)).id;
    const port = {
      sendOtp: () => Promise.resolve(),
      sendOrderPlaced: (input: { orderId: string }) => {
        delivered.push(input.orderId);
        return Promise.resolve();
      },
    };
    const notifications = new NotificationService(port as never);
    outbox = new OutboxService(prisma, new UnitOfWork(prisma), notifications);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('publishes an enqueued event and marks it PUBLISHED', async () => {
    delivered.length = 0;
    const id = await asTenantUser(tenantId, async () =>
      outbox.enqueueStandalone({
        tenantId,
        eventType: 'order.placed',
        aggregateType: 'CustomerOrder',
        aggregateId: '00000000-0000-4000-8000-000000000001',
        payload: {
          orderId: 'order-1',
          total: '10.00',
          currency: 'INR',
          itemCount: 1,
          tenantName: 'MediChain',
          email: null,
          phone: null,
        },
        deduplicationKey: `order.placed:outbox-test-${Date.now()}`,
      }),
    );

    const processed = await outbox.processBatch();
    expect(processed).toBeGreaterThanOrEqual(1);
    expect(delivered).toContain('order-1');

    const row = await asTenantUser(tenantId, async () =>
      prisma.outboxEvent.findFirst({ where: { id } }),
    );
    expect(row?.status).toBe('PUBLISHED');
  });

  it('dead-letters an event whose handler always fails', async () => {
    const failingPort = {
      sendOtp: () => Promise.resolve(),
      sendOrderPlaced: () => Promise.reject(new Error('boom')),
    };
    const failingNotifications = new NotificationService(failingPort as never);
    const failingOutbox = new OutboxService(prisma, new UnitOfWork(prisma), failingNotifications);

    const id = await asTenantUser(tenantId, async () =>
      failingOutbox.enqueueStandalone({
        tenantId,
        eventType: 'order.placed',
        aggregateType: 'CustomerOrder',
        aggregateId: '00000000-0000-4000-8000-000000000002',
        payload: {
          orderId: 'order-2',
          total: '10.00',
          currency: 'INR',
          itemCount: 1,
          tenantName: 'MediChain',
          email: null,
          phone: null,
        },
        deduplicationKey: `order.placed:outbox-fail-${Date.now()}`,
      }),
    );

    // maxAttempts default 10; force a single attempt by setting maxAttempts via raw update
    await asTenantUser(tenantId, async () => {
      await prisma.outboxEvent.updateMany({ where: { id }, data: { maxAttempts: 1 } });
    });

    await failingOutbox.processBatch();

    const row = await asTenantUser(tenantId, async () =>
      prisma.outboxEvent.findFirst({ where: { id } }),
    );
    expect(row?.status).toBe('DEAD');
  });
});

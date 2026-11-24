import type { ExtendedPrismaClient } from '../../src/database/prisma.service';
import { AuditService } from '../../src/modules/audit/application/audit.service';
import { NotificationTemplateService } from '../../src/modules/notifications/application/notification-template.service';
import { asTenantUser, createTestPrisma, seededTenant } from '../support/database';

describe('notification templates (integration)', () => {
  let prisma: ExtendedPrismaClient;
  let templates: NotificationTemplateService;
  let tenantId: string;
  let actorId: string;
  let audit: AuditService;

  beforeAll(async () => {
    prisma = createTestPrisma();
    tenantId = (await seededTenant(prisma)).id;
    audit = new AuditService(prisma);
    templates = new NotificationTemplateService(prisma, audit);

    // Start from a clean slate: templates are durable and earlier runs leave rows
    // behind, which would otherwise turn the create branch into an update.
    await asTenantUser(tenantId, async () =>
      prisma.notificationTemplate.deleteMany({ where: { tenantId } }),
    );

    const actor = await asTenantUser(tenantId, async () =>
      prisma.user.create({
        data: {
          tenantId,
          fullName: 'Template Admin',
          email: `templates-${Date.now()}@test.local`,
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

  it('creates, lists, and replaces template wording', async () => {
    const created = await asTenantUser(tenantId, async () =>
      templates.upsert(tenantId, actorId, {
        name: 'order.placed',
        channel: 'EMAIL',
        subject: 'Order {{orderId}} placed',
        body: 'Hello {{name}}, your order is in.',
      }),
    );
    expect(created.created).toBe(true);

    const list = await asTenantUser(tenantId, async () => templates.list(tenantId));
    expect(list.some((t) => t.name === 'order.placed' && t.channel === 'EMAIL')).toBe(true);
    expect(typeof list.find((t) => t.name === 'order.placed')?.createdAt).toBe('string');

    const replaced = await asTenantUser(tenantId, async () =>
      templates.upsert(tenantId, actorId, {
        name: 'order.placed',
        channel: 'EMAIL',
        subject: 'Order {{orderId}} confirmed',
        body: 'Thanks {{name}}.',
      }),
    );
    expect(replaced.created).toBe(false);
    expect(replaced.id).toBe(created.id);

    const rendered = await asTenantUser(tenantId, async () =>
      templates.renderByName(tenantId, 'order.placed', 'EMAIL', { orderId: 'A-1', name: 'Asha' }),
    );
    expect(rendered).toEqual({ subject: 'Order A-1 confirmed', body: 'Thanks Asha.' });

    const auditRows = await asTenantUser(tenantId, async () =>
      prisma.auditLog.count({
        where: { entity: 'NotificationTemplate', entityId: created.id },
      }),
    );
    expect(auditRows).toBe(2);
  });

  it('leaves unknown placeholders empty rather than printing the braces', async () => {
    await asTenantUser(tenantId, async () =>
      templates.upsert(tenantId, actorId, {
        name: 'sms.placed',
        channel: 'SMS',
        body: 'Order {{missing}} placed',
      }),
    );
    const rendered = await asTenantUser(tenantId, async () =>
      templates.renderByName(tenantId, 'sms.placed', 'SMS', {}),
    );
    expect(rendered?.body).toBe('Order  placed');
  });

  it('deletes a template and reports a missing one', async () => {
    const created = await asTenantUser(tenantId, async () =>
      templates.upsert(tenantId, actorId, {
        name: 'push.test',
        channel: 'PUSH',
        body: 'Hello {{name}}',
      }),
    );

    await asTenantUser(tenantId, async () => templates.remove(tenantId, created.id, actorId));

    const list = await asTenantUser(tenantId, async () => templates.list(tenantId));
    expect(list.some((t) => t.id === created.id)).toBe(false);

    await expect(
      asTenantUser(tenantId, async () => templates.remove(tenantId, created.id, actorId)),
    ).rejects.toThrow(/not found/i);
  });
});

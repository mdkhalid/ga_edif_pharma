import type { ExtendedPrismaClient } from '../../src/database/prisma.service';
import { NotificationCentreService } from '../../src/modules/notifications/application/notification-centre.service';
import { NotificationDispatcherService } from '../../src/modules/notifications/application/notification-dispatcher.service';
import { NotificationPreferenceService } from '../../src/modules/notifications/application/notification-preference.service';
import { PushTokenService } from '../../src/modules/notifications/application/push-token.service';
import type { PushMessage, PushTransport } from '../../src/common/ports/push.port';
import { asTenantUser, createTestPrisma, seededTenant } from '../support/database';

/** Records what would have been sent, and can fail a chosen token on demand. */
class RecordingPushTransport implements PushTransport {
  readonly sent: PushMessage[] = [];
  failingTokens = new Set<string>();

  async send(message: PushMessage): Promise<void> {
    if (this.failingTokens.has(message.token)) {
      throw new Error(`gateway refused ${message.token}`);
    }
    this.sent.push(message);
  }
}

describe('notification dispatch (integration)', () => {
  let prisma: ExtendedPrismaClient;
  let dispatcher: NotificationDispatcherService;
  let preferences: NotificationPreferenceService;
  let pushTokens: PushTokenService;
  let centre: NotificationCentreService;
  let transport: RecordingPushTransport;
  let tenantId: string;
  let userId: string;

  beforeAll(async () => {
    prisma = createTestPrisma();
    tenantId = (await seededTenant(prisma)).id;

    const user = await asTenantUser(tenantId, async () =>
      prisma.user.create({
        data: {
          tenantId,
          fullName: 'Dispatch User',
          email: `dispatch-${Date.now()}@test.local`,
          passwordHash: 'x',
        },
        select: { id: true },
      }),
    );
    userId = user.id;

    transport = new RecordingPushTransport();
    centre = new NotificationCentreService(prisma);
    preferences = new NotificationPreferenceService(prisma);
    pushTokens = new PushTokenService(prisma, transport);
    dispatcher = new NotificationDispatcherService(centre, preferences, pushTokens);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('registers a device token idempotently', async () => {
    const first = await asTenantUser(tenantId, async () =>
      pushTokens.register(tenantId, userId, { token: 'device-token-1', platform: 'android' }),
    );
    const second = await asTenantUser(tenantId, async () =>
      pushTokens.register(tenantId, userId, { token: 'device-token-1', platform: 'ios' }),
    );

    expect(second.id).toBe(first.id);

    const rows = await asTenantUser(tenantId, async () =>
      prisma.pushToken.count({ where: { userId } }),
    );
    expect(rows).toBe(1);

    const stored = await asTenantUser(tenantId, async () =>
      prisma.pushToken.findFirst({ where: { userId } }),
    );
    expect(stored?.platform).toBe('ios');
  });

  it('writes in-app and pushes to registered devices by default', async () => {
    transport.sent.length = 0;
    const result = await asTenantUser(tenantId, async () =>
      dispatcher.dispatch({
        tenantId,
        recipientId: userId,
        type: 'ORDER_PLACED',
        title: 'Order placed',
        body: 'Your order is on its way.',
      }),
    );

    expect(result.inApp).toBe(true);
    expect(result.push).toEqual({ delivered: 1, failed: 0 });
    expect(transport.sent[0]?.title).toBe('Order placed');
    expect(transport.sent[0]?.data).toEqual({ type: 'ORDER_PLACED' });

    const list = await asTenantUser(tenantId, async () =>
      centre.list(tenantId, userId, { pageSize: 100 }),
    );
    expect(list.data.some((n) => n.title === 'Order placed')).toBe(true);
  });

  it('skips push when the user turned the channel off', async () => {
    await asTenantUser(tenantId, async () =>
      preferences.setChannel(tenantId, userId, 'PUSH', false),
    );
    transport.sent.length = 0;

    const result = await asTenantUser(tenantId, async () =>
      dispatcher.dispatch({
        tenantId,
        recipientId: userId,
        type: 'ORDER_STATE',
        title: 'Order confirmed',
        body: 'Confirmed.',
      }),
    );

    expect(result.inApp).toBe(true);
    expect(result.push).toBeNull();
    expect(transport.sent).toHaveLength(0);

    await asTenantUser(tenantId, async () =>
      preferences.setChannel(tenantId, userId, 'PUSH', true),
    );
  });

  it('still pushes when the user turned the in-app record off', async () => {
    await asTenantUser(tenantId, async () =>
      preferences.setChannel(tenantId, userId, 'IN_APP', false),
    );
    transport.sent.length = 0;

    const result = await asTenantUser(tenantId, async () =>
      dispatcher.dispatch({
        tenantId,
        recipientId: userId,
        type: 'ORDER_STATE',
        title: 'Push only',
        body: 'No in-app copy.',
      }),
    );

    expect(result.inApp).toBe(false);
    expect(result.push?.delivered).toBe(1);
    expect(transport.sent).toHaveLength(1);

    const list = await asTenantUser(tenantId, async () =>
      centre.list(tenantId, userId, { pageSize: 100 }),
    );
    expect(list.data.some((n) => n.title === 'Push only')).toBe(false);

    await asTenantUser(tenantId, async () =>
      preferences.setChannel(tenantId, userId, 'IN_APP', true),
    );
  });

  it('isolates a failing device so the others still receive the push', async () => {
    await asTenantUser(tenantId, async () =>
      pushTokens.register(tenantId, userId, { token: 'device-token-dead', platform: 'ios' }),
    );
    transport.failingTokens.add('device-token-dead');
    transport.sent.length = 0;

    const result = await asTenantUser(tenantId, async () =>
      pushTokens.sendToUser(tenantId, userId, 'Fan out', 'Two devices.'),
    );

    expect(result.failed).toBe(1);
    expect(result.delivered).toBe(1);
    expect(transport.sent).toHaveLength(1);

    transport.failingTokens.clear();
  });

  it('stops delivering to an unregistered token', async () => {
    await asTenantUser(tenantId, async () =>
      pushTokens.unregister(tenantId, userId, 'device-token-1'),
    );
    const remaining = await asTenantUser(tenantId, async () =>
      pushTokens.listTokens(tenantId, userId),
    );
    expect(remaining).not.toContain('device-token-1');
  });
});

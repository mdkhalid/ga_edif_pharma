import { Prisma } from '@prisma/client';

import type { ExtendedPrismaClient } from '../../src/database/prisma.service';
import type { EmailTransport, OutboundEmail } from '../../src/infra/notifications/email-transport';
import { RoutingNotificationAdapter } from '../../src/infra/notifications/routing-notification.adapter';
import type { OutboundSms, SmsTransport } from '../../src/infra/notifications/sms-transport';
import type { OrderService } from '../../src/modules/orders/application/order.service';
import { testConfig } from '../support/config';
import { asTenantUser, createTestPrisma, seededTenant } from '../support/database';
import { buildOrderServiceWithPort } from '../support/services';

/**
 * The notification half of the Phase 1 exit criteria:
 *
 *   "An order triggers an email **and** an SMS within 30 s of placement."
 *
 * The transports are replaced by recorders, so the assertion is about the wiring
 * rather than about SMTP or Twilio — those have their own tests. What is proven
 * here is the chain the criterion actually names: an order reaches both
 * channels, addressed to the organisation that placed it, with the rendered
 * template rather than a placeholder.
 */

const ACTOR_ID = '11111111-1111-4111-8111-111111111111';

describe('order placement notifies the buyer (integration)', () => {
  let prisma: ExtendedPrismaClient;
  let orders: OrderService;
  let tenantId: string;

  const emails: OutboundEmail[] = [];
  const smsMessages: OutboundSms[] = [];

  const email: EmailTransport = {
    send: (message) => {
      emails.push(message);
      return Promise.resolve();
    },
  };

  const sms: SmsTransport = {
    send: (message) => {
      smsMessages.push(message);
      return Promise.resolve();
    },
  };

  beforeAll(async () => {
    prisma = createTestPrisma();
    tenantId = (await seededTenant(prisma)).id;

    orders = buildOrderServiceWithPort(
      prisma,
      new RoutingNotificationAdapter(email, sms, testConfig({ APP_NAME: 'MediChain' })),
    );
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(() => {
    emails.length = 0;
    smsMessages.length = 0;
  });

  /**
   * A buyer with contact details, a product in stock and a cart holding it.
   *
   * The organisation is created per test with a unique email and phone so the
   * assertions cannot be satisfied by a notice meant for another test's order.
   */
  async function buyerWithCart(contact: { email: string | null; phone: string | null }): Promise<string> {
    return asTenantUser(tenantId, async () => {
      const suffix = `${Date.now()}-${Math.random()}`;

      const organisation = await prisma.organisation.create({
        data: {
          tenantId,
          type: 'PHARMACY',
          legalName: `Notified buyer ${suffix}`,
          email: contact.email,
          phone: contact.phone,
        },
        select: { id: true },
      });

      const product = await prisma.product.create({
        data: {
          tenantId,
          name: `Notified product ${suffix}`,
          schedule: 'OTC',
          price: new Prisma.Decimal('35.0000'),
        },
        select: { id: true },
      });

      await prisma.warehouseStock.create({
        data: {
          tenantId,
          productId: product.id,
          warehouseId: `WH-NOTIFY-${product.id.slice(0, 8)}`,
          quantity: new Prisma.Decimal(10),
          reserved: new Prisma.Decimal(0),
        },
      });

      const cart = await prisma.cart.create({
        data: {
          tenantId,
          organisationId: organisation.id,
          status: 'ACTIVE',
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        },
        select: { id: true },
      });

      await prisma.cartItem.create({
        data: {
          tenantId,
          cartId: cart.id,
          productId: product.id,
          quantity: new Prisma.Decimal(2),
          price: new Prisma.Decimal('35.0000'),
        },
      });

      return organisation.id;
    });
  }

  it('emails and texts the buyer when their order is placed', async () => {
    const buyerId = await buyerWithCart({
      email: 'notified-buyer@example.test',
      phone: '+919876500000',
    });

    await asTenantUser(tenantId, () => orders.place(tenantId, buyerId, ACTOR_ID, {}));

    expect(emails).toHaveLength(1);
    expect(smsMessages).toHaveLength(1);
  });

  it('addresses each channel to the organisation that placed the order', async () => {
    const buyerId = await buyerWithCart({
      email: 'specific-buyer@example.test',
      phone: '+919876511111',
    });

    await asTenantUser(tenantId, () => orders.place(tenantId, buyerId, ACTOR_ID, {}));

    expect(emails[0]?.to).toBe('specific-buyer@example.test');
    expect(smsMessages[0]?.to).toBe('+919876511111');
  });

  it('sends the rendered template, naming the order', async () => {
    const buyerId = await buyerWithCart({
      email: 'templated-buyer@example.test',
      phone: '+919876522222',
    });

    const placed = await asTenantUser(tenantId, () =>
      orders.place(tenantId, buyerId, ACTOR_ID, {}),
    );

    // The short id is what the template renders; asserting it proves the real
    // template ran rather than a placeholder being shipped to customers.
    const shortId = placed.id.slice(0, 8);
    expect(emails[0]?.subject).toContain(shortId);
    expect(smsMessages[0]?.body).toContain(shortId);
  });

  it('sends on the one channel the organisation actually has', async () => {
    const buyerId = await buyerWithCart({ email: null, phone: '+919876533333' });

    await asTenantUser(tenantId, () => orders.place(tenantId, buyerId, ACTOR_ID, {}));

    expect(emails).toHaveLength(0);
    expect(smsMessages).toHaveLength(1);
  });

  it('places the order even when both channels fail', async () => {
    // The contract is that a notification can delay but never fail a sale. A
    // buyer whose confirmation bounced must still have an order.
    const failing = buildOrderServiceWithPort(
      prisma,
      new RoutingNotificationAdapter(
        { send: () => Promise.reject(new Error('smtp down')) },
        { send: () => Promise.reject(new Error('sms down')) },
        testConfig(),
      ),
    );

    const buyerId = await buyerWithCart({
      email: 'resilient-buyer@example.test',
      phone: '+919876544444',
    });

    const placed = await asTenantUser(tenantId, () =>
      failing.place(tenantId, buyerId, ACTOR_ID, {}),
    );

    expect(placed.id).toEqual(expect.any(String));
  });
});

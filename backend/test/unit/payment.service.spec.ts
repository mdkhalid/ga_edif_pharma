import { createHmac } from 'node:crypto';

import {
  BusinessRuleViolationError,
  ConfigurationError,
  NotFoundError,
  ValidationFailedError,
} from '../../src/common/exceptions/domain.exception';
import { AppConfigService } from '../../src/config/app-config.service';
import { ExtendedPrismaClient } from '../../src/database/prisma.service';
import { AuditService } from '../../src/modules/audit';
import type { PaymentGateway } from '../../src/modules/payments/application/payment-gateway.port';
import type {
  AppendWebhookResult,
  PaymentRepository,
} from '../../src/modules/payments/application/payment.repository.port';
import { PaymentService } from '../../src/modules/payments/application/payment.service';
import type {
  Payment,
  PaymentWebhookEvent,
} from '../../src/modules/payments/domain/payment.types';

/**
 * The service is the money-path seam: the amount must come from the order, a
 * repeated idempotency key must replay the first payment, and a redelivered
 * webhook must not append a second ledger row. These are asserted with in-memory
 * fakes so the invariants are checked without a database or a gateway.
 */
const TENANT = '11111111-1111-4111-8111-111111111111';
const ORG = '22222222-2222-4222-8222-222222222222';
const ORDER = '33333333-3333-4333-8333-333333333333';
const PAYMENT = '44444444-4444-4444-8444-444444444444';
const SECRET = 'test-webhook-secret';

function payment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: PAYMENT,
    tenantId: TENANT,
    organisationId: ORG,
    orderId: ORDER,
    status: 'PROCESSING',
    amount: '236.00',
    currency: 'INR',
    provider: 'mock',
    gatewayReference: `mock_${PAYMENT}`,
    idempotencyKey: 'key-1',
    createdAt: new Date('2026-11-27T00:00:00Z'),
    updatedAt: new Date('2026-11-27T00:00:00Z'),
    ...overrides,
  };
}

function makeService(options: {
  order?: Record<string, unknown> | null;
  existing?: Payment | null;
  appendResult?: AppendWebhookResult;
  webhookSecret?: string;
} = {}): {
  service: PaymentService;
  repo: jest.Mocked<PaymentRepository>;
  gateway: { provider: 'mock'; createIntent: jest.Mock };
  audit: jest.Mocked<AuditService>;
} {
  const stored = options.existing ?? null;
  const repo = {
    findByIdempotencyKey: jest.fn(async () => stored),
    createWithIntent: jest.fn(async (input: { id: string; amount: string }) =>
      payment({ id: input.id, amount: input.amount }),
    ),
    findById: jest.fn(async () => stored),
    findByIdUnscoped: jest.fn(async () => stored),
    list: jest.fn(async () => ({ rows: [], total: 0 })),
    appendWebhookEvent: jest.fn(
      async () => options.appendResult ?? { kind: 'appended', event: null as never },
    ),
  } as unknown as jest.Mocked<PaymentRepository>;

  const gateway = {
    provider: 'mock' as const,
    createIntent: jest.fn(async () => ({ gatewayReference: `mock_${PAYMENT}` })),
  };

  const prisma = {
    customerOrder: {
      findFirst: jest.fn(async () =>
        options.order === undefined
          ? {
              id: ORDER,
              total: '236',
              currency: 'INR',
              status: 'PLACED',
              paymentStatus: 'PENDING',
            }
          : options.order,
      ),
    },
  } as unknown as ExtendedPrismaClient;

  const audit = { record: jest.fn(async () => undefined) } as unknown as jest.Mocked<AuditService>;
  const config = {
    payments: {
      defaultProvider: 'mock',
      webhookSecret: options.webhookSecret ?? SECRET,
      razorpay: { keyId: '', keySecret: '', webhookSecret: '' },
    },
  } as unknown as AppConfigService;

  return {
    service: new PaymentService(
      repo,
      gateway as unknown as PaymentGateway,
      prisma,
      audit,
      config,
    ),
    repo,
    gateway,
    audit,
  };
}

const webhookEvent: PaymentWebhookEvent = {
  eventId: 'evt_1',
  paymentId: PAYMENT,
  type: 'CAPTURED',
};
const raw = JSON.stringify(webhookEvent);
const signature = () => createHmac('sha256', SECRET).update(raw).digest('hex');

describe('PaymentService.createIntent', () => {
  it('prices the payment from the persisted order total, not from the request', async () => {
    const { service } = makeService();
    const result = await service.createIntent(TENANT, 'user-1', ORG, 'key-1', {
      orderId: ORDER,
    });

    expect(result.amount).toBe('236.00');
    expect(result.provider).toBe('mock');
  });

  it('replays the first payment for a repeated idempotency key without asking the gateway again', async () => {
    const first = payment();
    const { service, gateway, repo } = makeService({ existing: first });

    const result = await service.createIntent(TENANT, 'user-1', ORG, 'key-1', {
      orderId: ORDER,
    });

    expect(result).toBe(first);
    expect(gateway.createIntent).not.toHaveBeenCalled();
    expect(repo.createWithIntent).not.toHaveBeenCalled();
  });

  it('rejects an order that belongs to another organisation', async () => {
    const { service } = makeService({ order: null });
    await expect(
      service.createIntent(TENANT, 'user-1', ORG, 'key-1', { orderId: ORDER }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('refuses to pay a cancelled order', async () => {
    const { service } = makeService({
      order: {
        id: ORDER,
        total: '236',
        currency: 'INR',
        status: 'CANCELLED',
        paymentStatus: 'PENDING',
      },
    });
    await expect(
      service.createIntent(TENANT, 'user-1', ORG, 'key-1', { orderId: ORDER }),
    ).rejects.toBeInstanceOf(BusinessRuleViolationError);
  });
});

describe('PaymentService.handleWebhook', () => {
  it('rejects an invalid signature before touching the database', async () => {
    const { service, repo } = makeService();

    await expect(
      service.handleWebhook('mock', webhookEvent, raw, 'bad-signature'),
    ).rejects.toBeInstanceOf(ValidationFailedError);
    expect(repo.findByIdUnscoped).not.toHaveBeenCalled();
  });

  it('fails closed when no webhook secret is configured', async () => {
    const { service } = makeService({ webhookSecret: '' });

    await expect(
      service.handleWebhook('mock', webhookEvent, raw, signature()),
    ).rejects.toBeInstanceOf(ConfigurationError);
  });

  it('appends the event and audits it once on first delivery', async () => {
    const { service, repo, audit } = makeService({ existing: payment() });

    const result = await service.handleWebhook('mock', webhookEvent, raw, signature());

    expect(result).toEqual({ received: true, duplicate: false });
    expect(repo.appendWebhookEvent).toHaveBeenCalledTimes(1);
    expect(repo.appendWebhookEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT,
        paymentId: PAYMENT,
        type: 'GATEWAY_CAPTURED',
        gatewayEventId: 'mock:evt_1',
      }),
    );
    expect(audit.record).toHaveBeenCalledTimes(1);
  });

  it('credits a redelivered event once and reports it as a duplicate', async () => {
    const { service, audit } = makeService({
      existing: payment(),
      appendResult: { kind: 'duplicate', event: null },
    });

    const result = await service.handleWebhook('mock', webhookEvent, raw, signature());

    expect(result).toEqual({ received: true, duplicate: true });
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('rejects a webhook whose amount disagrees with the payment', async () => {
    const { service, repo } = makeService({ existing: payment() });
    const different = { ...webhookEvent, amount: '1.00' };

    await expect(
      service.handleWebhook(
        'mock',
        different,
        JSON.stringify(different),
        createHmac('sha256', SECRET).update(JSON.stringify(different)).digest('hex'),
      ),
    ).rejects.toBeInstanceOf(BusinessRuleViolationError);
    expect(repo.appendWebhookEvent).not.toHaveBeenCalled();
  });
});

describe('PaymentService.refund', () => {
  it('only refunds a captured payment', async () => {
    const { service } = makeService({ existing: payment({ status: 'PROCESSING' }) });
    await expect(service.refund(TENANT, 'user-1', PAYMENT, 'wrong order')).rejects.toBeInstanceOf(
      BusinessRuleViolationError,
    );
  });
});

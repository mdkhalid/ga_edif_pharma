import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { requestContext } from '../../../common/context/request-context';
import {
  BusinessRuleViolationError,
  ConfigurationError,
  NotFoundError,
  ValidationFailedError,
} from '../../../common/exceptions/domain.exception';
import { AppConfigService } from '../../../config/app-config.service';
import { ExtendedPrismaClient, PRISMA_EXTENDED } from '../../../database/prisma.service';
import { ActorType } from '@medichain/shared-types';
import { paisa } from '../../pricing';
import { AuditService } from '../../audit';
import { PAYMENT_GATEWAY, type PaymentGateway } from './payment-gateway.port';
import { PAYMENT_REPOSITORY, type PaymentRepository } from './payment.repository.port';
import { InvalidWebhookSignatureError, verifyWebhookSignature } from '../domain/webhook-signature';
import { ledgerEventForWebhook, type Payment, type PaymentProvider, type PaymentWebhookEvent } from '../domain/payment.types';
import type {
  CreatePaymentIntentDto,
  ListPaymentsQuery,
} from '../api/dto/payment.dto';

/**
 * Payments bounded context (P6 / A11).
 *
 * The amount comes from the persisted order, never from the request body: a
 * caller who could choose the amount could pay one rupee for a ₹10,000 order.
 * The first response and an idempotent replay are the same stored payment, so
 * their money fields have the same scale (`paisa()`).
 *
 * Webhooks have no authenticated principal. The signature is verified before
 * any database read, the payment's tenant is recovered from the row, and only
 * then is the event written with that tenant explicit. A duplicate event id is
 * rejected by a unique index inside the same transaction that appends the row,
 * so redelivery cannot credit the ledger twice even under concurrency.
 */
@Injectable()
export class PaymentService {
  constructor(
    @Inject(PAYMENT_REPOSITORY) private readonly repo: PaymentRepository,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    @Inject(PRISMA_EXTENDED) private readonly prisma: ExtendedPrismaClient,
    private readonly audit: AuditService,
    private readonly config: AppConfigService,
  ) {}

  async createIntent(
    tenantId: string,
    actorId: string,
    organisationId: string | null,
    idempotencyKey: string,
    dto: CreatePaymentIntentDto,
  ): Promise<Payment> {
    if (dto.provider && dto.provider !== this.gateway.provider) {
      throw new ValidationFailedError(
        `Provider "${dto.provider}" is not configured; this deployment uses "${this.gateway.provider}".`,
      );
    }

    const existing = await this.repo.findByIdempotencyKey(tenantId, idempotencyKey);
    if (existing) {
      if (existing.orderId !== dto.orderId) {
        throw new BusinessRuleViolationError('This idempotency key belongs to a different order.');
      }
      return existing;
    }

    const buyerOrganisationId = dto.organisationId ?? organisationId;
    if (!buyerOrganisationId) {
      throw new ValidationFailedError('An organisation is required to pay for an order.');
    }

    const order = await this.prisma.customerOrder.findFirst({
      where: { id: dto.orderId, organisationId: buyerOrganisationId },
      select: {
        id: true,
        total: true,
        currency: true,
        status: true,
        paymentStatus: true,
      },
    });
    if (!order) throw new NotFoundError('Order', dto.orderId);
    if (order.status === 'CANCELLED') {
      throw new BusinessRuleViolationError('A cancelled order cannot be paid.');
    }
    if (order.paymentStatus === 'PAID') {
      throw new BusinessRuleViolationError('This order has already been paid.');
    }

    const amount = paisa(order.total);
    const id = randomUUID();
    const intent = await this.gateway.createIntent({
      paymentId: id,
      orderId: order.id,
      amount,
      currency: order.currency,
    });

    const payment = await this.repo.createWithIntent({
      id,
      tenantId,
      organisationId: buyerOrganisationId,
      orderId: order.id,
      amount,
      currency: order.currency,
      provider: this.gateway.provider,
      gatewayReference: intent.gatewayReference,
      idempotencyKey,
    });

    await this.audit.record({
      tenantId,
      action: 'payment.intent.created',
      entity: 'Payment',
      entityId: payment.id,
      actorId,
      metadata: { orderId: order.id, amount },
    });

    return payment;
  }

  async getById(
    tenantId: string,
    id: string,
    organisationId: string | null,
    staff: boolean,
  ): Promise<Payment> {
    const payment = await this.repo.findById(tenantId, id);
    if (!payment) throw new NotFoundError('Payment', id);
    if (!staff && organisationId !== payment.organisationId) {
      // Same response as not found: a buyer must not learn that another
      // organisation's payment exists.
      throw new NotFoundError('Payment', id);
    }
    return payment;
  }

  async list(
    tenantId: string,
    organisationId: string | null,
    staff: boolean,
    query: ListPaymentsQuery,
  ): Promise<{ data: Payment[]; meta: { page: number; pageSize: number; total: number; totalPages: number; hasNext: boolean; hasPrev: boolean } }> {
    const page = query.page && query.page > 0 ? query.page : 1;
    const pageSize = query.pageSize && query.pageSize > 0 ? Math.min(query.pageSize, 100) : 20;
    const { rows, total } = await this.repo.list(tenantId, {
      organisationId: staff ? query.organisationId : (organisationId ?? undefined),
      orderId: query.orderId,
      status: query.status,
      page,
      pageSize,
    });
    const totalPages = Math.ceil(total / pageSize) || 1;
    return {
      data: rows,
      meta: {
        page,
        pageSize,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    };
  }

  /**
   * Verifies and applies a gateway callback. Returns `duplicate: true` for a
   * redelivered event: the ledger already contains it and nothing is written.
   */
  async handleWebhook(
    provider: PaymentProvider,
    event: PaymentWebhookEvent,
    rawBody: string,
    signature: string,
  ): Promise<{ received: true; duplicate: boolean }> {
    const secret = provider === 'mock'
      ? this.config.payments.webhookSecret
      : this.config.payments.razorpay.webhookSecret;
    if (secret === '') {
      throw new ConfigurationError(`No webhook secret configured for provider "${provider}".`);
    }

    try {
      verifyWebhookSignature({ payload: rawBody, signature, secret });
    } catch (error: unknown) {
      if (error instanceof InvalidWebhookSignatureError) {
        throw new ValidationFailedError(error.message);
      }
      throw error;
    }

    if (provider !== this.gateway.provider) {
      throw new ValidationFailedError(`Provider "${provider}" is not configured.`);
    }

    const payment = await this.repo.findByIdUnscoped(event.paymentId);
    if (!payment) throw new NotFoundError('Payment', event.paymentId);
    if (payment.provider !== provider) {
      throw new ValidationFailedError('This payment belongs to another provider.');
    }
    if (event.amount !== undefined && paisa(event.amount) !== payment.amount) {
      throw new BusinessRuleViolationError('The webhook amount does not match the payment.');
    }

    const result = await this.repo.appendWebhookEvent({
      tenantId: payment.tenantId,
      paymentId: payment.id,
      type: ledgerEventForWebhook(event.type),
      amount: payment.amount,
      gatewayReference: event.gatewayReference ?? payment.gatewayReference ?? undefined,
      gatewayEventId: `${provider}:${event.eventId}`,
      metadata: { eventType: event.type },
    });

    if (result.kind === 'appended') {
      // No principal on a gateway callback: the tenant is explicit on the row.
      await requestContext.withoutTenantScope(() =>
        this.audit.record({
          tenantId: payment.tenantId,
          action: 'payment.webhook.received',
          entity: 'Payment',
          entityId: payment.id,
          actorType: ActorType.SYSTEM,
          actorId: null,
          metadata: { eventId: event.eventId, eventType: event.type },
        }),
      );
    }

    return { received: true, duplicate: result.kind === 'duplicate' };
  }

  async refund(
    tenantId: string,
    actorId: string,
    paymentId: string,
    reason: string,
  ): Promise<void> {
    const payment = await this.repo.findById(tenantId, paymentId);
    if (!payment) throw new NotFoundError('Payment', paymentId);
    if (payment.status !== 'CAPTURED') {
      throw new BusinessRuleViolationError('Only a captured payment can be refunded.');
    }
    await this.repo.appendWebhookEvent({
      tenantId,
      paymentId,
      type: 'REFUND_INITIATED',
      amount: payment.amount,
      metadata: { reason },
    });
    await this.audit.record({
      tenantId,
      action: 'payment.refund.initiated',
      entity: 'Payment',
      entityId: paymentId,
      actorId,
      metadata: { reason },
    });
  }
}

import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { BusinessRuleViolationError } from '../../../common/exceptions/domain.exception';
import { requestContext } from '../../../common/context/request-context';
import { ExtendedPrismaClient, PRISMA_EXTENDED } from '../../../database/prisma.service';
import { UnitOfWork } from '../../../database/unit-of-work';
import { Money, paisa } from '../../pricing';
import {
  PaymentLedger,
  PaymentStateTransitionError,
  statusForEvent,
  type PaymentEventType,
} from '../domain/payment-ledger';
import type { Payment, PaymentEventRecord } from '../domain/payment.types';
import {
  type AppendEventInput,
  type AppendWebhookResult,
  type CreatePaymentIntentInput,
  type PaymentRepository,
} from '../application/payment.repository.port';

/**
 * Prisma adapter for `PaymentRepository`.
 *
 * The tenant filter is injected by the scoping extension on every normal call.
 * The two webhook reads/writes are the deliberate exception: a gateway has no
 * principal, so they run inside `withoutTenantScope` and carry the payment's
 * tenant explicitly, in one greppable place.
 */
@Injectable()
export class PaymentRepositoryPrisma implements PaymentRepository {
  constructor(
    @Inject(PRISMA_EXTENDED) private readonly prisma: ExtendedPrismaClient,
    private readonly uow: UnitOfWork,
  ) {}

  async findByIdempotencyKey(tenantId: string, idempotencyKey: string): Promise<Payment | null> {
    const row = await this.prisma.payment.findFirst({
      where: { tenantId, idempotencyKey },
    });
    return row ? this.toPayment(row) : null;
  }

  async createWithIntent(input: CreatePaymentIntentInput): Promise<Payment> {
    return this.uow.transaction(async (tx) => {
      const row = await tx.payment.create({
        data: {
          id: input.id,
          tenantId: input.tenantId,
          organisationId: input.organisationId,
          orderId: input.orderId,
          amount: new Prisma.Decimal(input.amount),
          currency: input.currency,
          provider: input.provider,
          gatewayReference: input.gatewayReference,
          idempotencyKey: input.idempotencyKey,
          status: 'PENDING',
        },
      });

      await tx.paymentEvent.createMany({
        data: [
          {
            tenantId: input.tenantId,
            paymentId: row.id,
            type: 'INTENT_CREATED',
            status: 'PENDING',
            amount: new Prisma.Decimal(input.amount),
            idempotencyKey: input.idempotencyKey,
          },
          {
            tenantId: input.tenantId,
            paymentId: row.id,
            type: 'GATEWAY_REQUESTED',
            status: 'PROCESSING',
            amount: new Prisma.Decimal(input.amount),
            gatewayReference: input.gatewayReference,
          },
        ],
      });

      return this.toPayment(row);
    });
  }

  async findById(tenantId: string, id: string): Promise<Payment | null> {
    const row = await this.prisma.payment.findFirst({ where: { id, tenantId } });
    return row ? this.toPayment(row) : null;
  }

  async findByIdUnscoped(id: string): Promise<Payment | null> {
    return requestContext.withoutTenantScope(async () => {
      const row = await this.prisma.payment.findFirst({ where: { id } });
      return row ? this.toPayment(row) : null;
    });
  }

  async list(
    tenantId: string,
    filters: { organisationId?: string; orderId?: string; status?: string; page: number; pageSize: number },
  ): Promise<{ rows: Payment[]; total: number }> {
    const where: Record<string, unknown> = { tenantId };
    if (filters.organisationId) where.organisationId = filters.organisationId;
    if (filters.orderId) where.orderId = filters.orderId;
    if (filters.status) where.status = filters.status;

    const [rows, total] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
      }),
      this.prisma.payment.count({ where }),
    ]);
    return { rows: rows.map((row) => this.toPayment(row)), total };
  }

  async appendWebhookEvent(input: AppendEventInput): Promise<AppendWebhookResult> {
    // No principal on a gateway callback: bypass the extension for the whole
    // transaction, then scope every statement by the payment's tenant by hand.
    return requestContext.withoutTenantScope(() =>
      this.uow.transaction(async (tx) => {
        if (input.gatewayEventId !== undefined) {
          const existing = await tx.paymentEvent.findFirst({
            where: { gatewayEventId: input.gatewayEventId, tenantId: input.tenantId },
          });
          if (existing) return { kind: 'duplicate' as const, event: this.toPaymentEvent(existing) };
        }

        const rows = await tx.paymentEvent.findMany({
          where: { paymentId: input.paymentId, tenantId: input.tenantId },
          orderBy: { createdAt: 'asc' },
        });
        this.assertTransition(rows, input.paymentId, input.type);

        let created: Awaited<ReturnType<typeof tx.paymentEvent.create>>;
        try {
          created = await tx.paymentEvent.create({
            data: {
              tenantId: input.tenantId,
              paymentId: input.paymentId,
              type: input.type,
              status: statusForEvent(input.type),
              amount: new Prisma.Decimal(input.amount),
              gatewayReference: input.gatewayReference,
              gatewayEventId: input.gatewayEventId,
              idempotencyKey: input.idempotencyKey,
              metadata: input.metadata as Prisma.InputJsonObject | undefined,
            },
          });
        } catch (error: unknown) {
          if (isUniqueViolation(error)) {
            // Two deliveries raced: the unique index is the final arbiter.
            return { kind: 'duplicate' as const, event: null };
          }
          throw error;
        }

        await tx.payment.updateMany({
          where: { id: input.paymentId, tenantId: input.tenantId },
          data: {
            status: statusForEvent(input.type),
            gatewayReference: input.gatewayReference,
          },
        });

        return { kind: 'appended' as const, event: this.toPaymentEvent(created) };
      }),
    );
  }

  /**
   * Replays the pure state machine over the persisted ledger before appending.
   * The check is repeated inside the transaction — a status column read alone
   * would be a lost update under `READ COMMITTED`.
   */
  private assertTransition(
    rows: ReadonlyArray<{ type: string; amount: Prisma.Decimal; status: string; gatewayReference: string | null; idempotencyKey: string | null; createdAt: Date; tenantId: string; paymentId: string; id: string }>,
    paymentId: string,
    type: PaymentEventType,
  ): void {
    const ledger = new PaymentLedger(
      rows.map((row) => ({
        id: row.id,
        tenantId: row.tenantId,
        paymentId: row.paymentId,
        type: row.type as PaymentEventType,
        status: row.status as Payment['status'],
        amount: new Money(row.amount),
        gatewayReference: row.gatewayReference,
        idempotencyKey: row.idempotencyKey,
        metadata: {},
        createdAt: row.createdAt,
      })),
    );
    try {
      ledger.append({
        id: 'pending',
        tenantId: rows[0]?.tenantId ?? '',
        paymentId,
        type,
        amount: new Money(0),
        createdAt: new Date(),
      });
    } catch (error: unknown) {
      if (error instanceof PaymentStateTransitionError) {
        throw new BusinessRuleViolationError(
          `Payment cannot move from ${error.from} to ${error.to}.`,
        );
      }
      throw error;
    }
  }

  private toPayment(row: {
    id: string;
    tenantId: string;
    organisationId: string;
    orderId: string;
    status: string;
    amount: Prisma.Decimal;
    currency: string;
    provider: string;
    gatewayReference: string | null;
    idempotencyKey: string;
    createdAt: Date;
    updatedAt: Date;
  }): Payment {
    return {
      id: row.id,
      tenantId: row.tenantId,
      organisationId: row.organisationId,
      orderId: row.orderId,
      status: row.status as Payment['status'],
      amount: paisa(row.amount),
      currency: row.currency,
      provider: row.provider as Payment['provider'],
      gatewayReference: row.gatewayReference,
      idempotencyKey: row.idempotencyKey,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private toPaymentEvent(row: {
    id: string;
    tenantId: string;
    paymentId: string;
    type: string;
    status: string;
    amount: Prisma.Decimal;
    gatewayReference: string | null;
    gatewayEventId: string | null;
    idempotencyKey: string | null;
    createdAt: Date;
  }): PaymentEventRecord {
    return {
      id: row.id,
      tenantId: row.tenantId,
      paymentId: row.paymentId,
      type: row.type as PaymentEventType,
      status: row.status as Payment['status'],
      amount: paisa(row.amount),
      gatewayReference: row.gatewayReference,
      gatewayEventId: row.gatewayEventId,
      idempotencyKey: row.idempotencyKey,
      createdAt: row.createdAt,
    };
  }
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

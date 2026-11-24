import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

import { ExtendedPrismaClient, PRISMA_EXTENDED } from '../../../database/prisma.service';
import { UnitOfWork, type TransactionClient } from '../../../database/unit-of-work';
import { NotificationService } from '../../notifications';
import type { EnqueueInput, OutboxEvent, OutboxStatus } from '../domain/outbox.types';
import { isDead, nextAvailableAt } from '../domain/outbox.types';

/**
 * Transactional outbox: enqueue inside a business transaction, publish
 * afterwards with retry + dead-lettering. Handlers are idempotent by the
 * event's stable id.
 *
 * ## Query discipline
 *
 * Only `findFirst`/`findMany`/`updateMany`/`create` appear below — never the
 * singular `findUnique`/`update`/`upsert`. The scoping extension appends
 * `tenantId` to the filter for tenant-scoped models, and Prisma rejects a
 * non-unique `where` on the singular operations. `OutboxEvent` is tenant-
 * *optional*, so its queries run through `runUnscoped` where a tenant is not
 * known.
 */
@Injectable()
export class OutboxService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxService.name);

  constructor(
    @Inject(PRISMA_EXTENDED) private readonly prisma: ExtendedPrismaClient,
    private readonly uow: UnitOfWork,
    private readonly notifications: NotificationService,
  ) {}

  private relayHandle: NodeJS.Timeout | null = null;

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') return;
    const intervalMs = Number(process.env.OUTBOX_RELAY_INTERVAL_MS ?? 2000);
    this.relayHandle = setInterval(() => {
      void this.processBatch().catch((err) => this.logger.error('relay tick failed', err));
    }, intervalMs);
  }

  onModuleDestroy(): void {
    if (this.relayHandle) {
      clearInterval(this.relayHandle);
      this.relayHandle = null;
    }
  }

  /**
   * Enqueue an event inside an existing transaction. The row is committed
   * iff the business change commits, which is what removes the dual write.
   */
  async enqueue(tx: TransactionClient, input: EnqueueInput): Promise<string> {
    const created = await tx.outboxEvent.create({
      data: {
        tenantId: input.tenantId,
        eventType: input.eventType,
        aggregateType: input.aggregateType,
        aggregateId: input.aggregateId,
        payload: input.payload as never,
        deduplicationKey: input.deduplicationKey ?? null,
        availableAt: input.availableAt ?? new Date(),
        status: 'PENDING',
      },
      select: { id: true },
    });
    return created.id;
  }

  /**
   * Convenience for callers that are not already in a transaction. Wraps the
   * enqueue in its own transaction so the event is committed.
   */
  async enqueueStandalone(input: EnqueueInput): Promise<string> {
    return this.uow.transaction(async (tx) => this.enqueue(tx, input));
  }

  /**
   * Claims up to `limit` pending rows with `FOR UPDATE SKIP LOCKED`, dispatches
   * each to its handler, and marks the row PUBLISHED or FAILED (with retry
   * backoff, dead-lettering after `maxAttempts`). Returns the number processed.
   *
   * Safe to call concurrently from multiple relays: `SKIP LOCKED` means a row
   * claimed by one relay is invisible to the others.
   */
  async processBatch(limit = 50): Promise<number> {
    const claimed = await this.claimBatch(limit);
    let processed = 0;
    for (const event of claimed) {
      try {
        await this.dispatch(event);
        await this.markPublished(event.id);
        processed += 1;
      } catch (error) {
        await this.markFailed(event, error);
      }
    }
    return processed;
  }

  private async claimBatch(limit: number): Promise<OutboxEvent[]> {
    // Raw SQL because Prisma has no `SKIP LOCKED` support. The tenant filter is
    // written explicitly (nullable here) — the extension does not apply to raw.
    const rows = await this.prisma.$queryRawUnsafe<
      Array<{
        id: string;
        tenant_id: string | null;
        event_type: string;
        aggregate_type: string;
        aggregate_id: string;
        payload: unknown;
        status: string;
        attempts: number;
        max_attempts: number;
        available_at: Date;
        deduplication_key: string | null;
      }>
    >(
      `UPDATE "outbox_event"
          SET status = 'PROCESSING', locked_at = now(), locked_by = 'relay', attempts = attempts + 1
        WHERE id IN (
          SELECT id FROM "outbox_event"
          WHERE status IN ('PENDING','FAILED')
            AND available_at <= now()
          ORDER BY available_at ASC
          LIMIT $1
          FOR UPDATE SKIP LOCKED
        )
        RETURNING id, tenant_id, event_type, aggregate_type, aggregate_id, payload,
                  status, attempts, max_attempts, available_at, deduplication_key`,
      limit,
    );

    return rows.map((r) => ({
      id: r.id,
      tenantId: r.tenant_id,
      eventType: r.event_type,
      aggregateType: r.aggregate_type,
      aggregateId: r.aggregate_id,
      payload: r.payload,
      status: r.status as OutboxStatus,
      attempts: r.attempts,
      maxAttempts: r.max_attempts,
      availableAt: r.available_at,
      deduplicationKey: r.deduplication_key,
    }));
  }

  private async dispatch(event: OutboxEvent): Promise<void> {
    switch (event.eventType) {
      case 'order.placed': {
        const p = event.payload as {
          orderId: string;
          total: string;
          currency: string;
          itemCount: number;
          tenantName: string;
          email: string | null;
          phone: string | null;
        };
        await this.notifications.sendOrderPlacedStrict({
          orderId: p.orderId,
          total: p.total,
          currency: p.currency,
          itemCount: p.itemCount,
          tenantName: p.tenantName,
          email: p.email,
          phone: p.phone,
        });
        return;
      }
      default:
        this.logger.warn(`No handler registered for event type "${event.eventType}" (${event.id}); marking published.`);
    }
  }

  private async markPublished(id: string): Promise<void> {
    await this.prisma.$executeRawUnsafe(
      `UPDATE "outbox_event" SET status = 'PUBLISHED', published_at = now(), last_error = NULL WHERE id = $1::uuid`,
      id,
    );
  }

  private async markFailed(event: OutboxEvent, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : 'unknown error';
    const dead = isDead(event.attempts, event.maxAttempts);
    const status = dead ? 'DEAD' : 'FAILED';
    const availableAt = dead ? event.availableAt : nextAvailableAt(event.attempts);
    await this.prisma.$executeRawUnsafe(
      `UPDATE "outbox_event" SET status = $1::"OutboxStatus", last_error = $2, available_at = $3::timestamptz WHERE id = $4::uuid`,
      status,
      message,
      availableAt.toISOString(),
      event.id,
    );
    this.logger.warn(
      `Outbox event ${event.id} (${event.eventType}) failed (attempt ${event.attempts}/${event.maxAttempts}): ${message}`,
    );
  }
}

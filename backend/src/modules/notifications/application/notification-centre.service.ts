import { Inject, Injectable } from '@nestjs/common';

import { ExtendedPrismaClient, PRISMA_EXTENDED } from '../../../database/prisma.service';
import {
  ForbiddenError,
  NotFoundError,
} from '../../../common/exceptions/domain.exception';
import type { InAppNotification } from '../domain/notification-centre.types';

export interface CreateNotificationInput {
  tenantId: string;
  recipientId: string;
  type: string;
  title: string;
  body: string;
  metadata?: unknown;
}

export interface ListNotificationsQuery {
  unreadOnly?: boolean;
  page?: number;
  pageSize?: number;
}

/**
 * In-app notification centre (P9).
 *
 * Records a notification for a recipient and tracks read/unread state. Delivery
 * to other channels is `NotificationDispatcherService`'s job: it composes this
 * service with the recipient's preferences and the push registry, so the durable
 * in-app record stays a single, separately-testable concern.
 */
@Injectable()
export class NotificationCentreService {
  constructor(@Inject(PRISMA_EXTENDED) private readonly prisma: ExtendedPrismaClient) {}

  async create(input: CreateNotificationInput): Promise<{ id: string }> {
    const row = await this.prisma.notification.create({
      data: {
        tenantId: input.tenantId,
        recipientId: input.recipientId,
        type: input.type,
        title: input.title,
        body: input.body,
        metadata: (input.metadata ?? null) as never,
      },
      select: { id: true },
    });
    return { id: row.id };
  }

  async list(
    _tenantId: string,
    recipientId: string,
    query: ListNotificationsQuery,
  ): Promise<{
    data: InAppNotification[];
    meta: { page: number; pageSize: number; total: number; totalPages: number; hasNext: boolean; hasPrev: boolean };
    unreadCount: number;
  }> {
    const page = query.page && query.page > 0 ? query.page : 1;
    const pageSize = query.pageSize && query.pageSize > 0 ? Math.min(query.pageSize, 100) : 20;
    const where: Record<string, unknown> = { recipientId };
    if (query.unreadOnly) where.readAt = null;

    const [rows, total, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({ where: { recipientId, readAt: null } }),
    ]);

    const totalPages = Math.ceil(total / pageSize) || 1;
    return {
      data: rows.map((r) => ({
        id: r.id,
        tenantId: r.tenantId,
        recipientId: r.recipientId,
        type: r.type,
        title: r.title,
        body: r.body,
        metadata: r.metadata,
        readAt: r.readAt,
        createdAt: r.createdAt,
      })),
      meta: { page, pageSize, total, totalPages, hasNext: page < totalPages, hasPrev: page > 1 },
      unreadCount,
    };
  }

  async markRead(_tenantId: string, id: string, recipientId: string): Promise<void> {
    const row = await this.prisma.notification.findFirst({ where: { id } });
    if (!row) throw new NotFoundError('Notification not found.');
    if (row.recipientId !== recipientId) {
      throw new ForbiddenError('This notification belongs to another user.');
    }
    if (row.readAt) return; // idempotent
    await this.prisma.notification.updateMany({
      where: { id },
      data: { readAt: new Date() },
    });
  }

  async markAllRead(_tenantId: string, recipientId: string): Promise<{ count: number }> {
    const result = await this.prisma.notification.updateMany({
      where: { recipientId, readAt: null },
      data: { readAt: new Date() },
    });
    return { count: result.count };
  }
}
